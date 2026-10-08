using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;

namespace BonoNative.Views;

/// <summary>Web BONO OS Today parity: read-only morning brief and upcoming hearings.</summary>
public partial class TodayWorkspace : UserControl
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(12) };
    private bool _loading;

    public TodayWorkspace()
    {
        InitializeComponent();
        Loaded += async (_, _) => await RefreshAsync();
    }

    public async Task RefreshAsync()
    {
        if (_loading) return;
        _loading = true;
        ErrorText.Text = "";
        try
        {
            using var briefResponse = await _http.GetAsync("http://127.0.0.1:47831/api/morning-brief");
            briefResponse.EnsureSuccessStatusCode();
            using var brief = JsonDocument.Parse(await briefResponse.Content.ReadAsStringAsync());
            using var hearingsResponse = await _http.GetAsync("http://127.0.0.1:47831/api/hearings/upcoming?limit=250");
            hearingsResponse.EnsureSuccessStatusCode();
            using var hearings = JsonDocument.Parse(await hearingsResponse.Content.ReadAsStringAsync());
            var b = brief.RootElement;
            var allHearings = hearings.RootElement.ValueKind == JsonValueKind.Array
                ? hearings.RootElement.EnumerateArray().ToArray() : Array.Empty<JsonElement>();
            var now = DateTime.Now;
            var weekEnd = now.AddDays(7);
            var nextSeven = allHearings.Count(h => DateTime.TryParse(Get(h, "starts_at"), out var dt) && dt >= now && dt <= weekEnd);
            // morningBrief counts are nested under counts, while the original
            // daily task count comes from the lightweight summary endpoint.
            var counts = b.TryGetProperty("counts", out var c) && c.ValueKind == JsonValueKind.Object ? c : default;
            TodayHearings.Text = (counts.ValueKind == JsonValueKind.Object ? Number(counts, "hearings") : 0).ToString();
            WeekHearings.Text = nextSeven.ToString();
            UrgentDeadlines.Text = (counts.ValueKind == JsonValueKind.Object ? Number(counts, "urgentDeadlines") : 0).ToString();
            // Morning-brief does not include a todayTasks field. Avoid pretending
            // that missing data is a real zero; show an explicit unavailable value.
            TodayTasks.Text = "—";
            var items = Rows(b, "items").Take(12)
                .Select(x => new BriefRow(Get(x, "when"), Get(x, "title"), Get(x, "subtitle"))).ToList();
            BriefItems.ItemsSource = items;
            BriefEmpty.Visibility = items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            var upcoming = allHearings.Take(8)
                .Select(h => new HearingRow(Get(h, "court", "Duruşma"),
                    Get(h, "starts_at").Replace('T', ' ') + " · " + Get(h, "court_file_no"))).ToList();
            HearingItems.ItemsSource = upcoming;
            HearingsEmpty.Visibility = upcoming.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            ErrorText.Text = "Günlük bilgiler alınamadı: " + ex.Message;
        }
        finally { _loading = false; }
    }

    private static string Get(JsonElement obj, string property, string fallback = "")
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(property, out var el) ||
            el.ValueKind == JsonValueKind.Null) return fallback;
        return el.ValueKind == JsonValueKind.String ? el.GetString() ?? fallback : el.ToString();
    }
    private static int Number(JsonElement obj, string property) =>
        int.TryParse(Get(obj, property), out var n) ? n : 0;
    private static IEnumerable<JsonElement> Rows(JsonElement obj, string property) =>
        obj.ValueKind == JsonValueKind.Object &&
        obj.TryGetProperty(property, out var el) && el.ValueKind == JsonValueKind.Array
            ? el.EnumerateArray().ToArray() : Array.Empty<JsonElement>();

    private sealed record BriefRow(string When, string Title, string Subtitle);
    private sealed record HearingRow(string Court, string Subtitle);
}
