param([Parameter(Mandatory = $true)][string]$RequestFile)

$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestFile -Raw | ConvertFrom-Json
$profileRoot = [IO.Path]::GetFullPath($request.profile)
$targetPath = [IO.Path]::GetFullPath($request.target)
$nextPath = [IO.Path]::GetFullPath($request.next)
if (-not [string]::Equals([IO.Path]::GetDirectoryName($targetPath), $profileRoot, [StringComparison]::OrdinalIgnoreCase) -or -not [string]::Equals([IO.Path]::GetDirectoryName($nextPath), $profileRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Settings paths must remain in the selected host profile.' }
if ([IO.Path]::GetFileName($targetPath) -cne 'settings.json' -or [IO.Path]::GetFileName($nextPath) -cnotmatch '^\.nightshift-[a-f0-9-]{36}\.next$') { throw 'Unexpected settings write path.' }

function Get-Digest([byte[]]$Bytes) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

$stream = $null
try {
    if (-not [IO.File]::Exists($targetPath)) {
        if ($null -ne $request.expectedHash) { throw 'configuration-conflict: settings were removed after inspection.' }
        $nextBytes = [IO.File]::ReadAllBytes($nextPath)
        if ((Get-Digest $nextBytes) -cne $request.nextHash) { throw 'configuration-conflict: staged settings changed.' }
        [IO.File]::Move($nextPath, $targetPath)
    }
    else {
        $item = Get-Item -LiteralPath $targetPath -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType -cin @('SymbolicLink', 'Junction', 'HardLink')) { throw 'configuration-conflict: linked settings are unsupported.' }
        $stream = [IO.File]::Open($targetPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        if ($stream.Length -gt 4194304) { throw 'Settings exceed their supported size.' }
        $current = [byte[]]::new([int]$stream.Length)
        $offset = 0
        while ($offset -lt $current.Length) {
            $count = $stream.Read($current, $offset, $current.Length - $offset)
            if ($count -eq 0) { throw 'Settings ended during the protected read.' }
            $offset += $count
        }
        $currentHash = Get-Digest $current
        if ($currentHash -cne $request.nextHash) {
            if ($null -eq $request.expectedHash -or $currentHash -cne $request.expectedHash) { throw 'configuration-conflict: settings differ from both saved states; preserve the recovery files.' }
            $nextBytes = [IO.File]::ReadAllBytes($nextPath)
            if ((Get-Digest $nextBytes) -cne $request.nextHash) { throw 'configuration-conflict: staged settings changed.' }
            $stream.Position = 0
            $stream.Write($nextBytes, 0, $nextBytes.Length)
            $stream.SetLength($nextBytes.Length)
            $stream.Flush($true)
        }
    }
    [Console]::Out.WriteLine('{"written":true}')
}
finally {
    if ($null -ne $stream) { $stream.Dispose() }
}
