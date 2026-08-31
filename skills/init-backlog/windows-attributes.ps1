param()

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList @($false, $true)

function Read-StandardInput() {
    $reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8, $false)
    try {
        return $reader.ReadToEnd()
    } finally {
        $reader.Dispose()
    }
}

function Write-StandardOutput([string]$value) {
    $bytes = $utf8.GetBytes($value)
    $stream = [Console]::OpenStandardOutput()
    $stream.Write($bytes, 0, $bytes.Length)
}

function Test-SafeScalar([string]$value) {
    for ($index = 0; $index -lt $value.Length; $index++) {
        if ([char]::IsHighSurrogate($value[$index]) -and $index + 1 -lt $value.Length -and [char]::IsLowSurrogate($value[$index + 1])) {
            $scalar = [char]::ConvertToUtf32($value[$index], $value[$index + 1])
            if ($scalar -eq 0x10ffff) {
                return $false
            }
            $index++
        }
    }

    return $true
}

function Test-CanonicalAbsolutePath([string]$value) {
    if ([string]::IsNullOrEmpty($value) -or -not (Test-SafeScalar $value) -or -not [System.IO.Path]::IsPathRooted($value)) {
        return $false
    }
    try {
        return [System.IO.Path]::GetFullPath($value) -ceq $value
    } catch {
        return $false
    }
}

# Mirrors Test-RunnerExactKeys in tests/windows-job-runner.ps1; keep both in step.
function Test-ExactKeys($value, [string[]]$expected) {
    if ($null -eq $value) {
        return $false
    }
    $actual = @($value.psobject.Properties.Name)
    $orderedExpected = @($expected | Sort-Object -CaseSensitive)
    return [string]::Join("`n", $actual) -ceq [string]::Join("`n", $orderedExpected)
}

function ConvertTo-JsonScalar([string]$value) {
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append([char]34)
    for ($index = 0; $index -lt $value.Length; $index++) {
        $code = [int][char]$value[$index]
        if ($code -eq 34) {
            [void]$builder.Append([char]92)
            [void]$builder.Append([char]34)
        } elseif ($code -eq 92) {
            [void]$builder.Append([char]92)
            [void]$builder.Append([char]92)
        } elseif ($code -eq 8) {
            [void]$builder.Append([char]92)
            [void]$builder.Append('b')
        } elseif ($code -eq 9) {
            [void]$builder.Append([char]92)
            [void]$builder.Append('t')
        } elseif ($code -eq 10) {
            [void]$builder.Append([char]92)
            [void]$builder.Append('n')
        } elseif ($code -eq 12) {
            [void]$builder.Append([char]92)
            [void]$builder.Append('f')
        } elseif ($code -eq 13) {
            [void]$builder.Append([char]92)
            [void]$builder.Append('r')
        } elseif ($code -lt 32) {
            [void]$builder.Append([char]92)
            [void]$builder.Append('u')
            [void]$builder.Append($code.ToString('x4', [Globalization.CultureInfo]::InvariantCulture))
        } else {
            [void]$builder.Append([char]$code)
        }
    }
    [void]$builder.Append([char]34)
    return $builder.ToString()
}

function ConvertTo-JsonNumber([int64]$value) {
    return $value.ToString([Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-JsonBoolean([bool]$value) {
    if ($value) {
        return 'true'
    }

    return 'false'
}

function ConvertTo-JsonAttributeItem([int64]$attributes, [string]$path, [bool]$reparsePoint) {
    return '{"attributes":' + (ConvertTo-JsonNumber $attributes) + ',"path":' + (ConvertTo-JsonScalar $path) + ',"reparsePoint":' + (ConvertTo-JsonBoolean $reparsePoint) + '}'
}

function ConvertTo-JsonAttributeFailure([int]$index) {
    return '{"code":"attribute-read-failed","index":' + (ConvertTo-JsonNumber $index) + ',"ok":false}'
}

function ConvertTo-JsonAttributeSuccess($items, [string]$systemDirectory) {
    return '{"items":[' + [string]::Join(',', @($items)) + '],"ok":true,"systemDirectory":' + (ConvertTo-JsonScalar $systemDirectory) + '}'
}

try {
    $inputText = Read-StandardInput
    if ([string]::IsNullOrEmpty($inputText) -or -not $inputText.EndsWith("`n") -or $inputText.Substring(0, $inputText.Length - 1).Contains("`n")) {
        throw 'invalid input'
    }
    $request = $inputText.Substring(0, $inputText.Length - 1) | ConvertFrom-Json
    if (-not (Test-ExactKeys $request @('operation', 'paths')) -or $request.operation -cne 'attributes' -or $null -eq $request.paths -or $request.paths -isnot [array]) {
        throw 'invalid request'
    }
    $paths = @($request.paths)
    $previous = $null
    foreach ($path in $paths) {
        if ($path -isnot [string] -or -not (Test-CanonicalAbsolutePath $path) -or ($null -ne $previous -and [string]::CompareOrdinal($previous, $path) -ge 0)) {
            throw 'invalid paths'
        }
        $previous = $path
    }
    $canonicalPaths = @($paths | ForEach-Object { ConvertTo-JsonScalar $_ })
    $canonicalRequest = '{"operation":' + (ConvertTo-JsonScalar $request.operation) + ',"paths":[' + [string]::Join(',', $canonicalPaths) + ']}'
    if ($inputText.Substring(0, $inputText.Length - 1) -cne $canonicalRequest) {
        throw 'noncanonical request'
    }
    $systemDirectory = [Environment]::SystemDirectory
    if (-not (Test-CanonicalAbsolutePath $systemDirectory)) {
        throw 'invalid system directory'
    }
    $items = [System.Collections.Generic.List[string]]::new()
    for ($index = 0; $index -lt $paths.Count; $index++) {
        try {
            $attributes = [System.IO.File]::GetAttributes($paths[$index])
            $number = [int64]$attributes
            $reparsePoint = (($number -band 0x400) -ne 0)
            $items.Add((ConvertTo-JsonAttributeItem $number $paths[$index] $reparsePoint))
        } catch {
            $failure = ConvertTo-JsonAttributeFailure $index
            Write-StandardOutput ($failure + "`n")
            exit 1
        }
    }
    $success = ConvertTo-JsonAttributeSuccess $items $systemDirectory
    Write-StandardOutput ($success + "`n")
    exit 0
} catch {
    exit 2
}
