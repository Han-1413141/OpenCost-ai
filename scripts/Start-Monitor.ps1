#requires -Version 7.4
param(
  [ValidateSet('Start','Stop','Install','Uninstall')][string]$Action = 'Start',
  [string]$Config,
  [string]$Database = '.local/monitor.sqlite',
  [string]$Identity = '.local/client-access.key',
  [string]$StorageMaxBytes,
  [string]$StorageReserveBytes,
  [string]$StorageWalMaxBytes,
  [string]$StorageDiskReserveBytes,
  [switch]$UserApproved
)
$ErrorActionPreference = 'Stop'

function Get-MonitorFilePath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw '请提供有效的文件路径。' }
  if ($Value -match '["\x00-\x1f]') { throw '文件路径不能包含引号或控制字符。' }
  $provider = $null
  $drive = $null
  $path = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Value, [ref]$provider, [ref]$drive)
  if ($provider.Name -ne 'FileSystem') { throw '监控只支持本地文件路径。' }
  return [IO.Path]::GetFullPath($path)
}

function Get-MonitorTaskName([string]$Path) {
  $shaAlgorithm = [Security.Cryptography.SHA256]::Create()
  try { $shortId = ([BitConverter]::ToString($shaAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Path)))).Replace('-','').Substring(0,16) } finally { $shaAlgorithm.Dispose() }
  return "OpenCost-Monitor-$shortId"
}

function Get-MonitorScheduledTask {
  # Enumeration distinguishes a missing task from scheduler/access failures.
  $tasks = @(Get-ScheduledTask -TaskPath '\' -ErrorAction Stop | Where-Object {
    if ($_.TaskName -eq $taskName) { return $true }
    # Legacy names hash the path with its original case. Find the same Windows
    # database without renaming its existing task or creating a second task.
    if ($_.TaskName -notmatch '\AOpenCost-Monitor-[0-9A-F]{16}\z' -or @($_.Actions).Count -ne 1) { return $false }
    $candidate = [regex]::Match([string]$_.Actions[0].Arguments, $taskArgumentPattern)
    if (-not $candidate.Success) { return $false }
    $registeredPath = $candidate.Groups['db'].Value
    return [IO.Path]::IsPathFullyQualified($registeredPath) -and
      [IO.Path]::GetFullPath($registeredPath) -ieq $databasePath -and
      $_.TaskName -eq (Get-MonitorTaskName $registeredPath)
  })
  if ($tasks.Count -gt 1) { throw '发现同一数据库对应多个登录任务，已停止修改；请先核对重复任务。' }
  if ($tasks.Count -eq 1) { return $tasks[0] }
  return $null
}

