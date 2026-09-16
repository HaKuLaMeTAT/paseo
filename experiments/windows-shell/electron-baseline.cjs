const { app, BrowserWindow, shell, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

// Keep the URL last: Electron Windows rejects arguments following a URL.
const [output, profile, probePath, appUrl] = process.argv.slice(2);
const origin = new URL(appUrl);
if (
  origin.protocol !== "https:" &&
  !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
) {
  throw new Error("Use HTTPS or loopback HTTP for the app URL.");
}
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", path.resolve(profile));
fs.mkdirSync(output, { recursive: true });
const started = performance.now();
function record(kind, data = null) {
  fs.appendFileSync(
    path.join(output, "events.jsonl"),
    `${JSON.stringify({ kind, elapsedMs: performance.now() - started, data })}\n`,
  );
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function openExternal(url) {
  if (["https:", "http:"].includes(new URL(url).protocol)) void shell.openExternal(url);
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, respond) =>
    respond(false),
  );
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    useContentSize: true,
    title: "Paseo - Electron baseline",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin.origin) event.preventDefault();
  });
  record("engine", process.versions);
  const deadline = setTimeout(() => {
    record("timeout");
    app.exit(1);
  }, 45000);
  try {
    await window.loadURL(appUrl);
    record("navigation", { success: true });
    for (let attempt = 0; attempt < 150; attempt++) {
      if (
        await window.webContents.executeJavaScript("document.body.innerText.trim().length > 20")
      ) {
        record("first-content");
        break;
      }
      await delay(100);
    }
    await delay(5000);
    await window.webContents.executeJavaScript(fs.readFileSync(probePath, "utf8"));
    const result = await window.webContents.executeJavaScript(
      "window.__paseoShellProbeResult || null",
    );
    fs.writeFileSync(path.join(output, "page.json"), JSON.stringify(result, null, 2));
    fs.writeFileSync(
      path.join(output, "window.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    record("sample-ready");
    await delay(10000);
    record("complete");
    clearTimeout(deadline);
    return app.quit();
  } catch (error) {
    record("error", String(error));
    clearTimeout(deadline);
    return app.exit(1);
  }
});
