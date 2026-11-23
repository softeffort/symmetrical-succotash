# Premier Agent — установщик Windows: сам проверяет и ставит Node.js, скачивает и запускает помощника.
# Адрес сервера и код привязки уже вшиты в этот файл (сервер подставляет их в две строки ниже, поэтому здесь эти метки не повторяем).
# Файл должен сохраняться как UTF-8 с BOM — иначе Windows PowerShell 5.1 прочитает русский текст как кракозябры (BOM добавляет сервер при выдаче).
$ErrorActionPreference = 'Stop'
$Server = '__PREMIER_SERVER__'
$Code = '__PREMIER_CODE__'
$NodeDir = Join-Path $env:ProgramFiles 'nodejs'

# Только HTTPS (http — лишь для локальной разработки): по обычному http код помощника могли бы подменить по дороге.
$Server = "$Server".Trim().TrimEnd('/')
if ($Server -notmatch '^https://[^/\s@:]+(:\d+)?$' -and $Server -notmatch '^http://(localhost|127\.0\.0\.1)(:\d+)?$') {
  Write-Host "Адрес сервера '$Server' не подходит: помощник скачивается только по https://. Скачайте установщик заново в чате Premier." -ForegroundColor Red
  pause
  exit 1
}

Write-Host ''
Write-Host '=== Premier Agent ===' -ForegroundColor Cyan
Write-Host ''

function Test-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if (-not $c) { return $false }
  try {
    $v = (& node -v 2>$null)
    if ("$v" -match '^v(\d+)') { return ([int]$Matches[1]) -ge 18 }
  } catch { }
  return $false
}

if ([Environment]::Is64BitOperatingSystem -eq $false) {
  Write-Host 'Нужна 64-битная Windows. Установите Node.js вручную с nodejs.org и запустите Premier-Agent.cmd ещё раз.' -ForegroundColor Red
  pause
  exit 1
}

if (Test-Node) {
  Write-Host 'Node.js найден: ' (node -v)
} else {
  Write-Host 'Node.js 18+ не найден. Устанавливаю автоматически (1-3 минуты).' -ForegroundColor Yellow
  Write-Host 'Windows попросит подтвердить установку (окно UAC) — нажмите «Да».'
  $installed = $false
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host 'Установка через winget...'
    try { winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent } catch { Write-Host "winget: $($_.Exception.Message)" }
    if (Test-Path (Join-Path $NodeDir 'node.exe')) { $installed = $true }
  }
  if (-not $installed) {
    $Ver = '24.11.1'
    $Msi = "https://nodejs.org/dist/v$Ver/node-v$Ver-x64.msi"
    $MsiPath = Join-Path $env:TEMP "node-v$Ver-x64.msi"
    Write-Host "Скачиваю Node.js: $Msi"
    try {
      if (Get-Command curl.exe -ErrorAction SilentlyContinue) { curl.exe -fsSL $Msi -o $MsiPath }
      else { Invoke-WebRequest -Uri $Msi -OutFile $MsiPath -UseBasicParsing }
    } catch { Write-Host "Не удалось скачать Node.js: $($_.Exception.Message)" -ForegroundColor Red }
    if (Test-Path $MsiPath) {
      Write-Host 'Устанавливаю Node.js (тихо, может появиться окно UAC)...'
      $p = Start-Process msiexec.exe -ArgumentList "/i `"$MsiPath`" /qn /norestart" -Wait -PassThru
      if ($p.ExitCode -ne 0) { throw "Установка Node.js завершилась с кодом $($p.ExitCode)" }
      Remove-Item $MsiPath -Force -ErrorAction SilentlyContinue
      if (Test-Path (Join-Path $NodeDir 'node.exe')) { $installed = $true }
    }
  }
  if (-not $installed) {
    Write-Host 'Не удалось установить Node.js автоматически. Установите его вручную с nodejs.org (LTS) и запустите Premier-Agent.cmd ещё раз.' -ForegroundColor Red
    pause
    exit 1
  }
  $env:Path = "$NodeDir;$env:Path"
  if (-not (Test-Node)) {
    Write-Host 'Node.js установлен, но скрипт его не видит. Запустите Premier-Agent.cmd ещё раз.' -ForegroundColor Yellow
    pause
    exit 1
  }
  Write-Host 'Node.js установлен: ' (node -v)
}

$Agent = Join-Path $env:USERPROFILE 'premier-agent.js'
function Get-File($Url, $Out) {
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    curl.exe -fsSL --max-redirs 0 --max-filesize 2097152 $Url -o $Out
    if ($LASTEXITCODE -ne 0) { throw "curl завершился с кодом $LASTEXITCODE" }
  } else {
    Invoke-WebRequest -Uri $Url -OutFile $Out -UseBasicParsing -MaximumRedirection 0
  }
}
# Уже установленный помощник сам обновляется и проверяет подпись обновлений, поэтому поверх него непроверенный код не кладём.
# Исключение — самая старая версия без проверки подписи (в ней нет UPDATE_KEYS): её заменяем, сохранив копию.
$Fresh = -not (Test-Path $Agent)
if (-not $Fresh -and -not (Select-String -Path $Agent -SimpleMatch 'UPDATE_KEYS' -Quiet)) {
  Copy-Item $Agent "$Agent.old" -Force
  Write-Host 'Найдена старая версия помощника без проверки обновлений — заменяю (копия: premier-agent.js.old).' -ForegroundColor Yellow
  $Fresh = $true
}
if ($Fresh) {
  Write-Host "Скачиваю помощника: $Server/premier-agent.js"
  $Tmp = "$Agent.new"
  try {
    Get-File "$Server/premier-agent.js" $Tmp
    try { Get-File "$Server/premier-agent.js.sig" "$Agent.sig" } catch { Write-Host 'Подпись обновлений не скачана — помощник работает, но обновляться сам не будет.' -ForegroundColor Yellow }
    Move-Item $Tmp $Agent -Force
  } catch {
    Remove-Item $Tmp -Force -ErrorAction SilentlyContinue
    Write-Host "Не удалось скачать помощника: $($_.Exception.Message)" -ForegroundColor Red
    pause
    exit 1
  }
} else {
  Write-Host "Помощник уже установлен ($Agent) — запускаю его (он сам проверит подписанные обновления)."
}

Write-Host ''
Write-Host 'Запускаю помощника. Останьтесь в этом окне: пока оно открыто, модель имеет доступ к компьютеру.' -ForegroundColor Green
Write-Host 'Рабочая папка помощника — Premier в вашей домашней папке; команды и всё, что вне неё, подтверждаются в этом окне.'
Write-Host ''

if ($env:PREMIER_AGENT_DRYRUN) {
  Write-Host "[DRYRUN] Агент не запускается (PREMIER_AGENT_DRYRUN=1). Команда была бы: node $Agent --server $Server $Code"
  exit 0
}

& node $Agent --server $Server $Code
pause
