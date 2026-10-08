using System.Net;
using System.Net.Http;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace BonoWebDesktop;

public partial class MainWindow : Window
{
    // The existing local bridge serves the original web/index.html and assets.
    // This preview never changes Core, database, extension, downloads or jobs.
    private static readonly Uri AppUri = new("http://127.0.0.1:47831/");
    private readonly HttpClient _probe = new() { Timeout = TimeSpan.FromSeconds(3) };
    private bool _initializing;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await OpenAsync();
        Closed += (_, _) => _probe.Dispose();
    }

    private async Task OpenAsync()
    {
        if (_initializing) return;
        _initializing = true;
        LoadingPanel.Visibility = Visibility.Visible;
        Browser.Visibility = Visibility.Collapsed;
        StatusText.Text = "Yerel BONO Core bağlantısı kontrol ediliyor.";
        try
        {
            using var response = await _probe.GetAsync(new Uri(AppUri, "health"));
            if (response.StatusCode != HttpStatusCode.OK)
                throw new InvalidOperationException("BONO Core sağlık kontrolü başarılı olmadı.");
            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "BONO OS Web Desktop", "WebView2Profile"));
            await Browser.EnsureCoreWebView2Async(environment);
            Browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
            Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            Browser.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                // Preserve same-origin application links; don't silently launch external URLs.
                args.Handled = true;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) &&
                    uri.Scheme == AppUri.Scheme && uri.Host == AppUri.Host && uri.Port == AppUri.Port)
                    Browser.CoreWebView2.Navigate(uri.ToString());
            };
            Browser.Source = AppUri;
            Browser.Visibility = Visibility.Visible;
            LoadingPanel.Visibility = Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            StatusText.Text = "BONO Core'a ulaşılamıyor veya WebView2 yüklenemedi. Mevcut BONO Core'u çalıştırıp yeniden deneyin.\n\n" + ex.Message;
        }
        finally { _initializing = false; }
    }

    private async void Retry_Click(object sender, RoutedEventArgs e) => await OpenAsync();
}
