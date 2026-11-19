param([Parameter(Mandatory=$true)][string]$ArtifactRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = Join-Path $ArtifactRoot 'MinGit-2.56.0.4-64-bit.zip'
$expanded = Join-Path $ArtifactRoot 'git-windows'
$expected = 'e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877'
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($archiveHash -ne $expected) { throw 'Official release checksum mismatch' }
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
$count = 0
try {
  foreach ($entry in $zip.Entries) {
    if (-not $entry.Name) { continue }
    $target = [System.IO.Path]::GetFullPath((Join-Path $expanded $entry.FullName))
    if (-not $target.StartsWith([System.IO.Path]::GetFullPath($expanded) + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Archive path outside destination' }
    $stream = $entry.Open()
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $entryHash = [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
    $fileHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($entryHash -ne $fileHash) { throw "Extracted entry mismatch: $($entry.FullName)" }
    $count++
  }
} finally { $zip.Dispose() }
if ((Get-ChildItem -LiteralPath $expanded -Recurse -File).Count -ne $count) { throw 'Unexpected files in extracted closure' }
$signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $expanded 'cmd/git.exe')
[ordered]@{
  sourceRelease = 'https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.4'
  sourceArchive = 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/MinGit-2.56.0.4-64-bit.zip'
  sourceGitTag = 'https://github.com/git-for-windows/git/tree/v2.56.0.windows.4'
  archiveSHA256 = $archiveHash
  archiveBytes = (Get-Item -LiteralPath $archive).Length
  verifiedExtractedEntries = $count
  additionalFiles = 0
  gitExecutableAuthenticode = [string]$signature.Status
  sourcePackageInventory = 'git-windows/etc/package-versions.txt'
  closureVerifiedAgainstArchive = $true
} | ConvertTo-Json
