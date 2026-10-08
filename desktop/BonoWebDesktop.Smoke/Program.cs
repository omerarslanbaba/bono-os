using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BonoWebDesktop;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

if (args.Length != 1 || !Directory.Exists(args[0]))
    throw new ArgumentException("Usage: BonoWebDesktop.Smoke <web-root>");

var webRoot = Path.GetFullPath(args[0]);
var coreOnlyHits = 0;

var coreBuilder = WebApplication.CreateSlimBuilder();
coreBuilder.Logging.ClearProviders();
coreBuilder.WebHost.ConfigureKestrel(o =>
    o.Listen(IPAddress.Loopback, 0, l => l.Protocols = HttpProtocols.Http1));
var core = coreBuilder.Build();

core.MapGet("/health", () => Results.Json(new { ok = true }));
core.MapMethods("/api/echo", new[] { "GET", "POST" }, async context =>
{
    string body = "";
    if (context.Request.ContentLength is > 0)
    {
        using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
        body = await reader.ReadToEndAsync();
    }

    return Results.Json(new
    {
        ok = true,
        method = context.Request.Method,
        query = context.Request.QueryString.Value ?? "",
        body,
        origin = context.Request.Headers.Origin.ToString()
    });
});
core.MapGet("/core-only", () =>
{
    coreOnlyHits++;
    return Results.Text("CORE_ONLY_SECRET");
});

await core.StartAsync();
var coreServer = core.Services.GetRequiredService<IServer>();
var coreAddress = coreServer.Features.Get<IServerAddressesFeature>()!.Addresses.Single();
var coreUri = new Uri(coreAddress);

var identity = new ReleaseIdentity(
    "smoke",
    "aaaaaaaa11111111",
    "aaaaaaaa11111111",
    "exe-hash",
    "web-hash");

await using var preview = await LocalPreviewServer.StartAsync(webRoot, coreUri, identity);
if (!IPAddress.TryParse(preview.Origin.Host, out var previewIp) || !IPAddress.IsLoopback(previewIp))
    throw new InvalidOperationException("Preview server is not bound to loopback.");
if (preview.Origin.Port <= 0)
    throw new InvalidOperationException("Preview server did not receive an ephemeral port.");

using var client = new HttpClient();

var index = await client.GetStringAsync(new Uri(preview.Origin, "index.html"));
if (!index.Contains("/styles-active.css", StringComparison.Ordinal) ||
    !index.Contains("/js/main.js", StringComparison.Ordinal))
    throw new InvalidOperationException("Bundled index.html was not served from preview origin.");

var hearings = await client.GetStringAsync(new Uri(preview.Origin, "js/views/active/hearings.js"));
foreach (var marker in new[] { "prevPeriod", "nextPeriod", "thisPeriod", "month-view" })
{
    if (!hearings.Contains(marker, StringComparison.Ordinal))
        throw new InvalidOperationException("Month-only calendar marker missing: " + marker);
}
if (hearings.Contains("weekMode", StringComparison.Ordinal) ||
    hearings.Contains("three-month-calendar", StringComparison.Ordinal))
    throw new InvalidOperationException("Legacy week/three-month calendar code is still present.");

using var apiRequest = new HttpRequestMessage(HttpMethod.Post, new Uri(preview.Origin, "api/echo?source=preview"))
{
    Content = JsonContent.Create(new { hello = "world" })
};
apiRequest.Headers.TryAddWithoutValidation("Origin", preview.Origin.GetLeftPart(UriPartial.Authority));
using var apiResponse = await client.SendAsync(apiRequest);
apiResponse.EnsureSuccessStatusCode();
using var apiJson = JsonDocument.Parse(await apiResponse.Content.ReadAsStringAsync());
var apiRoot = apiJson.RootElement;
if (apiRoot.GetProperty("method").GetString() != "POST")
    throw new InvalidOperationException("API method was not proxied.");
if (apiRoot.GetProperty("query").GetString() != "?source=preview")
    throw new InvalidOperationException("API query string was not proxied.");
if (apiRoot.GetProperty("origin").GetString() != coreUri.GetLeftPart(UriPartial.Authority))
    throw new InvalidOperationException("Proxy did not normalize Origin to BONO Core origin.");
if (!apiRoot.GetProperty("body").GetString()!.Contains("world", StringComparison.Ordinal))
    throw new InvalidOperationException("API request body was not proxied.");

var health = await client.GetFromJsonAsync<JsonElement>(new Uri(preview.Origin, "health"));
if (!health.GetProperty("ok").GetBoolean())
    throw new InvalidOperationException("Core health was not proxied.");

var version = await client.GetFromJsonAsync<JsonElement>(new Uri(preview.Origin, "__bono/version"));
if (!version.GetProperty("commitsMatch").GetBoolean() ||
    version.GetProperty("exeCommit").GetString() != identity.ExeCommit ||
    version.GetProperty("webCommit").GetString() != identity.WebCommit)
    throw new InvalidOperationException("Version diagnostic endpoint is inconsistent.");

var notProxied = await client.GetStringAsync(new Uri(preview.Origin, "core-only"));
if (notProxied.Contains("CORE_ONLY_SECRET", StringComparison.Ordinal) || coreOnlyHits != 0)
    throw new InvalidOperationException("Non-/api Core path was exposed through preview proxy.");

Console.WriteLine("PASS bundled UI + same-origin API proxy + month calendar + version diagnostics");
await core.StopAsync();
await core.DisposeAsync();
