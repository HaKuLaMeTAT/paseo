(async function () {
  const storageKey = "paseo-shell-evaluation";
  const result = {
    url: location.href,
    title: document.title,
    text: document.body.innerText.slice(0, 1600),
    scripts: Array.from(document.scripts, (script) => script.src).filter(Boolean),
    secureContext: window.isSecureContext,
    desktopBridge: typeof window.paseoDesktop,
    webviewGuests: document.querySelectorAll("webview").length,
    websocketApi: typeof WebSocket,
    indexedDB: false,
    localStorage: false,
    settingsNavigation: false,
    errors: [],
  };
  try {
    localStorage.setItem(storageKey, "probe");
    result.localStorage = localStorage.getItem(storageKey) === "probe";
    localStorage.removeItem(storageKey);
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(storageKey, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("probe");
      request.addEventListener("error", () => reject(request.error));
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("probe", "readwrite");
        transaction.objectStore("probe").put("value", "key");
        transaction.oncomplete = () => {
          const read = db.transaction("probe").objectStore("probe").get("key");
          read.onsuccess = () => {
            result.indexedDB = read.result === "value";
            db.close();
            const deletion = indexedDB.deleteDatabase(storageKey);
            deletion.onsuccess = resolve;
            deletion.addEventListener("error", () => reject(deletion.error));
          };
          read.addEventListener("error", () => reject(read.error));
        };
        transaction.addEventListener("error", () => reject(transaction.error));
      };
    });
  } catch (error) {
    result.errors.push(String(error));
  }
  const settings = Array.from(document.querySelectorAll("button, [role='button'], a")).find(
    (element) => /^(设置|Settings)$/.test(element.textContent.trim()),
  );
  if (settings) {
    const initialUrl = location.href;
    settings.click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result.settingsUrl = location.href;
    result.settingsText = document.body.innerText.slice(0, 600);
    const navigated = location.href !== initialUrl;
    if (navigated) {
      history.back();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    result.settingsNavigation = navigated && location.href === initialUrl;
  }
  window.__paseoShellProbeResult = result;
})();
