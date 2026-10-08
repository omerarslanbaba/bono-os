using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Threading;

namespace BonoNative;

public partial class MainWindow : Window
{
    const string BaseUrl = "http://127.0.0.1:47831";
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(4) };
    readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(3) };
    readonly ObservableCollection<OfficeFileRow> files = new();
    readonly ObservableCollection<UyapCaseRow> uyapCases = new();
    readonly ObservableCollection<UyapDocumentRow> uyapDocuments = new();
    readonly ObservableCollection<HearingRow> hearings = new();
    Process? coreProcess;
    int selectedUyapCaseId;
    UyapCaseRow? selectedUyapCase;
    bool refreshing;

    public MainWindow()
    {
        InitializeComponent();
        FilesGrid.ItemsSource = files;
        UyapGrid.ItemsSource = uyapCases;
        UyapDocumentsGrid.ItemsSource = uyapDocuments;
        HearingsGrid.ItemsSource = hearings;
        HomeHearingsGrid.ItemsSource = hearings;
        SetActiveNav(NavHome);
        Loaded += async (_, _) => await BootAsync();
        Closed += (_, _) => Cleanup();
        timer.Tick += async (_, _) => await RefreshLightAsync();
    }

    async Task BootAsync()
    {
        try
        {
            FooterStatus.Text = "BONO Core kontrol ediliyor…";
            await EnsureCoreAsync();
            await RefreshAllAsync();
            timer.Start();
            FooterStatus.Text = "BONO OS hazır";
        }
        catch (Exception ex)
        {
            SetCore(false, "Bağlantı yok");
            FooterStatus.Text = ex.Message;
            MessageBox.Show("BONO OS başlatılamadı.\n\n" + ex.Message, "BONO OS", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    async Task EnsureCoreAsync()
    {
        if (await CoreHealthyAsync())
        {
            SetCore(true, "Çalışıyor");
            return;
        }

        var home = FindBonoHome();
        var psi = new ProcessStartInfo
        {
            FileName = "node",
            Arguments = "bridge/server.js",
            WorkingDirectory = home,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        coreProcess = Process.Start(psi) ?? throw new InvalidOperationException("BONO Core başlatılamadı.");
        coreProcess.BeginOutputReadLine();
        coreProcess.BeginErrorReadLine();

        for (var i = 0; i < 50; i++)
        {
            if (await CoreHealthyAsync())
            {
                SetCore(true, "Çalışıyor");
                return;
            }
            await Task.Delay(250);
        }
        throw new TimeoutException("BONO Core yanıt vermedi.");
    }

    async Task<bool> CoreHealthyAsync()
    {
        try
        {
            using var res = await http.GetAsync(BaseUrl + "/health");
            return res.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    void SetCore(bool ok, string text)
    {
        CoreDot.Fill = new SolidColorBrush(ok ? Color.FromRgb(78, 196, 116) : Color.FromRgb(224, 90, 90));
        CoreStatusText.Text = text;
        SystemCoreText.Text = ok ? "Çalışıyor · yerel çekirdek servis erişilebilir." : "Erişilemiyor.";
    }

    async Task<JsonDocument> GetJsonAsync(string path)
    {
        using var res = await http.GetAsync(BaseUrl + path);
        res.EnsureSuccessStatusCode();
        var bytes = await res.Content.ReadAsByteArrayAsync();
        return JsonDocument.Parse(bytes);
    }

    async Task RefreshAllAsync()
    {
        if (refreshing) return;
        refreshing = true;
        try
        {
            SetCore(await CoreHealthyAsync(), "Çalışıyor");
            await Task.WhenAll(LoadSummaryAsync(), LoadFilesAsync(), LoadUyapAsync(), LoadHearingsAsync());
            FooterStatus.Text = "Son yenileme: " + DateTime.Now.ToString("HH:mm:ss");
        }
        catch (Exception ex)
        {
            FooterStatus.Text = "Yenileme hatası: " + ex.Message;
        }
        finally { refreshing = false; }
    }

    async Task RefreshLightAsync()
    {
        if (refreshing) return;
        refreshing = true;
        try
        {
            var healthy = await CoreHealthyAsync();
            if (!healthy)
            {
                FooterStatus.Text = "BONO Core yeniden başlatılıyor…";
                await EnsureCoreAsync();
                healthy = await CoreHealthyAsync();
            }
            SetCore(healthy, healthy ? "Çalışıyor" : "Bağlantı yok");
            if (healthy)
            {
                await LoadSummaryAsync();
                if (UyapDetailPage.Visibility == Visibility.Visible) await LoadUyapCaseDetailAsync(false);
                else if (UyapPage.Visibility == Visibility.Visible) await LoadUyapAsync();
                else if (OfficeFilesView.Visibility == Visibility.Visible) await OfficeFilesView.RefreshAsync();
                else if (HearingsPage.Visibility == Visibility.Visible || HomePage.Visibility == Visibility.Visible) await LoadHearingsAsync();
                FooterStatus.Text = "Canlı · " + DateTime.Now.ToString("HH:mm:ss");
            }
        }
        catch { }
        finally { refreshing = false; }
    }

    async Task LoadSummaryAsync()
    {
        using var summary = await GetJsonAsync("/api/summary");
        var s = summary.RootElement;
        CardFiles.Text = Num(s, "officeFiles").ToString();

        using var archive = await GetJsonAsync("/api/uyap/archive/status");
        var a = archive.RootElement;
        CardCases.Text = Num(a, "cases").ToString();
        CardIndexed.Text = Num(a, "indexed").ToString();
        CardQueue.Text = Num(a, "downloadQueued").ToString();
        UyapQueueText.Text = Num(a, "downloadQueued").ToString();
        UyapFailedText.Text = Num(a, "failedCommands").ToString();

        using var sessionDoc = await GetJsonAsync("/api/uyap/session");
        var sessionRoot = sessionDoc.RootElement;
        var session = sessionRoot.TryGetProperty("session", out var sessionEl) ? sessionEl : default;
        var rate = sessionRoot.TryGetProperty("rate", out var rateEl) ? rateEl : default;
        var state = session.ValueKind == JsonValueKind.Object ? Str(session, "state") : "unknown";
        var documentState = session.ValueKind == JsonValueKind.Object ? Str(session, "documentDownloadState") : "unknown";
        var lastStatus = rate.ValueKind == JsonValueKind.Object ? Num(rate, "last_status") : 0;

        if (state == "ready" && documentState == "ready")
        {
            UyapStateText.Text = "Bağlı · Evrak motoru hazır";
            UyapStateText.Foreground = new SolidColorBrush(Color.FromRgb(78, 196, 116));
        }
        else if (state == "ready")
        {
            var detail = documentState switch
            {
                "paused_token_refresh" => "evrak bilgileri yenileniyor",
                "paused_viewer_html" => "belge görüntüleyici bekliyor",
                "paused_manual" => "indirmeler bekletiliyor",
                _ => documentState.Replace("_", " ")
            };
            UyapStateText.Text = "Bağlı · " + detail;
            UyapStateText.Foreground = new SolidColorBrush(Color.FromRgb(224, 177, 75));
        }
        else if (state == "login_required")
        {
            UyapStateText.Text = "UYAP girişi bekleniyor";
            UyapStateText.Foreground = new SolidColorBrush(Color.FromRgb(224, 177, 75));
        }
        else
        {
            UyapStateText.Text = state;
            UyapStateText.Foreground = new SolidColorBrush(Color.FromRgb(224, 177, 75));
        }
        SystemUyapText.Text = $"Oturum: {state} · Evrak motoru: {documentState} · HTTP: {lastStatus} · Kuyruk: {Num(a, "downloadQueued")}";
    }

    async Task LoadFilesAsync()
    {
        using var doc = await GetJsonAsync("/api/office-files?limit=500");
        var next = new List<OfficeFileRow>();
        foreach (var x in doc.RootElement.EnumerateArray())
        {
            next.Add(new OfficeFileRow(
                Str(x, "file_no"),
                Str(x, "client_name"),
                Str(x, "title"),
                FriendlyStatus(Str(x, "status")),
                Num(x, "case_count")
            ));
        }
        Replace(files, next);
        ApplyFilesFilter();
    }

    async Task LoadUyapAsync()
    {
        using var doc = await GetJsonAsync("/api/uyap/cases");
        var next = new List<UyapCaseRow>();
        foreach (var x in doc.RootElement.EnumerateArray())
        {
            next.Add(new UyapCaseRow(
                Num(x, "id"),
                Str(x, "office_file_no"),
                Str(x, "court"),
                Str(x, "court_file_no"),
                Str(x, "case_type"),
                Str(x, "status"),
                Num(x, "remote_count"),
                Num(x, "indexed_count")
            ));
        }
        Replace(uyapCases, next);
        ApplyUyapFilter();
    }

    async Task<JsonDocument> PostJsonAsync(string path, string json = "{}")
    {
        using var body = new StringContent(json, Encoding.UTF8, "application/json");
        using var res = await http.PostAsync(BaseUrl + path, body);
        res.EnsureSuccessStatusCode();
        var bytes = await res.Content.ReadAsByteArrayAsync();
        return JsonDocument.Parse(bytes);
    }

    async Task OpenUyapCaseAsync(UyapCaseRow row)
    {
        selectedUyapCaseId = row.Id;
        selectedUyapCase = row;
        ShowPage(UyapDetailPage, "UYAP Dosyası", row.Court + " · " + row.FileNo);
        SetActiveNav(NavUyap);
        UyapDetailTitle.Text = row.Court;
        UyapDetailSubtitle.Text = string.Join(" · ", new[] { row.FileNo, row.CaseType, string.IsNullOrWhiteSpace(row.Foy) ? null : "FÖY " + row.Foy }.Where(x => !string.IsNullOrWhiteSpace(x)));
        await LoadUyapCaseDetailAsync(true);
    }

    async Task LoadUyapCaseDetailAsync(bool includeDocuments)
    {
        if (selectedUyapCaseId <= 0) return;
        using var summary = await GetJsonAsync($"/api/uyap/cases/{selectedUyapCaseId}/download-summary");
        var s = summary.RootElement;
        var total = Num(s, "total");
        var existing = Num(s, "existing");
        var missing = Num(s, "missingDownloadable");
        var queued = Num(s, "queued");
        DetailTotal.Text = total.ToString();
        DetailExisting.Text = existing.ToString();
        DetailMissing.Text = missing.ToString();
        DetailQueued.Text = queued.ToString();
        DetailLastSync.Text = "Son senkron: " + (Str(s, "lastSync") is var last && !string.IsNullOrWhiteSpace(last) ? last : "henüz yok");
        DownloadMissingButton.Content = missing > 200 ? $"Eksik Evrakları İndir (200 / {missing})" : $"Eksik Evrakları İndir ({missing})";
        DownloadMissingButton.IsEnabled = missing > 0;

        if (!includeDocuments) return;
        using var docs = await GetJsonAsync($"/api/uyap/cases/{selectedUyapCaseId}/remote-documents");
        var next = new List<UyapDocumentRow>();
        foreach (var x in docs.RootElement.EnumerateArray())
        {
            next.Add(new UyapDocumentRow(
                Str(x, "document_date"),
                Str(x, "remote_title"),
                Str(x, "document_type"),
                FriendlyDocumentStatus(Str(x, "status"))
            ));
        }
        Replace(uyapDocuments, next);
    }

    async void OpenUyapCase_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not System.Windows.Controls.Button b || !int.TryParse(b.Tag?.ToString(), out var id)) return;
        var row = uyapCases.FirstOrDefault(x => x.Id == id);
        if (row != null) await OpenUyapCaseAsync(row);
    }

    async void BackToUyapCases_Click(object sender, RoutedEventArgs e)
    {
        selectedUyapCaseId = 0;
        selectedUyapCase = null;
        ShowPage(UyapPage, "UYAP Dosyaları", "UYAP dosyaları ve evrak arşiv durumu");
        SetActiveNav(NavUyap);
        await LoadUyapAsync();
    }

    async void SyncCaseDocuments_Click(object sender, RoutedEventArgs e)
    {
        if (selectedUyapCaseId <= 0) return;
        try
        {
            SyncCaseDocumentsButton.IsEnabled = false;
            FooterStatus.Text = "Dosyanın UYAP evrak listesi yenileniyor…";
            using var _ = await PostJsonAsync($"/api/uyap/cases/{selectedUyapCaseId}/sync-documents");
            FooterStatus.Text = "Evrak senkronu sorgu kuyruğuna alındı.";
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "UYAP Evrak Senkronu", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally { SyncCaseDocumentsButton.IsEnabled = true; }
    }

    async void DownloadMissing_Click(object sender, RoutedEventArgs e)
    {
        if (selectedUyapCaseId <= 0) return;
        try
        {
            DownloadMissingButton.IsEnabled = false;
            FooterStatus.Text = "Bu dosyanın eksik evrakları kuyruğa ekleniyor…";
            using var result = await PostJsonAsync($"/api/uyap/cases/{selectedUyapCaseId}/download-missing", "{\"limit\":200}");
            var queued = Num(result.RootElement, "queued");
            FooterStatus.Text = queued > 0
                ? $"{queued} evrak indirme kuyruğuna eklendi."
                : "İndirilecek yeni evrak bulunamadı.";
            await LoadUyapCaseDetailAsync(true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "UYAP Evrak İndirme", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally { DownloadMissingButton.IsEnabled = true; }
    }

    async Task LoadHearingsAsync()
    {
        using var doc = await GetJsonAsync("/api/hearings/upcoming?limit=100");
        var next = new List<(DateTime Sort, HearingRow Row)>();
        foreach (var x in doc.RootElement.EnumerateArray())
        {
            var raw = Str(x, "starts_at");
            var dt = ParseSqlDate(raw) ?? DateTime.MaxValue;
            next.Add((dt, new HearingRow(
                dt == DateTime.MaxValue ? raw : dt.ToString("dd.MM.yyyy HH:mm"),
                Str(x, "court"),
                Str(x, "court_file_no"),
                Str(x, "hearing_type"),
                Str(x, "file_no")
            )));
        }
        Replace(hearings, next.OrderBy(x => x.Sort).Select(x => x.Row));
        if (next.Count > 0 && next[0].Sort != DateTime.MaxValue) HearingCalendar.DisplayDate = next[0].Sort;
    }

    static DateTime? ParseSqlDate(string s)
    {
        if (DateTime.TryParse(s, out var dt)) return dt;
        return null;
    }

    static string Str(JsonElement e, string p)
    {
        if (!e.TryGetProperty(p, out var v) || v.ValueKind == JsonValueKind.Null) return "";
        return v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "") : v.ToString();
    }

    static int Num(JsonElement e, string p)
    {
        if (!e.TryGetProperty(p, out var v) || v.ValueKind == JsonValueKind.Null) return 0;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n)) return n;
        return int.TryParse(v.ToString(), out var x) ? x : 0;
    }

    static string FriendlyStatus(string s) => (s ?? "").Trim().ToLowerInvariant() switch
    {
        "needs_verification" => "Kontrol Bekliyor",
        "active" => "Aktif",
        "open" => "Açık",
        "closed" => "Kapalı",
        "archived" => "Arşiv",
        "" => "—",
        _ => (s ?? "").Replace("_", " ")
    };

    static string FriendlyDocumentStatus(string s) => (s ?? "").Trim().ToLowerInvariant() switch
    {
        "discovered" => "Eksik",
        "download_queued" => "Kuyrukta",
        "downloaded" => "İndirildi",
        "indexed" => "Mevcut",
        "filed" => "Dosyalandı",
        "summarized" => "Özetlendi",
        "skipped" => "Atlandı",
        "review" => "İnceleme",
        "" => "—",
        _ => (s ?? "").Replace("_", " ")
    };

    static void Replace<T>(ObservableCollection<T> target, IEnumerable<T> source)
    {
        target.Clear();
        foreach (var x in source) target.Add(x);
    }

    async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshAllAsync();

    async void ArchiveStart_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            FooterStatus.Text = "UYAP dosya sorguları başlatılıyor…";
            using var body = new StringContent("{}", Encoding.UTF8, "application/json");
            using var res = await http.PostAsync(BaseUrl + "/api/uyap/archive/start", body);
            res.EnsureSuccessStatusCode();
            await LoadSummaryAsync();
            FooterStatus.Text = "UYAP dosya sorguları çalışıyor.";
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "UYAP Arşiv", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    void FilesSearch_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e) => ApplyFilesFilter();
    void UyapSearch_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e) => ApplyUyapFilter();

    void ApplyFilesFilter()
    {
        if (FilesGrid?.ItemsSource == null) return;
        var q = (FilesSearch.Text ?? "").Trim();
        CollectionViewSource.GetDefaultView(FilesGrid.ItemsSource).Filter = o =>
        {
            if (string.IsNullOrWhiteSpace(q)) return true;
            var x = (OfficeFileRow)o;
            return Contains(x.FileNo, q) || Contains(x.Client, q) || Contains(x.Title, q);
        };
    }

    void CaseFilter_Changed(object sender, System.Windows.Controls.SelectionChangedEventArgs e) => ApplyUyapFilter();

    void ResetCaseFilters_Click(object sender, RoutedEventArgs e)
    {
        CaseTypeFilter.SelectedIndex = 0;
        CaseStatusFilter.SelectedIndex = 0;
        UyapSearch.Text = "";
        ApplyUyapFilter();
    }

    void ApplyUyapFilter()
    {
        if (UyapGrid?.ItemsSource == null) return;
        var q = (UyapSearch.Text ?? "").Trim();
        CollectionViewSource.GetDefaultView(UyapGrid.ItemsSource).Filter = o =>
        {
            var x = (UyapCaseRow)o;
            var category = (CaseTypeFilter?.SelectedItem as System.Windows.Controls.ComboBoxItem)?.Content?.ToString() ?? "Tümü";
            var state = (CaseStatusFilter?.SelectedItem as System.Windows.Controls.ComboBoxItem)?.Content?.ToString() ?? "Tümü";
            var description = (x.Court + " " + x.CaseType).ToLowerInvariant();
            var matchesType = category == "Tümü" || category switch
            {
                "Ceza" => description.Contains("ceza") || description.Contains("savcılık") || description.Contains("soruşturma") || description.Contains("infaz"),
                "İcra" => description.Contains("icra") || description.Contains("iflas"),
                "İdare" => description.Contains("idare") || description.Contains("vergi"),
                "Aile" => description.Contains("aile"),
                "İş" => description.Contains("iş mah") || description.Contains("işçilik"),
                "Hukuk" => description.Contains("hukuk") || description.Contains("ticaret"),
                _ => true
            };
            var status = (x.Status ?? "").ToLowerInvariant();
            var closed = status.Contains("kapal") || status.Contains("closed") || status.Contains("archiv") || status.Contains("kesinleş");
            var matchesState = state == "Tümü" || (state == "Kapalı" ? closed : !closed);
            return matchesType && matchesState && (string.IsNullOrWhiteSpace(q) ||
                Contains(x.Foy, q) || Contains(x.Court, q) || Contains(x.FileNo, q) || Contains(x.CaseType, q));
        };
    }

    static bool Contains(string? value, string q) =>
        (value ?? "").Contains(q, StringComparison.CurrentCultureIgnoreCase);

    void ShowPage(UIElement page, string title, string subtitle)
    {
        HomePage.Visibility = Visibility.Collapsed;
        FilesPage.Visibility = Visibility.Collapsed;
        OfficeFilesView.Visibility = Visibility.Collapsed;
        UyapPage.Visibility = Visibility.Collapsed;
        UyapDetailPage.Visibility = Visibility.Collapsed;
        HearingsPage.Visibility = Visibility.Collapsed;
        SystemPage.Visibility = Visibility.Collapsed;
        if (ReferenceEquals(page, FilesPage)) page = OfficeFilesView;
        page.Visibility = Visibility.Visible;
        PageTitle.Text = title;
        PageSubtitle.Text = subtitle;
    }

    void SetActiveNav(System.Windows.Controls.Button active)
    {
        var normalBg = new SolidColorBrush(Color.FromRgb(23, 24, 28));
        var normalFg = new SolidColorBrush(Color.FromRgb(244, 246, 247));
        var normalBorder = new SolidColorBrush(Color.FromRgb(41, 45, 49));
        var activeBg = new SolidColorBrush(Color.FromRgb(31, 47, 56));
        var activeFg = new SolidColorBrush(Color.FromRgb(25, 174, 230));
        foreach (var b in new[] { NavHome, NavFiles, NavUyap, NavHearings, NavSystem })
        {
            b.Background = normalBg;
            b.Foreground = normalFg;
            b.BorderBrush = normalBorder;
            b.FontWeight = FontWeights.Normal;
        }
        active.Background = activeBg;
        active.Foreground = activeFg;
        active.BorderBrush = activeFg;
        active.FontWeight = FontWeights.SemiBold;
    }

    async void NavHome_Click(object sender, RoutedEventArgs e)
    {
        ShowPage(HomePage, "Bugün", "Ofis ve UYAP akışının canlı özeti");
        SetActiveNav(NavHome);
        await LoadSummaryAsync(); await LoadHearingsAsync();
    }
    async void NavFiles_Click(object sender, RoutedEventArgs e)
    {
        ShowPage(FilesPage, "Dosyalarım", "FÖY numarası, müvekkil veya dosya adıyla ara");
        SetActiveNav(NavFiles);
        await OfficeFilesView.RefreshAsync();
    }
    async void NavUyap_Click(object sender, RoutedEventArgs e)
    {
        ShowPage(UyapPage, "UYAP Dosyaları", "UYAP dosyaları ve evrak arşiv durumu");
        SetActiveNav(NavUyap);
        await LoadSummaryAsync(); await LoadUyapAsync();
    }
    async void NavHearings_Click(object sender, RoutedEventArgs e)
    {
        ShowPage(HearingsPage, "Duruşmalar", "Yaklaşan duruşmalar");
        SetActiveNav(NavHearings);
        await LoadHearingsAsync();
    }
    async void NavSystem_Click(object sender, RoutedEventArgs e)
    {
        ShowPage(SystemPage, "Sistem", "BONO Core ve UYAP bağlantı durumu");
        SetActiveNav(NavSystem);
        await LoadSummaryAsync();
    }

    // The office workspace exposes its selection through an event; UYAP operations remain untouched.
    async void OfficeFilesView_FileOpened(object sender, BonoNative.Views.OfficeFilesWorkspace.OfficeFileItem file)
    {
        ShowPage(UyapPage, "Bağlı UYAP Dosyaları", file.FileNo + " · " + file.Client);
        SetActiveNav(NavUyap);
        UyapSearch.Text = file.FileNo;
        await LoadUyapAsync();
    }

    // Satır etkileşimleri aynı native pencere içinde ilgili kayıtları açar.
    async void FileRow_DoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (FilesGrid.SelectedItem is not OfficeFileRow row) return;
        ShowPage(UyapPage, "Dosyalarım", row.FileNo + " · " + row.Client);
        SetActiveNav(NavUyap);
        UyapSearch.Text = row.FileNo;
        await LoadUyapAsync();
    }

    async void UyapRow_DoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (UyapGrid.SelectedItem is not UyapCaseRow row) return;
        await OpenUyapCaseAsync(row);
    }

    async void HearingRow_DoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        var grid = sender as System.Windows.Controls.DataGrid;
        if (grid?.SelectedItem is not HearingRow row) return;
        ShowPage(UyapPage, "Duruşma Dosyası", row.DateText + " · " + row.Court);
        SetActiveNav(NavUyap);
        UyapSearch.Text = row.FileNo;
        await LoadUyapAsync();
    }

    void GlobalSearch_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e)
    {
        if (FilesSearch == null || GlobalSearch == null) return;
        FilesSearch.Text = GlobalSearch.Text;
        OfficeFilesView.SetSearch(GlobalSearch.Text);
        if (!string.IsNullOrWhiteSpace(GlobalSearch.Text))
        {
            ShowPage(FilesPage, "Dosyalarım", "Föy, müvekkil veya dosya adına göre arama");
            SetActiveNav(NavFiles);
        }
    }

    void HearingCalendar_SelectedDatesChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        if (HearingCalendar?.SelectedDate is not DateTime date || HearingsGrid?.ItemsSource == null) return;
        var view = CollectionViewSource.GetDefaultView(HearingsGrid.ItemsSource);
        view.Filter = item => item is HearingRow h && (DateTime.TryParseExact(h.DateText,
            "dd.MM.yyyy HH:mm", System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None, out var dt) && dt.Date == date.Date);
        if (view.IsEmpty) view.Filter = null;
    }

    static string FindBonoHome()
    {
        var configured = Environment.GetEnvironmentVariable("BONO_HOME");
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(Path.Combine(configured, "bridge", "server.js")))
            return configured;
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var candidate = Path.Combine(local, "BONO OS");
        if (File.Exists(Path.Combine(candidate, "bridge", "server.js"))) return candidate;
        throw new DirectoryNotFoundException("BONO OS çekirdek klasörü bulunamadı.");
    }

    void Cleanup()
    {
        timer.Stop();
        http.Dispose();
        // Core arka planda yaşamaya devam eder; UYAP indirmeleri pencere kapanınca durmaz.
    }

    public record OfficeFileRow(string FileNo, string Client, string Title, string Status, int CaseCount);
    public record UyapCaseRow(int Id, string Foy, string Court, string FileNo, string CaseType, string Status, int RemoteCount, int IndexedCount);
    public record UyapDocumentRow(string Date, string Title, string Type, string Status);
    public record HearingRow(string DateText, string Court, string FileNo, string Type, string Foy);
}


