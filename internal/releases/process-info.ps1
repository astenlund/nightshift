param([Parameter(Mandatory = $true)][int]$ProcessId, [string]$HostName, [switch]$FindOwner)

$ErrorActionPreference = 'Stop'
$currentId = $ProcessId
for ($depth = 0; $depth -lt 16; $depth++) {
    $item = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$currentId"
    if ($null -eq $item) { [Console]::Out.WriteLine('{"found":false}'); exit 0 }
    if (-not $FindOwner -or [string]::Equals($item.Name, "$HostName.exe", [StringComparison]::OrdinalIgnoreCase)) {
        $result = @{ found = $true; pid = [int]$item.ProcessId; name = $item.Name; created = $item.CreationDate.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture) }
        [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
        exit 0
    }
    if ($item.ParentProcessId -eq 0 -or $item.ParentProcessId -eq $currentId) { break }
    $currentId = [int]$item.ParentProcessId
}
[Console]::Out.WriteLine('{"found":false}')
