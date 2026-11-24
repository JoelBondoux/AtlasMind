<#
.SYNOPSIS
  Registers (or removes) the two daily AtlasMind Marketplace publish windows in
  Windows Task Scheduler: 10:30 and 22:00, local (UK) time.

.DESCRIPTION
  Each window runs scripts/release-gate/release-window.mjs from a dedicated clone
  of AtlasMind. The window publishes only when a release tag newer than the
  Marketplace exists and passes the release gate; otherwise it logs "no publish
  needed" and exits. The gate itself enforces the two-a-day limit.

  The task runs hidden (conhost --headless: no console window, no focus taken),
  only while you are signed in (so vsce can read the credential `vsce login`
  stored in Windows Credential Manager), and never wakes the machine.

  Machine off or asleep at a window: Task Scheduler runs the missed window once
  as soon as it can after you next sign in (StartWhenAvailable). Two missed
  windows collapse into one run. Nothing is queued anywhere else, and the
  next window simply checks again.

  Logs: %LOCALAPPDATA%\AtlasMind\release-gate\window.log, with a JSON report per
  gate run in reports\.

.PARAMETER Clone
  The dedicated clone the windows run from. It is created if missing. Never point
  this at a working checkout: each window moves it to origin/main.

.PARAMETER Unregister
  Remove both tasks instead.

.EXAMPLE
  pwsh -NoProfile -File scripts\release-gate\register-publish-windows.ps1
#>
[CmdletBinding()]
param(
  [string]$Clone = (Join-Path $env:LOCALAPPDATA 'AtlasMind\release-gate\repo'),
  [switch]$Unregister
)
$ErrorActionPreference = 'Stop'
$names = 'AtlasMind publish window 10-30', 'AtlasMind publish window 22-00'

if ($Unregister) {
  foreach ($n in $names) { Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue }
  Write-Host 'Removed the AtlasMind publish windows.'
  return
}

if (-not (Test-Path (Join-Path $Clone '.git'))) {
  New-Item -ItemType Directory -Force (Split-Path $Clone) | Out-Null
  git clone --quiet https://github.com/JoelBondoux/AtlasMind.git $Clone
}

$node = (Get-Command node -ErrorAction Stop).Source
# The task runs a launcher kept outside the clone, so it works before and after
# the gate reaches main: it moves the clone to origin/main and runs that copy of
# release-window.mjs, or logs that main has no gate yet and exits 0.
$state = Split-Path $Clone
$script = Join-Path $state 'run-window.mjs'
$cloneJson = ConvertTo-Json $Clone
@"
// Written by register-publish-windows.ps1. Runs one AtlasMind publish window.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const clone = $cloneJson;
const logFile = path.join(path.dirname(clone), 'window.log');
const log = (m) => appendFileSync(logFile, ``[`${new Date().toISOString()}] [launcher] `${m}\n``);
const git = (...a) => spawnSync('git', a, { cwd: clone, windowsHide: true, encoding: 'utf8' });
for (const a of [['fetch', '--quiet', '--tags', '--prune', 'origin'], ['checkout', '--quiet', '--detach', 'origin/main']]) {
  const r = git(...a);
  if (r.status !== 0) { log(``git `${a[0]} failed: `${(r.stderr || '').trim()}``); process.exit(1); }
}
const windowScript = path.join(clone, 'scripts', 'release-gate', 'release-window.mjs');
if (!existsSync(windowScript)) { log('origin/main has no release gate yet; nothing to do'); process.exit(0); }
const r = spawnSync(process.execPath, [windowScript, ...process.argv.slice(2)], { cwd: clone, stdio: 'inherit', windowsHide: true });
process.exit(r.status ?? 1);
"@ | Set-Content -Encoding utf8 $script
# conhost --headless starts the process with no visible console at all.
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\conhost.exe" `
  -Argument "--headless `"$node`" `"$script`"" -WorkingDirectory $Clone
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

foreach ($pair in @(@($names[0], '10:30'), @($names[1], '22:00'))) {
  $trigger = New-ScheduledTaskTrigger -Daily -At $pair[1]
  Register-ScheduledTask -TaskName $pair[0] -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'Publishes the newest AtlasMind release that passes the release gate, if one is needed. See docs/releasing.md.' -Force | Out-Null
  Write-Host "Registered '$($pair[0])' at $($pair[1]) daily, hidden, from $Clone"
}
