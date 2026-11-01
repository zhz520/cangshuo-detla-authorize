param([string]$Java = 'java')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not $projectRoot.StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) { throw '项目必须位于 D 盘。' }
$envPath = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $envPath)) { throw '请先执行 scripts/Initialize-Environment.ps1。' }
foreach ($line in [IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
$taskTemp = 'D:\CodexData\temp\742-rebrand'
New-Item -ItemType Directory -Path $taskTemp -Force | Out-Null
$env:TEMP = $taskTemp; $env:TMP = $taskTemp; $env:TMPDIR = $taskTemp
$jar = Join-Path $projectRoot 'delta-game\delta-admin\target\delta-admin.jar'
if (-not (Test-Path -LiteralPath $jar)) { throw '请先在 delta-game 目录执行 mvn package。' }
Push-Location $projectRoot
try { & $Java "-Djava.io.tmpdir=$taskTemp" -jar $jar; exit $LASTEXITCODE }
finally { Pop-Location }
