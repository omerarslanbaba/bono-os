using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;

namespace BonoNative.Views;

/// <summary>Read-only FÖY detail backed by the existing office file detail API.</summary>
public partial class OfficeFileDetailView : UserControl
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(12) };
    private int _currentId;
    public event EventHandler? BackRequested;

    public OfficeFileDetailView() => InitializeComponent();

    public async Task OpenAsync(int id)
    {
        if (id <= 0) throw new ArgumentOutOfRangeException(nameof(id));
        _currentId = id;
        ErrorText.Text = "";
        FoyText.Text = "FÖY";
        TitleText.Text = "Dosya yükleniyor…";
        CasesGrid.ItemsSource = null;
        TasksList.ItemsSource = null;
        DeadlinesList.ItemsSource = null;
        try
        {
            using var response = await _http.GetAsync($"http://127.0.0.1:47831/api/office-files/{id}");
            response.EnsureSuccessStatusCode();
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (_currentId != id) return;
            var data = document.RootElement;
            FoyText.Text = Read(data, "file_no", "FÖY");
            TitleText.Text = Read(data, "title", "Dosya");
            ClientText.Text = "Müvekkil: " + Read(data, "client_name");
            StatusText.Text = "Durum: " + Read(data, "status");
            OpenedText.Text = "Açılış: " + Read(data, "opened_at");
            var cases = Rows(data, "cases").Select(x => new CaseItem(
                Read(x, "court"), Read(x, "court_file_no"), Read(x, "status"))).ToList();
            CasesGrid.ItemsSource = cases;
            CasesEmpty.Visibility = cases.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            var tasks = Rows(data, "tasks").Select(x => new DetailItem(
                Read(x, "title"), Read(x, "due_at") + " · " + Read(x, "status"))).ToList();
            TasksList.ItemsSource = tasks;
            TasksEmpty.Visibility = tasks.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            var deadlines = Rows(data, "deadlines").Select(x => new DetailItem(
                Read(x, "title"), Read(x, "due_at") + " · " + Read(x, "status"))).ToList();
            DeadlinesList.ItemsSource = deadlines;
            DeadlinesEmpty.Visibility = deadlines.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            if (_currentId == id)
            {
                TitleText.Text = "Dosya yüklenemedi";
                ErrorText.Text = "FÖY ayrıntısı alınamadı: " + ex.Message;
            }
        }
    }

    private static IEnumerable<JsonElement> Rows(JsonElement element, string key) =>
        element.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray().ToArray()
            : Array.Empty<JsonElement>();

    private static string Read(JsonElement element, string key, string fallback = "—") =>
        element.TryGetProperty(key, out var value) && value.ValueKind != JsonValueKind.Null
            ? (value.ValueKind == JsonValueKind.String ? value.GetString() ?? fallback : value.ToString())
            : fallback;

    private void Back_Click(object sender, RoutedEventArgs e) => BackRequested?.Invoke(this, EventArgs.Empty);

    private sealed record CaseItem(string Court, string FileNo, string Status);
    private sealed record DetailItem(string Title, string Detail);
}