function Assert-MonitorTaskOwner($Task) {
  $actions = @($Task.Actions)
  $principal = $Task.Principal
  try {
    $taskUser = [string]$principal.UserId
    $sid = if ($taskUser -match '^S-1-') {
      [Security.Principal.SecurityIdentifier]::new($taskUser)
    } else {
      [Security.Principal.NTAccount]::new($taskUser).Translate([Security.Principal.SecurityIdentifier])
    }
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    if ($sid.Value -ne $currentSid.Value) { throw 'user mismatch' }
  } catch { throw '同名任务不属于当前用户，未修改或删除。' }
  if ($Task.TaskPath -ne '\' -or $actions.Count -ne 1 -or
      [string]$principal.LogonType -ne 'Interactive' -or [string]$principal.RunLevel -ne 'Limited' -or
      -not [string]::IsNullOrEmpty([string]$principal.GroupId)) {
    throw '同名任务的权限或动作不符合 OpenCost 登录任务，未修改或删除。'
  }
  $taskAction = $actions[0]
  $knownShells = @((Join-Path $PSHOME 'pwsh.exe'))
  $pathShell = Get-Command pwsh -CommandType Application -ErrorAction SilentlyContinue
  if ($null -ne $pathShell) { $knownShells += $pathShell.Source }
  $knownExecutable = @($knownShells | Where-Object {
    [IO.Path]::IsPathFullyQualified([string]$_) -and
    [IO.Path]::GetFullPath([string]$_) -ieq [string]$taskAction.Execute
  }).Count -gt 0
  # Accept only the exact old format or the new four-budget format.
  $match = [regex]::Match([string]$taskAction.Arguments, $taskArgumentPattern)
  if (-not $match.Success -or
      -not [IO.Path]::IsPathFullyQualified([string]$taskAction.Execute) -or
      -not $knownExecutable -or
      -not [IO.Path]::IsPathFullyQualified([string]$taskAction.WorkingDirectory) -or
      [IO.Path]::GetFullPath([string]$taskAction.WorkingDirectory) -ine $projectRoot -or
      -not [IO.Path]::IsPathFullyQualified($match.Groups['script'].Value) -or
      [IO.Path]::GetFullPath($match.Groups['script'].Value) -ine $scriptPath -or
      -not [IO.Path]::IsPathFullyQualified($match.Groups['db'].Value) -or
      [IO.Path]::GetFullPath($match.Groups['db'].Value) -ine $databasePath) {
    throw '同名任务不属于本工具包和数据库，未修改或删除。'
  }
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$scriptPath = Join-Path $PSScriptRoot 'Start-Monitor.ps1'
$databasePath = Get-MonitorFilePath $Database
$taskArgumentPattern = '\A-NoProfile -NonInteractive -WindowStyle Hidden -File "(?<script>[^"]+)" -Action Start -Config "[^"]+" -Database "(?<db>[^"]+)" -Identity "[^"]+" -UserApproved(?: -StorageMaxBytes [0-9]+ -StorageReserveBytes [0-9]+ -StorageWalMaxBytes [0-9]+ -StorageDiskReserveBytes [0-9]+)?\z'
# Preserve the original task-name rule so existing installations remain manageable.
$taskName = Get-MonitorTaskName $databasePath

if ($Action -eq 'Stop') {
  $stopPath = "$databasePath.stop"
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($databasePath)) | Out-Null
  try {
    $stopFile = [IO.File]::Open($stopPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $stopFile.Dispose()
  } catch [IO.IOException] {
    $item = Get-Item -LiteralPath $stopPath -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw '停止标记不是普通文件，未覆盖该路径。'
    }
    # A regular stop file already requests a stop; leave its bytes alone.
  }
  Write-Output '已请求停止；记录完整保留。长期关闭请同时运行 monitor off，或 Uninstall 移除开机调度。'
  exit
}
if ($Action -eq 'Uninstall') {
  if (-not $UserApproved) { throw '删除开机调度前请由用户选择，再传 -UserApproved。' }
  $existing = Get-MonitorScheduledTask
  if ($null -eq $existing) {
    Write-Output '未找到此数据库对应的登录调度；未修改其他任务。'
    exit
  }
  Assert-MonitorTaskOwner $existing
  Unregister-ScheduledTask -TaskName $existing.TaskName -TaskPath '\' -Confirm:$false -ErrorAction Stop
  if ($null -ne (Get-MonitorScheduledTask)) { throw '登录任务仍然存在，未确认移除成功。' }
  Write-Output '已移除 OpenCost 开机调度；运行中的采集请另用 Stop 停止。'
  exit
}
if (-not $UserApproved) { throw '仅在用户明确选择后台运行或开机启动后传 -UserApproved；此参数不能由提示词自行授予。' }
if ([string]::IsNullOrWhiteSpace($Config)) { throw '启动或安装登录任务需要提供 -Config。' }
$configPath = (Resolve-Path -LiteralPath $Config).Path
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw '配置必须为文件。' }
$identityPath = Get-MonitorFilePath $Identity
$nodePath = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$cliPath = Join-Path $projectRoot 'client/monitor-cli.ts'
$budgetArgs = @('--import', 'tsx', $cliPath, 'storage-options')
foreach ($option in @(
  @('StorageMaxBytes', '--max-bytes', $StorageMaxBytes),
  @('StorageReserveBytes', '--reserve-bytes', $StorageReserveBytes),
  @('StorageWalMaxBytes', '--wal-max-bytes', $StorageWalMaxBytes),
  @('StorageDiskReserveBytes', '--disk-reserve-bytes', $StorageDiskReserveBytes)
)) {
  if ($PSBoundParameters.ContainsKey($option[0])) { $budgetArgs += @($option[1], $option[2]) }
}
Push-Location -LiteralPath $projectRoot
try {
  $budgetJson = & $nodePath @budgetArgs
  if ($LASTEXITCODE -ne 0) { throw '监控容量配置无效，未启动或安装任务。' }
  $budget = ($budgetJson -join "`n") | ConvertFrom-Json -ErrorAction Stop
} finally { Pop-Location }
$childEnvironment = @{}
foreach ($option in @(
  @('maxBytes', 'OPENCOST_MONITOR_MAX_BYTES'),
  @('reserveBytes', 'OPENCOST_MONITOR_RESERVE_BYTES'),
  @('walMaxBytes', 'OPENCOST_MONITOR_WAL_MAX_BYTES'),
  @('diskReserveBytes', 'OPENCOST_MONITOR_DISK_RESERVE_BYTES')
)) {
  $value = $budget.($option[0])
  if (($value -isnot [long] -and $value -isnot [int]) -or $value -lt 0 -or $value -gt 9007199254740991) {
    throw '监控容量结果无效，未启动或安装任务。'
  }
  $childEnvironment[$option[1]] = $value.ToString([Globalization.CultureInfo]::InvariantCulture)
}
# Windows file names cannot contain double quotes; quote each file argument.
$quotedArgs = @('--import', 'tsx', ('"' + $cliPath + '"'), 'run', '--config', ('"' + $configPath + '"'), '--db', ('"' + $databasePath + '"'), '--identity', ('"' + $identityPath + '"'))
if ($Action -eq 'Install') {
  $existing = Get-MonitorScheduledTask
  if ($null -ne $existing) {
    Assert-MonitorTaskOwner $existing
    $taskName = $existing.TaskName
    # Keep the original database spelling paired with its legacy task-name hash.
    $databasePath = [regex]::Match([string]$existing.Actions[0].Arguments, $taskArgumentPattern).Groups['db'].Value
  }
  $shellPath = (Get-Command pwsh -CommandType Application -ErrorAction Stop).Source
  $taskArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $scriptPath + '" -Action Start -Config "' + $configPath + '" -Database "' + $databasePath + '" -Identity "' + $identityPath + '" -UserApproved' +
    ' -StorageMaxBytes ' + $childEnvironment['OPENCOST_MONITOR_MAX_BYTES'] +
    ' -StorageReserveBytes ' + $childEnvironment['OPENCOST_MONITOR_RESERVE_BYTES'] +
    ' -StorageWalMaxBytes ' + $childEnvironment['OPENCOST_MONITOR_WAL_MAX_BYTES'] +
    ' -StorageDiskReserveBytes ' + $childEnvironment['OPENCOST_MONITOR_DISK_RESERVE_BYTES']
  $taskAction = New-ScheduledTaskAction -Execute $shellPath -Argument $taskArgs -WorkingDirectory $projectRoot
  $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $taskPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $registration = @{ TaskName = $taskName; TaskPath = '\'; Action = $taskAction; Trigger = $taskTrigger; Principal = $taskPrincipal; Settings = $taskSettings; Description = '用户授权的本地额度采集和每日脱敏上传；不调用大模型。'; ErrorAction = 'Stop' }
  if ($null -ne $existing) { $registration['Force'] = $true }
  Register-ScheduledTask @registration | Out-Null
  $installed = Get-MonitorScheduledTask
  if ($null -eq $installed) { throw '未查询到登记的登录任务，未确认安装成功。' }
  Assert-MonitorTaskOwner $installed
  if ($installed.Actions[0].Arguments -cne $taskArgs) { throw '登录任务参数与请求不一致，未确认安装成功。' }
  Write-Output "已登记下次登录启动：$taskName；已保存四项容量预算。本次立即启动需另运行 Start。"
  exit
}
if (Test-Path -LiteralPath "$databasePath.lock") { throw '监控锁已存在，先查看 status 并确认进程，不重复启动。' }
$process = Start-Process -FilePath $nodePath -ArgumentList $quotedArgs -WorkingDirectory $projectRoot -Environment $childEnvironment -WindowStyle Hidden -PassThru
try {
  if ($process.WaitForExit(1000)) {
    if ($process.ExitCode -ne 0) {
      throw '后台进程启动后已退出；请用 monitor diagnostics 查看本地原因。若没有诊断记录，请检查 Node、依赖及启动配置。'
    }
    Write-Output '后台进程已结束；请用 monitor diagnostics 查看最后结果，不能按原 PID 判断仍在运行。'
  } else {
    Write-Output "已发起后台启动，PID=$($process.Id)；请用 monitor status 或 diagnostics 核对最后就绪记录。进程存在不代表监控已就绪。"
  }
} finally { $process.Dispose() }
