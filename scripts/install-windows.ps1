# TAKI Agentic AI - cài đặt trên máy Windows mới (từ gói zip đóng gói sẵn).
# Chạy bằng INSTALL.cmd (nhấp đúp). An toàn khi chạy lại: bước nào xong rồi sẽ được bỏ qua.
#   -SkipVideoAi   bỏ qua công cụ video AI (MoneyPrinterTurbo, LivePortrait, Remotion) - nhẹ hơn nhưng mất tính năng video tại máy
#   -SkipZlcrm     bỏ qua ZL-CRM (Zalo)
#   -NoShortcut    không tạo lối tắt ngoài Desktop
param([switch]$SkipVideoAi, [switch]$SkipZlcrm, [switch]$NoShortcut)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
$LogFile = Join-Path $Root 'install.log'
try { Start-Transcript -Path $LogFile -Append | Out-Null } catch {}
$env:CI = 'true'
$env:PYTHONUTF8 = '1'
$failed = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]

function Step($m) { Write-Host "`n>> $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "   [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "   [!]  $m" -ForegroundColor Yellow }
function Has($n) { [bool](Get-Command $n -ErrorAction SilentlyContinue) }

function Refresh-Path {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($m, $u, $env:Path) | Where-Object { $_ }) -join ';'
  foreach ($extra in @((Join-Path $env:APPDATA 'npm'), (Join-Path $env:USERPROFILE '.local\bin'), (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'), 'C:\Program Files\Git\cmd', 'C:\Program Files\nodejs')) {
    if ((Test-Path -LiteralPath $extra) -and ($env:Path -notlike "*$extra*")) { $env:Path = "$env:Path;$extra" }
  }
}

function Run([string]$Cmd, [string[]]$CmdArgs = @(), [string]$Dir = $Root) {
  Push-Location -LiteralPath $Dir
  try {
    & $Cmd @CmdArgs
    if ($LASTEXITCODE -ne 0) { throw "Lệnh lỗi (mã $LASTEXITCODE): $Cmd $($CmdArgs -join ' ')" }
  } finally { Pop-Location }
}

function Winget-Install([string]$Id, [string]$Label) {
  if (-not (Has 'winget')) {
    throw "Máy chưa có winget nên không tự cài được $Label. Cài 'App Installer' từ Microsoft Store (hoặc cài tay $Label) rồi chạy lại INSTALL.cmd."
  }
  Write-Host "   Đang cài $Label (có thể hiện hộp thoại xin quyền Admin - hãy bấm Yes)..."
  & winget install --id $Id -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  # 0 = xong; -1978335189 (0x8A15002B) = đã có bản mới nhất
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { throw "winget cài $Label không thành công (mã $LASTEXITCODE)." }
  Refresh-Path
}

function Set-EnvValue([string]$File, [string]$Key, [string]$Value) {
  if (-not (Test-Path -LiteralPath $File)) { return }
  $utf8 = New-Object Text.UTF8Encoding($false)
  $text = [IO.File]::ReadAllText($File, $utf8)
  $line = "$Key=$Value"
  if ($text -match "(?m)^$([regex]::Escape($Key))=.*$") { $text = [regex]::Replace($text, "(?m)^$([regex]::Escape($Key))=.*$", { param($m) $line }) }
  else { $text = $text.TrimEnd() + "`r`n$line`r`n" }
  [IO.File]::WriteAllText($File, $text, $utf8)
}

function Optional-Step([string]$Name, [scriptblock]$Body) {
  try { & $Body } catch { Warn "$Name chưa xong: $($_.Exception.Message)"; $failed.Add($Name) }
}

Write-Host "TAKI Agentic AI - cài đặt máy mới" -ForegroundColor White
Write-Host "Thư mục cài: $Root"

# 0) Kiểm tra máy ------------------------------------------------------------------------------------
Step 'Kiểm tra máy'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Cần Windows 64-bit.' }
if ($Root.Length -gt 80) { Warn "Đường dẫn cài đặt dài ($($Root.Length) ký tự) - có thể gây lỗi 'đường dẫn quá dài' của Windows. Nên giải nén vào thư mục ngắn như C:\TAKI." }
if ($Root -match '[^\x00-\x7F]') { Warn 'Đường dẫn cài đặt có ký tự tiếng Việt/có dấu - công cụ Python/Remotion có thể lỗi. Nên giải nén vào thư mục không dấu như C:\TAKI.' }
$drive = Get-PSDrive -Name ($Root.Substring(0, 1)) -ErrorAction SilentlyContinue
if ($drive -and ($drive.Free / 1GB) -lt 15) { throw ("Ổ đĩa chỉ còn {0:N1} GB trống - cần ít nhất 15 GB." -f ($drive.Free / 1GB)) }
Ok ("Windows 64-bit, ổ đĩa còn {0:N0} GB trống" -f ($drive.Free / 1GB))
Refresh-Path
try { $null = Invoke-WebRequest -Uri 'https://registry.npmjs.org/' -UseBasicParsing -Method Head -TimeoutSec 20; Ok 'Có Internet' }
catch { Warn 'Không kết nối được Internet (registry.npmjs.org) - cài đặt cần Internet để tải thư viện.' }

# Bật đường dẫn dài của Windows (cần Admin; không có quyền thì bỏ qua) + khôi phục tệp có tên tiếng Việt / đường dẫn rất dài.
# Gói zip lưu các tệp này dưới tên ASCII ngắn (_restore\NNNNN) để mọi công cụ giải nén đều không lỗi.
try { Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1 -Type DWord -ErrorAction Stop } catch { }
$restoreManifest = Join-Path $Root '_restore\manifest.json'
if (Test-Path -LiteralPath $restoreManifest) {
  Step 'Khôi phục tệp có tên tiếng Việt / đường dẫn dài'
  $ext = '\\?\' + $Root
  $man = Get-Content -LiteralPath $restoreManifest -Raw -Encoding UTF8 | ConvertFrom-Json
  $n = 0
  foreach ($d in $man.dirs) { [void][IO.Directory]::CreateDirectory($ext + '\' + ($d -replace '/', '\')) }
  foreach ($f in $man.files) {
    $src = $ext + '\' + ($f.stored -replace '/', '\')
    $dst = $ext + '\' + ($f.restoreTo -replace '/', '\')
    if ([IO.File]::Exists($dst)) { continue }
    if (-not [IO.File]::Exists($src)) { throw "Thiếu tệp trong gói: $($f.stored)" }
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dst))
    [IO.File]::Copy($src, $dst)
    $n++
  }
  Ok "Đã khôi phục $n tệp (ghi chú Brain, tên tiếng Việt, đường dẫn dài)"
}

# 1) Phần mềm nền -------------------------------------------------------------------------------------
Step 'Phần mềm nền (Node.js 24, Git, uv, ffmpeg, Visual C++)'
function Node-Major { if (-not (Has 'node')) { return 0 }; try { [int]((& node -v).TrimStart('v').Split('.')[0]) } catch { 0 } }
if ((Node-Major) -lt 24) { Winget-Install 'OpenJS.NodeJS.LTS' 'Node.js (LTS)' }
if ((Node-Major) -lt 24) { throw "Cần Node.js 24 trở lên (đang có $(if (Has 'node') { & node -v } else { 'không có' })). Cài từ https://nodejs.org rồi chạy lại." }
Ok "Node.js $(& node -v)"
if (-not (Has 'git')) { Winget-Install 'Git.Git' 'Git' }
if (Has 'git') { Ok "Git $((& git --version))" } else { throw 'Chưa có Git - cài từ https://git-scm.com rồi chạy lại.' }
if (-not (Has 'uv')) { Winget-Install 'astral-sh.uv' 'uv (Python manager)' }
if (Has 'uv') { Ok "uv $((& uv --version))" } else { Warn 'Chưa có uv - công cụ video AI sẽ không cài được.' ; $notes.Add('Cài uv (winget install astral-sh.uv) rồi chạy lại INSTALL.cmd để có video AI.') }
if (-not (Has 'ffmpeg')) { Optional-Step 'ffmpeg' { Winget-Install 'Gyan.FFmpeg' 'ffmpeg' } }
if (Has 'ffmpeg') { Ok 'ffmpeg' } else { $notes.Add('Cài ffmpeg (winget install Gyan.FFmpeg) để ghép video.') }
$vc = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction SilentlyContinue
if (-not $vc -or -not $vc.Installed) { Optional-Step 'Visual C++ Runtime' { Winget-Install 'Microsoft.VCRedist.2015+.x64' 'Visual C++ Runtime' } } else { Ok 'Visual C++ Runtime' }
$chromeOk = (Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe') -or (Test-Path 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe') -or (Test-Path (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))
if (-not $chromeOk) { Optional-Step 'Google Chrome' { Winget-Install 'Google.Chrome' 'Google Chrome' } } else { Ok 'Google Chrome' }

# 2) pnpm + Claude Code CLI + Codex CLI --------------------------------------------------------------
Step 'pnpm, Claude Code CLI, Codex CLI'
$pnpmWanted = ((Get-Content (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).packageManager -split '@')[1]
$pnpmHave = $null
if (Has 'pnpm') { try { $pnpmHave = (& pnpm -v) | Select-Object -First 1 } catch {} }
if (-not $pnpmHave) { Run 'npm' @('install', '-g', "pnpm@$pnpmWanted"); Refresh-Path; $pnpmHave = (& pnpm -v) | Select-Object -First 1 }
Ok "pnpm $pnpmHave (repo khóa $pnpmWanted)"
if (-not (Has 'claude')) { Optional-Step 'Claude Code CLI' { Run 'npm' @('install', '-g', '@anthropic-ai/claude-code'); Refresh-Path } }
if (-not (Has 'codex')) { Optional-Step 'Codex CLI' { Run 'npm' @('install', '-g', '@openai/codex'); Refresh-Path } }
$npmRoot = (& npm root -g | Select-Object -First 1)
$claudeExe = Join-Path $npmRoot '@anthropic-ai\claude-code\bin\claude.exe'
if (Test-Path -LiteralPath $claudeExe) {
  $fwd = $claudeExe -replace '\\', '/'
  Set-EnvValue (Join-Path $Root '.env') 'CLAUDE_CLI_PATH' $fwd
  Set-EnvValue (Join-Path $Root 'services\zl-crm\backend\.env') 'CLAUDE_CLI_BIN' $fwd
  Ok "Claude Code CLI: $fwd (đã ghi vào .env)"
} else { Warn 'Không tìm thấy claude.exe - agent sẽ chạy chế độ sandbox cho tới khi cài Claude Code CLI.'; $notes.Add('Cài Claude Code CLI: npm install -g @anthropic-ai/claude-code, rồi chạy lại INSTALL.cmd.') }
if (Has 'codex') { Ok 'Codex CLI' } else { $notes.Add('Cài Codex CLI (npm install -g @openai/codex) nếu dùng tài khoản AI Codex.') }

# 3) Thư viện hệ thống + skill + kiểm tra ----------------------------------------------------------------
Step 'Thư viện hệ thống + skill Phòng Marketing (pnpm install theo lockfile)'
$bootArgs = @('scripts/bootstrap.mjs', '--no-zlcrm', '--no-video', '--no-video-ai')
Run 'node' $bootArgs
Ok 'Đã cài thư viện + chép skill vào ~/.claude'

# 4) ZL-CRM (Zalo) -------------------------------------------------------------------------------------
if (-not $SkipZlcrm) {
  Step 'ZL-CRM (Zalo nhiều nick) + PostgreSQL riêng'
  Optional-Step 'ZL-CRM' {
    $zl = Join-Path $Root 'services\zl-crm'
    if (-not (Test-Path (Join-Path $zl 'backend\.env'))) { throw 'Thiếu services\zl-crm\backend\.env' }
    foreach ($part in 'backend', 'frontend') {
      $dir = Join-Path $zl $part
      if (-not (Test-Path (Join-Path $dir 'node_modules\.package-lock.json'))) { Write-Host "   npm ci ($part)..."; Run 'npm' @('ci', '--no-audit', '--no-fund') $dir } else { Ok "$part đã có thư viện (đóng gói sẵn)" }
    }
    Run 'npx' @('prisma', 'generate') (Join-Path $zl 'backend')
    $pgBin = Join-Path $Root 'runtime\pgsql\bin\pg_ctl.exe'
    if (-not (Test-Path $pgBin)) { throw 'Thiếu runtime\pgsql (PostgreSQL đóng gói sẵn).' }
    if (-not (Test-Path (Join-Path $zl 'data\pgdata\PG_VERSION'))) { throw 'Thiếu dữ liệu PostgreSQL services\zl-crm\data\pgdata.' }
    # Thử bật PostgreSQL của ZL-CRM rồi tắt: xác nhận chạy được trên máy này (không cần cài PostgreSQL hệ thống)
    $res = (& node scripts/zlcrm-pg.mjs start | Select-Object -Last 1)
    if ($res -notmatch '"running":\s*true') { throw "PostgreSQL của ZL-CRM không bật được: $res (xem services\zl-crm\data\postgres.log)" }
    Ok 'PostgreSQL của ZL-CRM chạy được (cổng 5433)'
    & node scripts/zlcrm-pg.mjs stop | Out-Null
  }
}

# 5) Công cụ video AI ----------------------------------------------------------------------------------
if (-not $SkipVideoAi) {
  Step 'Công cụ video AI (Python venv + PyTorch, MoneyPrinterTurbo, LivePortrait, Whisper, Remotion) - 10-30 phút lần đầu'
  Optional-Step 'Video AI' {
    if (-not (Has 'uv')) { throw 'Chưa có uv.' }
    Run 'node' @('scripts/install-video-ai.mjs')
    Ok 'Video AI sẵn sàng'
  }
}

# 6) Lối tắt ---------------------------------------------------------------------------------------------
if (-not $NoShortcut) {
  Optional-Step 'Lối tắt Desktop' {
    $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'TAKI Agentic AI.lnk'
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk); $s.TargetPath = Join-Path $Root 'start-taki.cmd'; $s.WorkingDirectory = $Root; $s.Description = 'Chạy TAKI Agentic AI'; $s.Save()
    Ok 'Đã tạo lối tắt "TAKI Agentic AI" ngoài Desktop'
  }
}

# Kết quả --------------------------------------------------------------------------------------------------
Write-Host ''
if ($failed.Count -gt 0) {
  Write-Host ("CÒN {0} MỤC CHƯA XONG: {1}" -f $failed.Count, ($failed -join ', ')) -ForegroundColor Yellow
  Write-Host 'Kiểm tra Internet rồi chạy lại INSTALL.cmd (các bước đã xong sẽ được bỏ qua). Chi tiết: install.log' -ForegroundColor Yellow
}
else { Write-Host 'CÀI ĐẶT HOÀN TẤT.' -ForegroundColor Green }
Write-Host ''
Write-Host 'Việc cần làm 1 lần trên máy mới:' -ForegroundColor White
Write-Host '  1. Mở cửa sổ PowerShell/CMD mới, gõ:  claude   rồi đăng nhập tài khoản Claude (lệnh /login).'
Write-Host '  2. Chạy hệ thống: nhấp đúp start-taki.cmd (hoặc lối tắt ngoài Desktop) -> http://localhost:5173'
Write-Host '  3. Trang "Sản xuất video Flow": chọn hồ sơ Chrome và đăng nhập Google Flow 1 lần.'
Write-Host '  4. Tài khoản Codex / kênh Facebook, Zalo...: kiểm tra lại trạng thái kết nối trong giao diện.'
foreach ($n in $notes) { Write-Host "  * $n" -ForegroundColor Yellow }
try { Stop-Transcript | Out-Null } catch {}
if ($failed.Count -gt 0) { exit 2 }
exit 0
