"""Inventory lexical desktop dependencies; counts overlap and are not a call graph."""

import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
patterns = {
    "desktop_detection": r"getIsElectron\(|isElectronRuntime\(",
    "desktop_host": r"getDesktopHost\(",
    "desktop_invoke": r"invokeDesktopCommand[<(]",
    "raw_electron_bridge": r"window\.paseoDesktop",
    "webview": r"<webview|webviewTag",
}
results = {name: {"hits": []} for name in patterns}
for source in sorted((root / "packages/app/src").rglob("*")):
    if source.suffix not in {".ts", ".tsx"} or any(
        marker in source.name for marker in (".test.", ".spec.")
    ):
        continue
    for line, text in enumerate(source.read_text().splitlines(), 1):
        for name, pattern in patterns.items():
            if re.search(pattern, text):
                results[name]["hits"].append(
                    {"file": str(source.relative_to(root)), "line": line, "text": text.strip()}
                )
for entry in results.values():
    entry["occurrences"] = len(entry["hits"])
    entry["files"] = len({hit["file"] for hit in entry["hits"]})
output = Path(__file__).parent / "evidence/desktop-dependencies.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps({name: {key: entry[key] for key in ("files", "occurrences")} for name, entry in results.items()}, indent=2))
