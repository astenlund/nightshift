param([Parameter(Mandatory)][string]$Executable)

$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $Executable
$publisher = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) }
@{ valid = $signature.Status.ToString() -ceq 'Valid'; publisher = $publisher } | ConvertTo-Json -Compress
