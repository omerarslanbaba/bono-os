using System.Collections.ObjectModel;
using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;

namespace BonoNative.Views;

/// <summary>
/// Office-only workspace. Does not change or trigger UYAP query/download state.
/// The host can navigate to a case when a user opens a FÖY.
/// </summary>
public partial class OfficeFilesWorkspace : UserControl
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(12) };
    private readonly ObservableCollection<OfficeFileItem> _items = new();
    private bool _loading;

    public event EventHandler<OfficeFileItem>? FileOpened;

    public OfficeFilesWorkspace()
    {
        InitializeComponent();
        RowsGrid.ItemsSource = _items;
        Loaded += async (_, _) => await RefreshAsync();
        Unloaded += (_, _) => { /* Keep data when navigating between pages. */ };
    }

    public async Task RefreshAsync()
    {
        if (_loading) return;
        _loading = true;
        ErrorText.Text = "";
        try
        {
            using var response = await _http.GetAsync("http://127.0.0.1:47831/api/office-files?limit=500");
            response.EnsureSuccessStatusCode();
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (json.RootElement.ValueKind != JsonValueKind.Array)
                throw new InvalidOperationException("Ofis dosyaları yanıtı liste değil.");

            var next = new List<OfficeFileItem>();
            foreach (var row in json.RootElement.EnumerateArray())
            {
                next.Add(new OfficeFileItem(
                    Read(row, "file_no"), Read(row, "client_name"),
                    Read(row, "title"), Read(row, "status"),
                    ReadNumber(row, "case_count")));
            }
            _items.Clear();
            foreach (var item in next) _items.Add(item);
            ApplyFilter();
        }
        catch (Exception ex)
        {
            ErrorText.Text = "Veriler alınamadı: " + ex.Message;
            CountText.Text = "Bağlantı hatası";
        }
        finally { _loading = false; }
    }

    private static string Read(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var field) || field.ValueKind == JsonValueKind.Null)
            return "";
        return field.ValueKind == JsonValueKind.String ? field.GetString() ?? "" : field.ToString();
    }

    private static int ReadNumber(JsonElement value, string name)
    {
        var text = Read(value, name);
        return int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number)
            ? number : 0;
    }

    private void ApplyFilter()
    {
        if (RowsGrid?.ItemsSource is null) return;
        var text = (QueryBox?.Text ?? "").Trim();
        var status = (StatusFilter?.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "Tümü";
        var sort = (SortFilter?.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "Föy";
        var view = CollectionViewSource.GetDefaultView(RowsGrid.ItemsSource);
        view.Filter = obj =>
        {
            if (obj is not OfficeFileItem item) return false;
            var matchesText = string.IsNullOrWhiteSpace(text) ||
                item.FileNo.Contains(text, StringComparison.CurrentCultureIgnoreCase) ||
                item.Client.Contains(text, StringComparison.CurrentCultureIgnoreCase) ||
                item.Title.Contains(text, StringComparison.CurrentCultureIgnoreCase);
            var closed = item.Status.Contains("kapal", StringComparison.CurrentCultureIgnoreCase) ||
                item.Status.Contains("closed", StringComparison.OrdinalIgnoreCase);
            return matchesText && (status == "Tümü" || (status == "Kapalı" ? closed : !closed));
        };
        view.SortDescriptions.Clear();
        var property = sort switch
        {
            "Müvekkil" => nameof(OfficeFileItem.Client),
            "Dosya adı" => nameof(OfficeFileItem.Title),
            _ => nameof(OfficeFileItem.FileNo)
        };
        view.SortDescriptions.Add(new System.ComponentModel.SortDescription(
            property, System.ComponentModel.ListSortDirection.Ascending));
        CountText.Text = $"{view.Cast<object>().Count()} / {_items.Count} dosya listeleniyor";
    }

    private void Filter_Changed(object sender, EventArgs e) => ApplyFilter();
    private void Reset_Click(object sender, RoutedEventArgs e)
    {
        QueryBox.Text = "";
        StatusFilter.SelectedIndex = 0;
        SortFilter.SelectedIndex = 0;
        ApplyFilter();
    }
    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();
    private void OpenFile_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (RowsGrid.SelectedItem is OfficeFileItem file)
            FileOpened?.Invoke(this, file);
    }

    public sealed record OfficeFileItem(
        string FileNo, string Client, string Title, string Status, int CaseCount);
}
