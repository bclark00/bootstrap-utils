# deploy-tools.ps1 — Pull tool-cdn tools, verify hashes, install locally
# Run once (or on update) — after this, Claude Desktop uses local verified copies

$TOKEN = $env:PV_TOKEN
$CDN   = "https://api.github.com/repos/Primevelocity/tool-cdn/contents"
$DEST  = "C:\Genesis\tool-cdn"

$TOOLS = @{
    "filesystem-mcp.js" = "e47cd59df16c42b5db215b6c57ab1c879b44feaa042baf9f84a2871a9e6e634a"
}

New-Item -ItemType Directory -Force -Path $DEST | Out-Null

foreach ($file in $TOOLS.Keys) {
    $expected = $TOOLS[$file]
    $outPath  = Join-Path $DEST $file

    Write-Host "Fetching $file..."
    $resp = Invoke-RestMethod "$CDN/$file" `
        -Headers @{ Authorization = "Bearer $TOKEN" }
    $bytes = [Convert]::FromBase64String($resp.content -replace '\n','')

    # Verify SHA256
    $actual = ([System.BitConverter]::ToString(
        [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    ) -replace '-','').ToLower()

    if ($actual -ne $expected) {
        Write-Error "HASH MISMATCH for $file`n  expected: $expected`n  actual:   $actual"
        exit 1
    }

    [System.IO.File]::WriteAllBytes($outPath, $bytes)
    Write-Host "  OK: $outPath (sha256: $actual)"
}

Write-Host "`nAll tools verified and installed to $DEST"
