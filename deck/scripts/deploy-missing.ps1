# deploy-missing.ps1 — sube uno por uno (put) solo los archivos de dist/ que el servidor no tiene o tiene con otro tamaño.
# Existe porque el FTP de eureka.pe hoy cierra las conexiones de datos de los listados (MLSD) y `synchronize` aborta;
# los `put` individuales sí pasan. Verifica por HTTP (HEAD/GET) en vez de listar por FTP. Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-missing.ps1 [-Rounds 4]
param([int]$Rounds = 4)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root 'dist'
$cfg = Get-Content (Join-Path $root 'ftp.config.json') -Raw | ConvertFrom-Json
$base = 'https://eureka.pe/decks/accessrank/'
$winscp = "$env:LOCALAPPDATA\Programs\WinSCP\winscp.com"
if (-not (Test-Path $winscp)) { $winscp = @("C:\Program Files (x86)\WinSCP\winscp.com", "C:\Program Files\WinSCP\winscp.com") | Where-Object { Test-Path $_ } | Select-Object -First 1 }
$u = [uri]::EscapeDataString($cfg.user); $p = [uri]::EscapeDataString($cfg.password)
$portPart = if ($cfg.port) { ":$($cfg.port)" } else { "" }
$openLine = "open $($cfg.protocol)://${u}:${p}@$($cfg.host)$portPart/ -timeout=60"
if ($cfg.certificate -and $cfg.protocol -in @('ftpes', 'ftps')) { $openLine += " -certificate=`"$($cfg.certificate)`"" }

function Get-Missing {
  $files = Get-ChildItem -Path $dist -Recurse -File
  $out = @()
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($dist.Length + 1).Replace('\', '/')
    try {
      $r = Invoke-WebRequest -Uri ($base + $rel) -Method Head -UseBasicParsing -TimeoutSec 30
      $len = [int64]$r.Headers['Content-Length']
      if ($r.StatusCode -ne 200 -or $len -ne $f.Length) { $out += $rel }
    } catch { $out += $rel }
  }
  return $out
}

for ($round = 1; $round -le $Rounds; $round++) {
  $missing = Get-Missing
  if ($missing.Count -eq 0) { Write-Host "TODO EN EL SERVIDOR (ronda $round)"; exit 0 }
  Write-Host "ronda ${round}: faltan $($missing.Count) archivos"
  $lines = @($openLine, "option batch continue", "option confirm off")
  $dirs = $missing | ForEach-Object { Split-Path $_ -Parent } | Where-Object { $_ } | Sort-Object -Unique
  foreach ($d in $dirs) { $lines += "mkdir `"$($cfg.remoteDir)/$($d.Replace('\','/'))`"" }
  foreach ($m in $missing) {
    $local = Join-Path $dist ($m.Replace('/', '\'))
    $remoteDir = $cfg.remoteDir + '/' + (Split-Path $m -Parent).Replace('\', '/')
    $remoteDir = $remoteDir.TrimEnd('/')
    $lines += "put -transfer=binary `"$local`" `"$remoteDir/`""
  }
  $lines += "exit"
  $scriptFile = Join-Path $env:TEMP ("winscp_put_{0}.txt" -f ([guid]::NewGuid().ToString('N')))
  $lines | Set-Content -Path $scriptFile -Encoding UTF8
  try { & $winscp /ini=nul /log="$root\deploy-missing.log" /script="$scriptFile" | Out-Null } finally { Remove-Item $scriptFile -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 5
}
$left = Get-Missing
if ($left.Count -eq 0) { Write-Host "TODO EN EL SERVIDOR"; exit 0 }
Write-Host "QUEDAN $($left.Count) archivos sin subir:"; $left | ForEach-Object { Write-Host "  $_" }
exit 1
