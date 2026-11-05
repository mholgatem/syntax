// Windows file-type icons for the installed app.
//
// When the installed web app becomes the default program for a file type, the browser
// registers a file-type entry (a "ProgID" under HKCU\Software\Classes) whose DefaultIcon
// has no path, so Explorer shows a blank page. A page can't change that itself, so we
// offer a PowerShell script that points those entries at an .ico of the Syntax icon,
// plus a script that undoes it. Both only touch the current user's registry (HKCU).

/** Where the fix script stores its icon and its backup of the original values. */
export const ICON_FILE = 'syntax-file.ico';
export const BACKUP_KEY = 'Software\\Syntax\\FileIconFix';

export const FIX_SCRIPT_NAME = 'Syntax-Fix-Icons.ps1';
export const UNDO_SCRIPT_NAME = 'Syntax-Undo-Icons.ps1';

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Pack PNG images into an .ico file (PNG-compressed entries, supported since Windows Vista). */
export function buildIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const headerSize = 6 + 16 * images.length;
  const total = headerSize + images.reduce((n, i) => n + i.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);
  let offset = headerSize;
  images.forEach((img, i) => {
    const e = 6 + 16 * i;
    out[e] = img.size >= 256 ? 0 : img.size; // width (0 means 256)
    out[e + 1] = img.size >= 256 ? 0 : img.size; // height
    out[e + 2] = 0; // palette colors
    out[e + 3] = 0; // reserved
    view.setUint16(e + 4, 1, true); // color planes
    view.setUint16(e + 6, 32, true); // bits per pixel
    view.setUint32(e + 8, img.png.length, true);
    view.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Render `src` at each size as PNG bytes, halving step by step so small sizes stay crisp. */
export async function renderIconPngs(src: string, sizes = ICO_SIZES): Promise<{ size: number; png: Uint8Array }[]> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const out: { size: number; png: Uint8Array }[] = [];
  for (const size of sizes) {
    let source: CanvasImageSource = img;
    let w = img.naturalWidth;
    while (w / 2 >= size) {
      w = Math.round(w / 2);
      source = drawScaled(source, w);
    }
    const canvas = drawScaled(source, size);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Could not render the icon');
    out.push({ size, png: new Uint8Array(await blob.arrayBuffer()) });
  }
  return out;
}

function drawScaled(source: CanvasImageSource, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size, size);
  return c;
}

// ---------- PowerShell scripts ----------
// Kept ASCII-only with CRLF line endings: Windows PowerShell 5.1 reads a .ps1 without a
// byte-order mark as the ANSI code page. Avoid "${" in the script text (template literal).

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');

const COMMON = `param([switch]$DryRun, [switch]$NoPause)
$ErrorActionPreference = 'Stop'

$IconDir   = Join-Path $env:LOCALAPPDATA 'Syntax'
$IconPath  = Join-Path $IconDir '${ICON_FILE}'
$IconValue = "$IconPath,0"
$BackupKey = '${BACKUP_KEY}'
$Missing   = '*no DefaultIcon key*'
$HKCU      = [Microsoft.Win32.Registry]::CurrentUser

function Refresh-Icons {
  # Tell Explorer that file associations changed, so it redraws file icons.
  try {
    Add-Type -Namespace SyntaxIconFix -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, uint flags, System.IntPtr item1, System.IntPtr item2);'
    [SyntaxIconFix.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
  } catch {
    try { & (Join-Path $env:SystemRoot 'System32\\ie4uinit.exe') -show } catch {}
  }
}

function Finish {
  if (-not $NoPause) { Write-Host ''; Read-Host 'Press Enter to close' | Out-Null }
}
`;

