using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;

namespace BonoNative.Views;

/// <summary>Read-only UYAP case results, modeled on the original web Dosyalarım list.</summary>
public partial class UyapCaseResultsView : UserControl
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private List<CaseResult> _all = new();
    private bool _loading;
    public event EventHandler<int>? CaseOpened;

    public UyapCaseResultsView()
    {
        InitializeComponent();
        Loaded += async (_, _) => await RefreshAsync();
    }

    public async Task RefreshAsync()
    {
        if (_loading) return;
        _loading = true;
        CountText.Text = "UYAP dosyaları yükleniyor…";
        try
        {
            using var response = await _http.GetAsync("http://127.0.0.1:47831/api/uyap/cases");
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                throw new InvalidOperationException("Dosya sonuçları liste biçiminde değil.");
            _all = doc.RootElement.EnumerateArray().Select(x => new CaseResult(
                Number(x, "id"), Read(x, "office_file_no"),
                Read(x, "court"), Read(x, "court_file_no"),
                Read(x, "case_type"), Read(x, "status"),
                Number(x, "remote_count"), Number(x, "indexed_count"))).ToList();
            ApplyFilter();
        }
        catch (Exception ex)
        {
            CountText.Text = "UYAP verisi alınamadı: " + ex.Message;
        }
        finally { _loading = false; }
    }

    public void Search(string value)
    {
        QueryBox.Text = value ?? "";
        ApplyFilter();
    }

    private void ApplyFilter()
    {
        if (Results == null) return;
        var q = (QueryBox?.Text ?? "").Trim();
        var selected = _all.Where(x => string.IsNullOrWhiteSpace(q) ||
            x.Headline.Contains(q, StringComparison.CurrentCultureIgnoreCase) ||
            x.Foy.Contains(q, StringComparison.CurrentCultureIgnoreCase) ||
            x.Type.Contains(q, StringComparison.CurrentCultureIgnoreCase)).ToList();
        Results.ItemsSource = selected;
        CountText.Text = selected.Count + " / " + _all.Count + " UYAP dosyası gösteriliyor";
        EmptyText.Visibility = selected.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void Query_Changed(object sender, TextChangedEventArgs e) => ApplyFilter();
    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();
    private void OpenCase_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is CaseResult item && item.Id > 0)
            CaseOpened?.Invoke(this, item.Id);
    }
    private static string Read(JsonElement x, string key)
    {
        if (!x.TryGetProperty(key, out var v) || v.ValueKind == JsonValueKind.Null) return "";
        return v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString();
    }
    private static int Number(JsonElement x, string key) =>
        int.TryParse(Read(x, key), out var value) ? value : 0;

    public sealed record CaseResult(int Id, string Foy, string Court, string FileNo,
        string Type, string Status, int RemoteCount, int IndexedCount)
    {
        public string Badge => string.IsNullOrWhiteSpace(Foy) ? "FÖY Bekliyor" : Foy;
        public string Headline => Court + " · " + FileNo;
        public string Subtitle => Type + " · " + RemoteCount + " evrak · " + IndexedCount + " BONO'da";
    }
}
