param([string]$Manifest)
$ErrorActionPreference = 'Stop'
$cases = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$results = @(foreach ($case in $cases) {
    if (-not (Test-Path -LiteralPath $case.schema -PathType Leaf) -or -not (Test-Path -LiteralPath $case.document -PathType Leaf)) { throw 'Schema test input is missing.' }
    $validationErrors = @()
    $valid = Test-Json -LiteralPath $case.document -SchemaFile $case.schema -ErrorAction SilentlyContinue -ErrorVariable validationErrors
    if ($null -eq $valid) { throw 'Schema validation produced no verdict.' }
    if (@($validationErrors | Where-Object { $_.FullyQualifiedErrorId -cne 'InvalidJsonAgainstSchemaDetailed,Microsoft.PowerShell.Commands.TestJsonCommand' }).Count) { throw 'Schema validation failed outside the expected data-validation boundary.' }
    [pscustomobject]@{ name = $case.name; valid = $valid }
})
ConvertTo-Json -InputObject $results -Compress
