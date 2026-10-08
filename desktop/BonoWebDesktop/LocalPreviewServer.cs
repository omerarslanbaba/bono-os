using System.IO;
using System.Net;
using System.Net.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;

namespace BonoWebDesktop;

public sealed class LocalPreviewServer : IAsyncDisposable
{
    private static readonly HashSet<string> HopByHopHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
        "TE", "Trailer", "Transfer-Encoding", "Upgrade", "Host", "Content-Length"
    };

    private readonly WebApplication _app;
    private readonly HttpClient _coreClient;

    private LocalPreviewServer(WebApplication app, HttpClient coreClient, Uri origin)
    {
        _app = app;
        _coreClient = coreClient;
        Origin = origin;
    }

    public Uri Origin { get; }

    public static async Task<LocalPreviewServer> StartAsync(
        string webRoot,
        Uri coreBase,
        ReleaseIdentity identity,
        CancellationToken cancellationToken = default)
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
        {
            ApplicationName = typeof(LocalPreviewServer).Assembly.FullName,
            ContentRootPath = webRoot,
            Args = Array.Empty<string>()
        });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Loopback, 0, listen => listen.Protocols = HttpProtocols.Http1);
        });

        var app = builder.Build();
        var coreClient = new HttpClient(new SocketsHttpHandler
        {
            UseCookies = false,
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.None
        })
        {
            BaseAddress = coreBase,
            Timeout = TimeSpan.FromMinutes(5)
        };

        app.Use(async (context, next) =>
        {
            if (context.Connection.RemoteIpAddress is { } remote && !IPAddress.IsLoopback(remote))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            await next();
        });

        app.MapGet("/__bono/version", () => Results.Json(new
        {
            product = "BONO OS Web Desktop Preview",
            version = identity.Version,
            exeCommit = identity.ExeCommit,
            webCommit = identity.WebCommit,
            commitsMatch = identity.CommitsMatch,
            webSha256 = identity.WebSha256
        }));

        var proxyMethods = new[] { "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD" };
        app.MapMethods("/api/{**path}", proxyMethods, context => ProxyAsync(context, coreClient, coreBase));
        app.MapMethods("/health", proxyMethods, context => ProxyAsync(context, coreClient, coreBase));

        var provider = new PhysicalFileProvider(webRoot);
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = provider });
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = provider,
            OnPrepareResponse = context =>
            {
                context.Context.Response.Headers.CacheControl = "no-store, max-age=0";
            }
        });

        app.MapFallback(async context =>
        {
            if (HttpMethods.IsGet(context.Request.Method))
            {
                var index = Path.Combine(webRoot, "index.html");
                context.Response.ContentType = "text/html; charset=utf-8";
                context.Response.Headers.CacheControl = "no-store, max-age=0";
                await context.Response.SendFileAsync(index);
                return;
            }
            context.Response.StatusCode = StatusCodes.Status404NotFound;
        });

        await app.StartAsync(cancellationToken);
        var server = app.Services.GetRequiredService<IServer>();
        var addresses = server.Features.Get<IServerAddressesFeature>()?.Addresses;
        var address = addresses?.SingleOrDefault(a => a.StartsWith("http://127.0.0.1:", StringComparison.OrdinalIgnoreCase))
            ?? addresses?.SingleOrDefault()
            ?? throw new InvalidOperationException("Web önizleme sunucusu loopback adresi oluşturamadı.");

        return new LocalPreviewServer(app, coreClient, new Uri(address));
    }

    private static async Task ProxyAsync(HttpContext context, HttpClient client, Uri coreBase)
    {
        var relative = (context.Request.Path.Value ?? "/") + (context.Request.QueryString.Value ?? "");
        var target = new Uri(coreBase, relative);
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), target);

        var mayHaveBody =
            !HttpMethods.IsGet(context.Request.Method) &&
            !HttpMethods.IsHead(context.Request.Method) &&
            !HttpMethods.IsTrace(context.Request.Method);
        if (mayHaveBody)
            request.Content = new StreamContent(context.Request.Body);

        foreach (var header in context.Request.Headers)
        {
            if (HopByHopHeaders.Contains(header.Key) ||
                header.Key.Equals("Origin", StringComparison.OrdinalIgnoreCase) ||
                header.Key.Equals("Referer", StringComparison.OrdinalIgnoreCase))
                continue;

            if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()) &&
                request.Content is not null)
                request.Content.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }

        if (context.Request.Headers.ContainsKey("Origin"))
            request.Headers.TryAddWithoutValidation("Origin", coreBase.GetLeftPart(UriPartial.Authority));
        if (context.Request.Headers.ContainsKey("Referer"))
            request.Headers.Referrer = coreBase;

        using var response = await client.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            context.RequestAborted);

        context.Response.StatusCode = (int)response.StatusCode;
        CopyResponseHeaders(response.Headers, context.Response);
        CopyResponseHeaders(response.Content.Headers, context.Response);

        await using var stream = await response.Content.ReadAsStreamAsync(context.RequestAborted);
        await stream.CopyToAsync(context.Response.Body, context.RequestAborted);
    }

    private static void CopyResponseHeaders(
        IEnumerable<KeyValuePair<string, IEnumerable<string>>> headers,
        HttpResponse response)
    {
        foreach (var header in headers)
        {
            if (HopByHopHeaders.Contains(header.Key)) continue;
            response.Headers[header.Key] = header.Value.ToArray();
        }
    }

    public async ValueTask DisposeAsync()
    {
        _coreClient.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
    }
}
