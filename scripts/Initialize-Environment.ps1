$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not $projectRoot.StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) {
    throw '按保存规则，本项目的配置和运行数据必须位于 D 盘。'
}
$taskTemp = 'D:\CodexData\temp\742-rebrand'
New-Item -ItemType Directory -Path $taskTemp -Force | Out-Null
$env:TEMP = $taskTemp
$env:TMP = $taskTemp
$env:TMPDIR = $taskTemp
$envPath = Join-Path $projectRoot '.env.local'
if (Test-Path -LiteralPath $envPath) {
    Write-Output "配置已存在，保留现有值：$envPath"
    exit 0
}
function New-RandomHex([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($buffer)).Replace('-', '').ToLowerInvariant()
}
$settings = @(
    'DB_USERNAME=client742'
    ('DB_PASSWORD=' + (New-RandomHex 18))
    ('MYSQL_ROOT_PASSWORD=' + (New-RandomHex 18))
    'DB_URL=jdbc:mysql://127.0.0.1:17423/client742_game?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai'
    'REDIS_HOST=127.0.0.1'
    'REDIS_PORT=17424'
    'REDIS_DATABASE=7'
    ('REDIS_PASSWORD=' + (New-RandomHex 18))
    ('AES_KEY=' + (New-RandomHex 16))
    ('JWT_SECRET=' + (New-RandomHex 32))
    'SERVER_PORT=17422'
    'SPRING_PROFILES_ACTIVE=dev'
    'ALLOWED_ORIGINS=http://127.0.0.1:17420,http://127.0.0.1:17421'
    'BOOTSTRAP_ADMIN_ENABLED=true'
    'BOOTSTRAP_ADMIN_USERNAME=admin'
    ('BOOTSTRAP_ADMIN_PASSWORD=A7' + (New-RandomHex 11))
    'WX_MINIAPP_ENABLED=false'
    'WX_PAY_ENABLED=false'
    ('FILE_UPLOAD_PATH=' + ($projectRoot.Replace('\', '/') + '/runtime/uploads/'))
)
[IO.File]::WriteAllLines($envPath, $settings, (New-Object Text.UTF8Encoding($false)))
Write-Output "已生成独立随机配置：$envPath"
Write-Output '新管理员账号和密码保存在此文件中，未输出任何密钥。已有管理员时不会重置账号。'
