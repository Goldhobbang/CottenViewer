# 로컬 Ollama + Cloudflare Tunnel 자동 실행, .env 갱신
$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
$EnvPath = Join-Path $RepoRoot ".env"
$LogPath = Join-Path $RepoRoot "cloudflared.log"
$OllamaPort = 11434

function Test-Port($port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect("localhost", $port)
        $client.Close()
        return $true
    } catch { return $false }
}

# 1. Ollama 서버 실행 (이미 떠있으면 스킵)
$ollamaUp = Test-Port $OllamaPort

if (-not $ollamaUp) {
    Write-Host "Ollama 서버 시작 중..."
    $env:OLLAMA_MODELS = "D:\.ollama"
    $env:OLLAMA_ORIGINS = "*"
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $OllamaPort) { $ollamaUp = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ollamaUp) { throw "Ollama 서버 기동 실패 (30초 초과)" }
}
Write-Host "Ollama 서버 정상 동작 중 (포트 $OllamaPort)"

# 2. Cloudflare Quick Tunnel 실행, 로그로 URL 추출
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
if (Test-Path $LogPath) { Remove-Item $LogPath -Force }
$OutLogPath = Join-Path $RepoRoot "cloudflared.out.log"
Start-Process -FilePath "cloudflared" `
    -ArgumentList "tunnel","--protocol","http2","--http-host-header","localhost:$OllamaPort","--url","http://localhost:$OllamaPort" `
    -WindowStyle Hidden `
    -RedirectStandardError $LogPath `
    -RedirectStandardOutput $OutLogPath

Write-Host "Cloudflare Tunnel 시작 중, URL 대기..."
$tunnelUrl = $null
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    if (Test-Path $LogPath) {
        $content = Get-Content $LogPath -Raw -ErrorAction SilentlyContinue
        if ($content -match "https://[a-zA-Z0-9\-]+\.trycloudflare\.com") {
            $tunnelUrl = $Matches[0]
            break
        }
    }
    Start-Sleep -Milliseconds 500
}
if (-not $tunnelUrl) { throw "터널 URL 획득 실패 (30초 초과). $LogPath 확인." }

$fullUrl = "$tunnelUrl/v1"

# 3. .env 갱신 (OLLAMA_BASE_URL 라인 교체, 없으면 추가)
if (Test-Path $EnvPath) {
    $lines = Get-Content $EnvPath
} else {
    $lines = @()
}
$pattern = "^OLLAMA_BASE_URL="
$found = $false
$newLines = foreach ($line in $lines) {
    if ($line -match $pattern) {
        $found = $true
        "OLLAMA_BASE_URL=$fullUrl"
    } else {
        $line
    }
}
if (-not $found) { $newLines += "OLLAMA_BASE_URL=$fullUrl" }
Set-Content -Path $EnvPath -Value $newLines -Encoding utf8

# 4. 결과 출력 (복사 가능하도록)
Write-Host ""
Write-Host "===== 완료 ====="
Write-Host "터널 URL: $tunnelUrl"
Write-Host ".env 갱신됨: OLLAMA_BASE_URL=$fullUrl"
Write-Host ""
Write-Host $fullUrl
try { Set-Clipboard -Value $fullUrl; Write-Host "(클립보드에 복사됨)" } catch {}
