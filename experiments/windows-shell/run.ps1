param(
    [string]$AppUrl = "https://app.paseo.sh",
    [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA "Temp\paseo-shell-validation"),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "evidence\runs"),
    [ValidateRange(1, 5)][int]$Rounds = 3
)
$ErrorActionPreference = "Stop"

# Pin both engines' SDKs; keep downloaded dependencies and profiles outside the checkout.
$sdkVersion = "1.0.3719.77"
$electronVersion = "44.2.0"
New-Item -ItemType Directory -Force $RuntimeDirectory | Out-Null
foreach ($dependency in @(
    @{ Name = "webview2"; Url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" },
    @{ Name = "electron"; Url = "https://github.com/electron/electron/releases/download/v$electronVersion/electron-v$electronVersion-win32-x64.zip" }
)) {
    $destination = Join-Path $RuntimeDirectory $dependency.Name
    if (!(Test-Path $destination)) {
        $archive = Join-Path $RuntimeDirectory ($dependency.Name + ".zip")
        Invoke-WebRequest $dependency.Url -OutFile $archive -UseBasicParsing
        Expand-Archive $archive -DestinationPath $destination
    }
}

$build = Join-Path $RuntimeDirectory "shell"
New-Item -ItemType Directory -Force $build | Out-Null
$sdk = Join-Path $RuntimeDirectory "webview2\lib\net462"
Copy-Item (Join-Path $sdk "Microsoft.Web.WebView2.Core.dll") $build -Force
Copy-Item (Join-Path $sdk "Microsoft.Web.WebView2.WinForms.dll") $build -Force
Copy-Item (Join-Path $RuntimeDirectory "webview2\runtimes\win-x64\native\WebView2Loader.dll") $build -Force
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$binary = Join-Path $build "PaseoWebViewProbe.exe"
& $compiler /nologo /target:winexe /platform:x64 "/out:$binary" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/reference:$sdk\Microsoft.Web.WebView2.Core.dll" "/reference:$sdk\Microsoft.Web.WebView2.WinForms.dll" (Join-Path $PSScriptRoot "WebViewShell.cs")
if ($LASTEXITCODE -ne 0) { throw "WebView2 shell compilation failed." }

$batch = Get-Date -Format "yyyyMMdd-HHmmss"
$resultRoot = Join-Path $OutputDirectory $batch
New-Item -ItemType Directory -Force $resultRoot | Out-Null
@{
    os = [Environment]::OSVersion.VersionString
    appUrl = $AppUrl
    electron = $electronVersion
    webview2Sdk = $sdkVersion
    workload = "Unpaired published Web UI; fresh profile each run; no daemon; no preload in either shell"
    timing = "Per-shell first-content timers start in different host initialization phases; not comparable cold-start measurements"
    contentSize = "1200x800 requested; verify DPI through screenshots"
} | ConvertTo-Json | Set-Content (Join-Path $resultRoot "environment.json") -Encoding UTF8

function Quote-Argument([string]$Value) {
    if ($Value.Contains('"')) { throw "Double quotes are not supported in experiment arguments." }
    return '"' + $Value + '"'
}

for ($round = 1; $round -le $Rounds; $round++) {
    $engines = if ($round % 2 -eq 1) { @("webview2", "electron") } else { @("electron", "webview2") }
    foreach ($engine in $engines) {
        $run = Join-Path $resultRoot "$round-$engine"
        $profile = Join-Path $RuntimeDirectory "profiles\$batch-$round-$engine"
        New-Item -ItemType Directory -Force $run | Out-Null
        $arguments = @($AppUrl, $run, $profile, (Join-Path $PSScriptRoot "page-probe.js"))
        $executable = $binary
        if ($engine -eq "electron") {
            $executable = Join-Path $RuntimeDirectory "electron\electron.exe"
            $arguments = @((Join-Path $PSScriptRoot "electron-baseline.cjs"), $run, $profile, (Join-Path $PSScriptRoot "page-probe.js"), $AppUrl)
        }
        $timer = [Diagnostics.Stopwatch]::StartNew()
        $process = Start-Process $executable -ArgumentList (($arguments | ForEach-Object { Quote-Argument $_ }) -join " ") -PassThru
        $samples = New-Object 'System.Collections.Generic.List[object]'
        $cpuPrevious = @{}
        $cpuTotal = 0.0
        while (!$process.HasExited -and $timer.Elapsed.TotalSeconds -lt 55) {
            $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
            $ids = New-Object 'System.Collections.Generic.HashSet[int]'
            [void]$ids.Add($process.Id)
            do {
                $added = $false
                foreach ($item in $processes) {
                    if ($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $added = $true }
                }
            } while ($added)
            $workingSet = 0L
            $privateBytes = 0L
            $count = 0
            foreach ($processId in $ids) {
                $member = Get-Process -Id $processId -ErrorAction SilentlyContinue
                if ($null -eq $member) { continue }
                $count++
                $workingSet += $member.WorkingSet64
                $privateBytes += $member.PrivateMemorySize64
                $cpu = $member.TotalProcessorTime.TotalMilliseconds
                if ($cpuPrevious.ContainsKey($processId)) { $cpuTotal += [Math]::Max(0, $cpu - $cpuPrevious[$processId]) }
                else { $cpuTotal += $cpu }
                $cpuPrevious[$processId] = $cpu
            }
            $samples.Add([pscustomobject]@{
                elapsedMs = [Math]::Round($timer.Elapsed.TotalMilliseconds)
                phase = $(if ((Test-Path (Join-Path $run "events.jsonl")) -and ((Get-Content (Join-Path $run "events.jsonl") -Raw) -match '"sample-ready"')) { "idle" } else { "loading" })
                processes = $count
                workingSetBytes = $workingSet
                privateBytes = $privateBytes
                cumulativeCpuMs = [Math]::Round($cpuTotal)
            })
            Start-Sleep -Milliseconds 500
            $process.Refresh()
        }
        if (!$process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F | Out-Null
            throw "Experiment timed out: $run"
        }
        $samples | Export-Csv (Join-Path $run "process-tree.csv") -NoTypeInformation -Encoding UTF8
        Write-Output "$engine round=$round exit=$($process.ExitCode) output=$run"
    }
}
Write-Output "Evidence: $resultRoot"
