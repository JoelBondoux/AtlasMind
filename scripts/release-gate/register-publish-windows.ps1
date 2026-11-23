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
$script = Join-Path $Clone 'scripts\release-gate\release-window.mjs'
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
