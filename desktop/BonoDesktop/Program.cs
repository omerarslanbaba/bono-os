using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BonoDesktop;

internal static class Program
{
    private const string BonoUrl = "http://127.0.0.1:47831";
    private const string MutexName = @"Local\BONO_OS_DESKTOP";
    private const string ActivationEventName = @"Local\BONO_OS_ACTIVATE";

    [STAThread]
    static void Main(string[] args)
    {
        using var mutex = new Mutex(true, MutexName, out var createdNew);
        if (!createdNew)
        {
            try { EventWaitHandle.OpenExisting(ActivationEventName).Set(); }
            catch { }
            return;
        }

        using var activationEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ActivationEventName);
        ApplicationConfiguration.Initialize();
        Application.ThreadException += (_, e) => DesktopLog.Write("ThreadException", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => DesktopLog.Write("UnhandledException", e.ExceptionObject as Exception);
        var background = args.Any(a => string.Equals(a, "--background", StringComparison.OrdinalIgnoreCase));
        using var form = new BonoForm(background);
        var activationRegistration = ThreadPool.RegisterWaitForSingleObject(
            activationEvent,
            (_, _) =>
            {
                try
                {
                    if (!form.IsDisposed && form.IsHandleCreated)
                        form.BeginInvoke(new Action(form.RestoreWindow));
                }
                catch { }
            },
            null,
            Timeout.Infinite,
            false);
        try { Application.Run(form); }
        finally { activationRegistration.Unregister(null); }
    }

    static class DesktopLog
    {
        public static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BONO OS");
        public static readonly string LogDir = Path.Combine(Root, "logs");
        public static readonly string LogFile = Path.Combine(LogDir, "desktop.log");
        public static void Write(string message, Exception? ex = null)
        {
            try
            {
                Directory.CreateDirectory(LogDir);
                File.AppendAllText(LogFile, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} | {message}{(ex == null ? "" : " | " + ex)}{Environment.NewLine}");
            }
            catch { }
        }
    }

    sealed class BonoForm : Form
    {
        readonly WebView2 web = new();
        readonly NotifyIcon tray = new();
        readonly System.Windows.Forms.Timer watchdog = new() { Interval = 30000 };
        readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(2) };
        readonly bool startHidden;
        Process? coreProcess;
        bool exiting;
        bool watchdogBusy;

        public BonoForm(bool startHidden)
        {
            this.startHidden = startHidden;
            Text = "BONO OS";
            Width = 1480;
            Height = 940;
            MinimumSize = new Size(1100, 720);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(9, 11, 12);
            Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

            web.Dock = DockStyle.Fill;
            Controls.Add(web);

            tray.Icon = Icon;
            tray.Text = "BONO OS";
            tray.Visible = true;
            tray.DoubleClick += (_, _) => RestoreWindow();
            var menu = new ContextMenuStrip();
            menu.Items.Add("BONO OS'u Aç", null, (_, _) => RestoreWindow());
            menu.Items.Add("Bugün", null, (_, _) => Navigate("#today"));
            menu.Items.Add("Duruşma Kokpiti", null, (_, _) => Navigate("#hearings"));
            menu.Items.Add("Otomasyonlar", null, (_, _) => Navigate("#automations"));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Çıkış", null, (_, _) => { exiting = true; tray.Visible = false; Application.Exit(); });
            tray.ContextMenuStrip = menu;

            FormClosing += (_, e) =>
            {
                if (!exiting)
                {
                    e.Cancel = true;
                    Hide();
                }
            };
            FormClosed += (_, _) => Cleanup();
            Shown += async (_, _) => await BootAsync();

            watchdog.Tick += async (_, _) => await WatchdogAsync();
        }

        void Navigate(string hash)
        {
            RestoreWindow();
            try { web.CoreWebView2?.Navigate(BonoUrl + "/" + hash); } catch { }
        }

