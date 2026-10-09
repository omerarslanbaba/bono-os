using System.Net;
using System.Net.Http;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace BonoWebDesktop;

public partial class MainWindow : Window
{
    private static readonly Uri CoreUri = new("http://127.0.0.1:47831/");
    private readonly HttpClient _probe = new() { Timeout = TimeSpan.FromSeconds(3) };
    private LocalPreviewServer? _previewServer;
    private bool _initializing;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await OpenAsync();
        Closed += async (_, _) =>
        {
            _probe.Dispose();
            if (_previewServer is not null)
            {
                await _previewServer.DisposeAsync();
                _previewServer = null;
            }
        };
    }

    private async Task OpenAsync()
    {
        if (_initializing) return;
        _initializing = true;
        LoadingPanel.Visibility = Visibility.Visible;
        Browser.Visibility = Visibility.Collapsed;
        VersionWarningPanel.Visibility = Visibility.Collapsed;
        StatusText.Text = "Yerel BONO Core bağlantısı kontrol ediliyor.";

        try
        {
            try
            {
                using var response = await _probe.GetAsync(new Uri(CoreUri, "health"));
                if (response.StatusCode != HttpStatusCode.OK)
                    throw new InvalidOperationException("BONO Core sağlık kontrolü HTTP " + (int)response.StatusCode + " döndürdü.");
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
            {
                StatusText.Text = "BONO Core çalışmıyor veya sağlık kontrolüne ulaşılamıyor. Mevcut BONO Core'u manuel olarak çalıştırıp yeniden deneyin.\n\n" + ex.Message;
                return;
            }

            try
            {
                _ = CoreWebView2Environment.GetAvailableBrowserVersionString();
            }
            catch (WebView2RuntimeNotFoundException ex)
            {
                StatusText.Text = "Microsoft Edge WebView2 Runtime bulunamadı. BONO Core çalışıyor, ancak masaüstü arayüzünü açmak için WebView2 Evergreen Runtime kurulmalı.\n\n" + ex.Message;
                return;
            }

            StatusText.Text = "Paketlenmiş BONO OS arayüzü doğrulanıyor.";
            var identity = ReleaseIdentity.Load(ReleaseIdentity.PackageDirectory);
            var webRoot = WebBundleManager.Prepare(identity);

            if (_previewServer is not null)
            {
                await _previewServer.DisposeAsync();
                _previewServer = null;
            }

            _previewServer = await LocalPreviewServer.StartAsync(webRoot, CoreUri, identity);
            var previewOrigin = _previewServer.Origin;

            Title = $"BONO OS · EXE {identity.ExeShort} · UI {identity.WebShort}";
            if (!identity.CommitsMatch)
            {
                Title += " · ⚠ UI SÜRÜMÜ FARKLI";
                VersionWarningText.Text =
                    $"Sürüm uyuşmazlığı: EXE {identity.ExeShort} / arayüz {identity.WebShort}. " +
                    "Paket bütünlüğünü ve güncelleme kaynağını kontrol edin.";
                VersionWarningPanel.Visibility = Visibility.Visible;
            }

            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "BONO OS Web Desktop", "WebView2Profile"));
            await Browser.EnsureCoreWebView2Async(environment);

            Browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
            Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;

            Browser.CoreWebView2.NavigationStarting += (_, args) =>
            {
                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) || !SameOrigin(uri, previewOrigin))
                    args.Cancel = true;
            };

            Browser.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) && SameOrigin(uri, previewOrigin))
                    Browser.CoreWebView2.Navigate(uri.ToString());
            };

            Browser.Source = new Uri(previewOrigin, "index.html");
            Browser.Visibility = Visibility.Visible;
            LoadingPanel.Visibility = Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            StatusText.Text = "WebView2 masaüstü arayüzü başlatılamadı. Canlı BONO Core veya canlı web dosyaları değiştirilmedi.\n\n" + ex.Message;
        }
        finally
        {
            _initializing = false;
        }
    }

    private static bool SameOrigin(Uri candidate, Uri origin) =>
        candidate.Scheme.Equals(origin.Scheme, StringComparison.OrdinalIgnoreCase) &&
        candidate.Host.Equals(origin.Host, StringComparison.OrdinalIgnoreCase) &&
        candidate.Port == origin.Port;

    private async void Retry_Click(object sender, RoutedEventArgs e) => await OpenAsync();
}
