# deploy.ps1 - sincroniza una carpeta local con el servidor via WinSCP
# Uso: powershell -ExecutionPolicy Bypass -File deploy.ps1 [-LocalDir carpeta] [-RemoteDir /ruta]
# Credenciales en ftp.config.json (protocol: ftp | ftpes | ftps | sftp)

param(
    [string]$LocalDir = 'deploy',
    [string]$RemoteDir = ''
)

$ErrorActionPreference = 'Stop'

$configPath = Join-Path $PSScriptRoot 'ftp.config.json'
$localDir = if ([System.IO.Path]::IsPathRooted($LocalDir)) { $LocalDir } else { Join-Path $PSScriptRoot $LocalDir }
$winscp = "$env:LOCALAPPDATA\Programs\WinSCP\winscp.com"

if (-not (Test-Path $winscp)) {
    $alt = @("C:\Program Files (x86)\WinSCP\winscp.com", "C:\Program Files\WinSCP\winscp.com") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($alt) { $winscp = $alt } else { throw "WinSCP no encontrado. Instala con: winget install WinSCP.WinSCP" }
}
if (-not (Test-Path $configPath)) { throw "No existe ftp.config.json" }

$cfg = Get-Content $configPath -Raw | ConvertFrom-Json
if ($cfg.user -eq 'TU_USUARIO' -or $cfg.password -eq 'TU_PASSWORD') {
    throw "Edita ftp.config.json y pon tus credenciales reales antes de desplegar."
}
if ($RemoteDir) { $cfg.remoteDir = $RemoteDir }

# user/pass URL-escapados para soportar caracteres especiales (@, :, #, etc.)
$u = [uri]::EscapeDataString($cfg.user)
$p = [uri]::EscapeDataString($cfg.password)
$portPart = if ($cfg.port) { ":$($cfg.port)" } else { "" }
$sessionUrl = "$($cfg.protocol)://${u}:${p}@$($cfg.host)$portPart/"

$openLine = "open $sessionUrl -timeout=90"
if ($cfg.protocol -eq 'sftp') {
    if ($cfg.hostkey) { $openLine += " -hostkey=`"$($cfg.hostkey)`"" }
    else { $openLine += " -hostkey=*" }  # primera conexion: acepta cualquier clave (menos seguro)
}
# hosting compartido: cert TLS a nombre del servidor, no del dominio -> se fija su huella SHA-256
if ($cfg.certificate -and $cfg.protocol -in @('ftpes', 'ftps')) {
    $openLine += " -certificate=`"$($cfg.certificate)`""
}

# script temporal de WinSCP (evita el infierno de comillas de PowerShell con rutas con espacios)
$scriptFile = Join-Path $env:TEMP ("winscp_deploy_{0}.txt" -f ([guid]::NewGuid().ToString('N')))
@(
    $openLine
    "option reconnecttime 45"
    "option batch continue"
    "mkdir `"$($cfg.remoteDir)`""      # crea el destino si no existe (ignora el error si ya existe)
    "option batch abort"
    "synchronize remote `"$localDir`" `"$($cfg.remoteDir)`""
    "exit"
) | Set-Content -Path $scriptFile -Encoding UTF8

Write-Host "Desplegando $localDir -> $($cfg.host)$($cfg.remoteDir) ..." -ForegroundColor Cyan

try {
    & $winscp /ini=nul /log="$PSScriptRoot\deploy.log" /script="$scriptFile"
    $code = $LASTEXITCODE
} finally {
    Remove-Item $scriptFile -Force -ErrorAction SilentlyContinue  # contiene la password
}

if ($code -eq 0) {
    Write-Host "Despliegue OK" -ForegroundColor Green
} else {
    Write-Host "Fallo el despliegue (codigo $code). Revisa deploy.log" -ForegroundColor Red
    exit $code
}