        public void RestoreWindow()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        async Task BootAsync()
        {
            try
            {
                RegisterStartup();
                await ApplyPendingRestoreIfSafeAsync();
                await EnsureCoreAsync();
                var env = await CoreWebView2Environment.CreateAsync();
                await web.EnsureCoreWebView2Async(env);
                web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.Settings.IsZoomControlEnabled = false;
                web.CoreWebView2.NewWindowRequested += (_, e) =>
                {
                    e.Handled = true;
                    try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
                };
                web.Source = new Uri(BonoUrl);
                watchdog.Start();
                await ShowMorningBriefOnceAsync();
                if (startHidden) Hide();
                DesktopLog.Write("BONO OS Desktop ready");
            }
            catch (Exception ex)
            {
                DesktopLog.Write("Boot failed", ex);
                MessageBox.Show("BONO OS başlatılamadı.\n\n" + ex.Message, "BONO OS", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        void RegisterStartup()
        {
            try
            {
                using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
                var exe = Environment.ProcessPath ?? Application.ExecutablePath;
                key?.DeleteValue("BONO Hukuk", false);
                key?.SetValue("BONO OS", $"\"{exe}\" --background");
            }
            catch (Exception ex) { DesktopLog.Write("Startup registration failed", ex); }
        }

        async Task ApplyPendingRestoreIfSafeAsync()
        {
            var home = FindBonoHome();
            var marker = Path.Combine(home, "data", "pending_restore.json");
            if (!File.Exists(marker)) return;

            if (await CoreHealthyAsync())
            {
                DesktopLog.Write("Pending restore deferred because Core is still running");
                return;
            }

            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(marker));
                var root = doc.RootElement;
                var dbPath = root.TryGetProperty("dbPath", out var dbEl) ? dbEl.GetString() : null;
                var sourcePath = root.TryGetProperty("sourcePath", out var srcEl) && srcEl.ValueKind != JsonValueKind.Null ? srcEl.GetString() : null;
                if (string.IsNullOrWhiteSpace(dbPath) || !File.Exists(dbPath)) throw new FileNotFoundException("Geri yüklenecek DB bulunamadı.", dbPath);

                var dataDir = Path.Combine(home, "data");
                var backupDir = Path.Combine(dataDir, "backups");
                Directory.CreateDirectory(backupDir);
                var currentDb = Path.Combine(dataDir, "bono.db");
                if (File.Exists(currentDb))
                {
                    var safety = Path.Combine(backupDir, "pre_restore_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".db");
                    File.Copy(currentDb, safety, true);
                }

                File.Copy(dbPath, currentDb, true);
                foreach (var suffix in new[] { "-wal", "-shm" })
                {
                    var p = currentDb + suffix;
                    if (File.Exists(p)) File.Delete(p);
                }

                if (!string.IsNullOrWhiteSpace(sourcePath) && Directory.Exists(sourcePath))
                    RestoreSourceSnapshot(sourcePath!, home);

                File.Delete(marker);
                DesktopLog.Write("Pending restore applied successfully");
                tray.ShowBalloonTip(5000, "BONO OS", "Geri dönüş noktası başarıyla uygulandı.", ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                DesktopLog.Write("Pending restore failed", ex);
                throw;
            }
        }

        static void RestoreSourceSnapshot(string snapshotRoot, string projectRoot)
        {
            foreach (var dir in new[] { "bridge", "web", "extension", "scripts", "desktop" })
            {
                var src = Path.Combine(snapshotRoot, dir);
                if (Directory.Exists(src)) CopyDirectory(src, Path.Combine(projectRoot, dir));
            }
            foreach (var file in new[] { "package.json", "README.md", "SECURITY.md" })
            {
                var src = Path.Combine(snapshotRoot, file);
                if (File.Exists(src)) File.Copy(src, Path.Combine(projectRoot, file), true);
            }
        }

        static void CopyDirectory(string source, string destination)
        {
            Directory.CreateDirectory(destination);
            foreach (var file in Directory.GetFiles(source))
                File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
            foreach (var dir in Directory.GetDirectories(source))
                CopyDirectory(dir, Path.Combine(destination, Path.GetFileName(dir)));
        }

        async Task<bool> CoreHealthyAsync()
        {
            try
            {
                using var res = await http.GetAsync(BonoUrl + "/health");
                return res.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        async Task EnsureCoreAsync()
        {
            if (await CoreHealthyAsync()) return;

            if (coreProcess is { HasExited: false })
            {
                try { coreProcess.Kill(true); coreProcess.WaitForExit(1500); } catch { }
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
                RedirectStandardError = true,
                RedirectStandardOutput = true
            };
            coreProcess = Process.Start(psi) ?? throw new InvalidOperationException("BONO Core başlatılamadı.");
            coreProcess.OutputDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) DesktopLog.Write("CORE " + e.Data); };
            coreProcess.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) DesktopLog.Write("CORE ERR " + e.Data); };
            coreProcess.BeginOutputReadLine();
            coreProcess.BeginErrorReadLine();

            for (var i = 0; i < 50; i++)
            {
                if (await CoreHealthyAsync()) return;
                await Task.Delay(250);
            }
            throw new TimeoutException("BONO Core zamanında yanıt vermedi.");
        }

        async Task WatchdogAsync()
        {
            if (watchdogBusy || exiting) return;
            watchdogBusy = true;
            try
            {
                if (!await CoreHealthyAsync())
                {
                    DesktopLog.Write("Core health failed; restarting");
                    await EnsureCoreAsync();
                    if (web.CoreWebView2 != null) web.CoreWebView2.Navigate(BonoUrl);
                    tray.ShowBalloonTip(3500, "BONO OS", "Çekirdek servis yeniden başlatıldı.", ToolTipIcon.Warning);
                }
            }
            catch (Exception ex) { DesktopLog.Write("Watchdog error", ex); }
            finally { watchdogBusy = false; }
        }

        async Task ShowMorningBriefOnceAsync()
        {
            try
            {
                var stateDir = DesktopLog.Root;
                Directory.CreateDirectory(stateDir);
                var marker = Path.Combine(stateDir, "morning-notified.txt");
                var today = DateTime.Today.ToString("yyyy-MM-dd");
                if (File.Exists(marker) && File.ReadAllText(marker).Trim() == today) return;

                var json = await http.GetStringAsync(BonoUrl + "/api/morning-brief");
                using var doc = JsonDocument.Parse(json);
                var title = doc.RootElement.TryGetProperty("title", out var t) ? t.GetString() : "BONO OS Sabah Özeti";
                var body = doc.RootElement.TryGetProperty("body", out var b) ? b.GetString() : "BONO OS hazır.";
                tray.ShowBalloonTip(7000, title ?? "BONO OS Sabah Özeti", body ?? "BONO OS hazır.", ToolTipIcon.Info);
                File.WriteAllText(marker, today);
            }
            catch (Exception ex) { DesktopLog.Write("Morning brief failed", ex); }
        }

        static string FindBonoHome()
        {
            var configured = Environment.GetEnvironmentVariable("BONO_HOME");
            if (!string.IsNullOrWhiteSpace(configured) && File.Exists(Path.Combine(configured, "bridge", "server.js")))
                return configured;

            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var candidate = Path.Combine(localAppData, "BONO OS");
            if (File.Exists(Path.Combine(candidate, "bridge", "server.js"))) return candidate;

            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                if (File.Exists(Path.Combine(dir.FullName, "bridge", "server.js"))) return dir.FullName;
                dir = dir.Parent;
            }
            throw new DirectoryNotFoundException("BONO OS uygulama klasörü bulunamadı.");
        }

        void Cleanup()
        {
            watchdog.Stop();
            tray.Visible = false;
            tray.Dispose();
            web.Dispose();
            http.Dispose();
            if (coreProcess is { HasExited: false })
            {
                try { coreProcess.Kill(true); } catch { }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                watchdog.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
