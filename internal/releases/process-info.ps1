param([Parameter(Mandatory = $true)][int]$ProcessId, [string]$HostName, [switch]$FindOwner)

$ErrorActionPreference = 'Stop'
$currentId = $ProcessId
$child = $null
for ($depth = 0; $depth -lt 16; $depth++) {
    $item = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$currentId"
    # A parent created after its child is a reused PID, so the real parent has exited too.
    if ($null -ne $item -and $null -ne $child -and $item.CreationDate -gt $child.CreationDate) { $item = $null }
    if ($null -eq $item) {
        $result = @{ found = $false }
        if ($null -ne $child) { $result.exitedParent = @{ pid = $currentId; child = $child.Name } }
        [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
        exit 0
    }
    if (-not $FindOwner -or [string]::Equals($item.Name, "$HostName.exe", [StringComparison]::OrdinalIgnoreCase)) {
        $result = @{ found = $true; pid = [int]$item.ProcessId; name = $item.Name; created = $item.CreationDate.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture) }
        [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
        exit 0
    }
    if ($item.ParentProcessId -eq 0 -or $item.ParentProcessId -eq $currentId) { break }
    $child = $item
    $currentId = [int]$item.ParentProcessId
}
[Console]::Out.WriteLine('{"found":false}')
