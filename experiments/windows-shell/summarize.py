"""Summarize only completed, same-UI, foreground welcome-page runs."""

import csv
import json
import statistics
import sys
from pathlib import Path

batch = Path(sys.argv[1])
runs = []
for directory in sorted(path for path in batch.iterdir() if path.is_dir()):
    events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
    kinds = {event["kind"] for event in events}
    if not {"first-content", "sample-ready", "complete"} <= kinds or kinds & {"error", "timeout", "process-failed"}:
        raise ValueError(f"Incomplete or failed run: {directory}")
    page = json.loads((directory / "page.json").read_text(encoding="utf-8-sig"))
    if page["title"] != "Paseo" or not page["indexedDB"] or not page["localStorage"] or page["errors"]:
        raise ValueError(f"App/storage smoke check failed: {directory}")
    with (directory / "process-tree.csv").open(encoding="utf-8-sig", newline="") as stream:
        samples = list(csv.DictReader(stream))
    # Discard phase transition and final samples to keep shutdown out of idle accounting.
    idle = [sample for sample in samples if sample["phase"] == "idle" and int(sample["processes"]) > 0][2:-1]
    if len(idle) < 3:
        raise ValueError(f"Insufficient idle observations: {directory}")
    cpu_delta = float(idle[-1]["cumulativeCpuMs"]) - float(idle[0]["cumulativeCpuMs"])
    wall_delta = float(idle[-1]["elapsedMs"]) - float(idle[0]["elapsedMs"])
    runs.append({
        "run": directory.name,
        "engine": directory.name.split("-", 1)[1],
        "samples": len(idle),
        "idlePrivateCommitMiB": round(statistics.median(int(sample["privateBytes"]) for sample in idle) / 2**20, 2),
        "idleWorkingSetSumMiB": round(statistics.median(int(sample["workingSetBytes"]) for sample in idle) / 2**20, 2),
        "idleProcesses": statistics.median(int(sample["processes"]) for sample in idle),
        "idleCpuOneCorePercent": round(100 * cpu_delta / wall_delta, 3),
        "settingsNavigation": page["settingsNavigation"],
        "scripts": page["scripts"],
    })
script_sets = {tuple(run["scripts"]) for run in runs}
if len(script_sets) != 1:
    raise ValueError("UI scripts changed between runs; do not aggregate.")
summary = {
    "scope": "Published 0.8.0 welcome UI only; no connected daemon; foreground, fresh profiles, shared OS caches; not the packaged Paseo desktop",
    "memory": "Private commit is not resident RAM; summed working sets double-count shared pages. All observed child processes included.",
    "timing": "First-content events use different host start boundaries and include network delays; not a cold-start comparison.",
    "runs": runs,
    "medians": {},
}
for engine in sorted({run["engine"] for run in runs}):
    engine_runs = [run for run in runs if run["engine"] == engine]
    summary["medians"][engine] = {
        key: round(statistics.median(run[key] for run in engine_runs), 3)
        for key in ("idlePrivateCommitMiB", "idleWorkingSetSumMiB", "idleProcesses", "idleCpuOneCorePercent")
    }
(batch / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(summary["medians"], indent=2))
