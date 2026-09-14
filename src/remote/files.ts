import { powershellQuote, windowsStorage } from './powershell';

export function windowsAttachmentPath(sanitizedName: string): string {
  return `
$directory=Join-Path ([IO.Path]::GetTempPath()) 'ghostex-mobile-attachments'
[IO.Directory]::CreateDirectory($directory) | Out-Null
$path=Join-Path $directory (([guid]::NewGuid().ToString('N')) + '-' + ${powershellQuote(sanitizedName)})
[IO.File]::Open($path,[IO.FileMode]::CreateNew).Dispose()
Write-Output $path
`;
}

export function windowsChatUploadPath(directory: 'i' | 'f', prefix: string, tail: string): string {
  return `${windowsStorage}
$directory=Join-Path $gxData ${powershellQuote(directory)}
[IO.Directory]::CreateDirectory($directory) | Out-Null
for ($index=1; $index -le 100; $index++) {
  $suffix=if ($index -eq 1) { '' } else { '-' + $index }
  $path=Join-Path $directory (${powershellQuote(prefix)} + $suffix + ${powershellQuote(tail)})
  try {
    [IO.File]::Open($path,[IO.FileMode]::CreateNew).Dispose()
    Write-Output $path
    exit 0
  } catch [IO.IOException] { if (!(Test-Path -LiteralPath $path)) { throw } }
}
throw 'Could not reserve an attachment path.'
`;
}

export function windowsReadImage(path: string, maximumBytes: number): string {
  return `
$file=Get-Item -LiteralPath ${powershellQuote(path)}
if ($file.PSIsContainer -or $file.Length -le 0 -or $file.Length -gt ${maximumBytes}) { throw 'Image is unreadable or too large.' }
[Console]::Write([Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName)))
`;
}
