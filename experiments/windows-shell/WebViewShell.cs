using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// An isolated rendering experiment. Deliberately exposes no paseoDesktop or native IPC bridge.
internal sealed class WebViewShell : Form
{
    private readonly WebView2 view = new WebView2();
    private readonly Stopwatch elapsed = Stopwatch.StartNew();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly Uri appUri;
    private readonly string output;
    private readonly string profile;
    private readonly string probe;
    private readonly Timer deadline = new Timer();
    private bool observed;

    private WebViewShell(string[] args)
    {
        appUri = new Uri(args[0]);
        if (appUri.Scheme != "https" && !(appUri.Scheme == "http" && appUri.IsLoopback))
            throw new ArgumentException("Use HTTPS or loopback HTTP for the app URL.");
        output = Path.GetFullPath(args[1]);
        profile = Path.GetFullPath(args[2]);
        probe = File.ReadAllText(args[3]);
        Directory.CreateDirectory(output);
        Text = "Paseo - WebView2 evaluation";
        ClientSize = new System.Drawing.Size(1200, 800);
        StartPosition = FormStartPosition.CenterScreen;
        view.Dock = DockStyle.Fill;
        Controls.Add(view);
        deadline.Interval = 45000;
        deadline.Tick += delegate { Record("timeout", null); Environment.ExitCode = 1; Close(); };
        Shown += async delegate {
            try { await StartView(); }
            catch (Exception error) { Record("error", error.ToString()); Environment.ExitCode = 1; Close(); }
        };
        FormClosed += delegate { deadline.Dispose(); view.Dispose(); };
    }

    private void Record(string kind, object data)
    {
        File.AppendAllText(Path.Combine(output, "events.jsonl"), json.Serialize(new {
            kind = kind, elapsedMs = elapsed.ElapsedMilliseconds, data = data
        }) + Environment.NewLine);
    }

    private bool IsAppOrigin(Uri uri)
    {
        return uri.Scheme == appUri.Scheme && uri.Host == appUri.Host && uri.Port == appUri.Port;
    }

    private static void OpenExternal(string value)
    {
        Uri uri;
        if (Uri.TryCreate(value, UriKind.Absolute, out uri) &&
            (uri.Scheme == "https" || uri.Scheme == "http"))
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    private async Task StartView()
    {
        deadline.Start();
        var environment = await CoreWebView2Environment.CreateAsync(null, profile);
        await view.EnsureCoreWebView2Async(environment);
        Record("engine", environment.BrowserVersionString);
        view.CoreWebView2.Settings.AreHostObjectsAllowed = false;
        view.CoreWebView2.Settings.IsWebMessageEnabled = false;
        view.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) {
            e.State = CoreWebView2PermissionState.Deny;
        };
        view.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
            var uri = new Uri(e.Uri);
            if (!IsAppOrigin(uri)) {
                e.Cancel = true;
                if (e.IsUserInitiated) OpenExternal(e.Uri);
            }
        };
        view.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) {
            e.Handled = true;
            if (e.IsUserInitiated) OpenExternal(e.Uri);
        };
        view.CoreWebView2.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs e) {
            Record("process-failed", e.ProcessFailedKind.ToString());
        };
        view.CoreWebView2.NavigationCompleted += async delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
            if (observed) return;
            observed = true;
            try {
                Record("navigation", new { success = e.IsSuccess, status = e.WebErrorStatus.ToString() });
                if (!e.IsSuccess) { Environment.ExitCode = 1; Close(); return; }
                for (var attempt = 0; attempt < 150; attempt++) {
                    var content = await view.CoreWebView2.ExecuteScriptAsync("document.body.innerText.trim().length > 20");
                    if (content == "true") { Record("first-content", null); break; }
                    await Task.Delay(100);
                }
                await Task.Delay(5000);
                // ExecuteScriptAsync does not await a returned JS promise. The probe publishes its result.
                await view.CoreWebView2.ExecuteScriptAsync(probe);
                var probeCompleted = false;
                for (var attempt = 0; attempt < 100; attempt++) {
                    var result = await view.CoreWebView2.ExecuteScriptAsync("window.__paseoShellProbeResult || null");
                    if (result != "null") {
                        File.WriteAllText(Path.Combine(output, "page.json"), result);
                        probeCompleted = true;
                        break;
                    }
                    await Task.Delay(100);
                }
                if (!probeCompleted) throw new TimeoutException("Page probe did not complete.");
                using (var stream = File.Create(Path.Combine(output, "window.png")))
                    await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                Record("sample-ready", null);
                await Task.Delay(10000);
                Record("complete", null);
                Close();
            } catch (Exception error) { Record("error", error.ToString()); Environment.ExitCode = 1; Close(); }
        };
        view.CoreWebView2.Navigate(appUri.AbsoluteUri);
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 4) return 2;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new WebViewShell(args));
        return Environment.ExitCode;
    }
}
