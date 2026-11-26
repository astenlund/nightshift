param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f-]{36}$')][string]$PublicationId,
    [Parameter(Mandatory)][ValidateSet('next', 'previous', 'lock')][string]$Part
)

$ErrorActionPreference = 'Stop'
$modelDirectory = Join-Path ([IO.Path]::GetFullPath($ProjectRoot)) '.nightshift'
$setupDirectory = Join-Path $modelDirectory 'setup'
foreach ($directory in @($modelDirectory, $setupDirectory)) {
    $item = Get-Item -LiteralPath $directory -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'The review model directories must be ordinary project directories.'
    }
}

$source = Join-Path $setupDirectory ('review-model-' + $PublicationId + '.' + $Part)
$target = if ($Part -ceq 'lock') {
    Join-Path $setupDirectory 'review-model.lock.sqlite'
} else {
    Join-Path $modelDirectory 'REVIEW.md'
}
[IO.File]::Move($source, $target)