/** The fix script, with the .ico embedded as base64. */
export function fixIconsScript(icoBase64: string): string {
  return crlf(`# Syntax: fix file-type icons
#
# Files that open with the installed Syntax web app show a blank page icon, because the
# browser registers those file types without an icon. This script gives them the Syntax icon.
#
# - Changes only your own user settings (HKEY_CURRENT_USER). No admin rights needed.
# - Saves the original values first. To undo, run Syntax-Undo-Icons.ps1
#   (Syntax > Settings > Undo-icons script).
# - Reinstalling the app can reset the icons. Just run this script again.
#
# How to run: right-click this file > Run with PowerShell.
# Add -DryRun to only list what would change.

${COMMON}
$IconData = '${icoBase64}'

function Find-SyntaxProgIds {
  # File-type entries the browser made for the Syntax app: they name the app "Syntax" and
  # launch it with --app-id=. Works for Chrome, Edge, Brave and other Chromium browsers.
  $classes = $HKCU.OpenSubKey('Software\\Classes')
  if (-not $classes) { return }
  foreach ($name in $classes.GetSubKeyNames()) {
    if ($name.StartsWith('.')) { continue }
    try {
      $app = $classes.OpenSubKey("$name\\Application")
      if (-not $app) { continue }
      $appName = [string]$app.GetValue('ApplicationName')
      $app.Close()
      if ($appName -ne 'Syntax') { continue }
      $cmdKey = $classes.OpenSubKey("$name\\shell\\open\\command")
      if (-not $cmdKey) { continue }
      $cmd = [string]$cmdKey.GetValue('')
      $cmdKey.Close()
      if ($cmd -like '*--app-id=*') { $name }
    } catch {}
  }
  $classes.Close()
}

try {
  Write-Host 'Syntax: fix file-type icons' -ForegroundColor Cyan
  if ($DryRun) { Write-Host 'Dry run: nothing will be changed.' -ForegroundColor Yellow }
  $ids = @(Find-SyntaxProgIds)
  if ($ids.Count -eq 0) {
    Write-Host 'No file types are registered to the installed Syntax app yet.'
    Write-Host 'Install Syntax from your browser, make it the default app for a file type, then run this again.'
  } else {
    if (-not $DryRun) {
      [IO.Directory]::CreateDirectory($IconDir) | Out-Null
      [IO.File]::WriteAllBytes($IconPath, [Convert]::FromBase64String($IconData))
    }
    $changed = 0
    foreach ($id in $ids) {
      $path = "Software\\Classes\\$id\\DefaultIcon"
      $key = $HKCU.OpenSubKey($path, $true)
      $current = if ($key) { [string]$key.GetValue('') } else { '' }
      if ($current -eq $IconValue) {
        Write-Host "  $id - already fixed"
      } elseif ($current -and -not $current.StartsWith(',')) {
        Write-Host "  $id - has its own icon, left alone"
      } elseif ($DryRun) {
        Write-Host "  $id - would set the Syntax icon"
        $changed++
      } else {
        $backup = $HKCU.CreateSubKey($BackupKey)
        if ($null -eq $backup.GetValue($id)) {
          $backup.SetValue($id, $(if ($key) { $current } else { $Missing }))
        }
        $backup.Close()
        if (-not $key) { $key = $HKCU.CreateSubKey($path) }
        $key.SetValue('', $IconValue)
        Write-Host "  $id - Syntax icon set" -ForegroundColor Green
        $changed++
      }
      if ($key) { $key.Close() }
    }
    if (-not $DryRun) {
      Refresh-Icons
      Write-Host ''
      Write-Host "Done. $changed file-type entr$(if ($changed -eq 1) { 'y' } else { 'ies' }) updated."
      Write-Host 'If some files still show a blank icon, sign out of Windows and back in.'
    }
  }
} catch {
  Write-Host "Something went wrong: $($_.Exception.Message)" -ForegroundColor Red
}
Finish
`);
}

/** The undo script: restores the values the fix script saved and removes its icon. */
export function undoIconsScript(): string {
  return crlf(`# Syntax: undo the file-type icon fix
#
# Restores the file-type icons that Syntax-Fix-Icons.ps1 changed and removes its icon file.
# Changes only your own user settings (HKEY_CURRENT_USER). No admin rights needed.
#
# How to run: right-click this file > Run with PowerShell.
# Add -DryRun to only list what would change.

${COMMON}
try {
  Write-Host 'Syntax: undo file-type icon fix' -ForegroundColor Cyan
  if ($DryRun) { Write-Host 'Dry run: nothing will be changed.' -ForegroundColor Yellow }
  $backup = $HKCU.OpenSubKey($BackupKey, $true)
  if (-not $backup) {
    Write-Host 'No saved icon changes found. Nothing to restore.'
  } else {
    foreach ($id in $backup.GetValueNames()) {
      $original = [string]$backup.GetValue($id)
      $path = "Software\\Classes\\$id\\DefaultIcon"
      $key = $HKCU.OpenSubKey($path, $true)
      if (-not $key) {
        Write-Host "  $id - no longer exists, skipped"
        continue
      }
      $current = [string]$key.GetValue('')
      if ($current -ne $IconValue) {
        Write-Host "  $id - changed since the fix, left alone"
      } elseif ($DryRun) {
        Write-Host "  $id - would restore the original icon"
      } elseif ($original -eq $Missing) {
        $key.Close()
        $key = $null
        $HKCU.DeleteSubKey($path)
        Write-Host "  $id - restored" -ForegroundColor Green
      } else {
        $key.SetValue('', $original)
        Write-Host "  $id - restored" -ForegroundColor Green
      }
      if ($key) { $key.Close() }
    }
    $backup.Close()
    if (-not $DryRun) {
      $HKCU.DeleteSubKey($BackupKey)
      $parent = $HKCU.OpenSubKey('Software\\Syntax')
      if ($parent) {
        $empty = ($parent.SubKeyCount -eq 0 -and $parent.ValueCount -eq 0)
        $parent.Close()
        if ($empty) { $HKCU.DeleteSubKey('Software\\Syntax') }
      }
    }
  }
  if (-not $DryRun) {
    if (Test-Path -LiteralPath $IconPath) { Remove-Item -LiteralPath $IconPath -Force }
    if ((Test-Path -LiteralPath $IconDir) -and -not (Get-ChildItem -LiteralPath $IconDir -Force)) {
      Remove-Item -LiteralPath $IconDir -Force
    }
    Refresh-Icons
    Write-Host ''
    Write-Host 'Done. Files that open with Syntax are back to the browser default icon.'
  }
} catch {
  Write-Host "Something went wrong: $($_.Exception.Message)" -ForegroundColor Red
}
Finish
`);
}
