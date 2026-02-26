#!/bin/bash
# deploy-tools.sh — Pull tool-cdn tools, verify SHA256, install locally
# Run once (or on update). After this Claude Desktop uses local verified copies.

set -euo pipefail

TOKEN="${PV_TOKEN:?PV_TOKEN required}"
CDN="https://api.github.com/repos/Primevelocity/tool-cdn/contents"
DEST="${TOOL_CDN_DIR:-/home/zorin/tool-cdn}"

declare -A TOOLS=(
    ["filesystem-mcp.js"]="e47cd59df16c42b5db215b6c57ab1c879b44feaa042baf9f84a2871a9e6e634a"
    ["claude-api.mjs"]="88476c8eb6f1f76dce3b18fc1c9417496251c7134caa1cb94be5862c6263c5c3"
)

mkdir -p "$DEST"

for file in "${!TOOLS[@]}"; do
    expected="${TOOLS[$file]}"
    outpath="$DEST/$file"

    echo "Fetching $file..."
    python3 -c "
import urllib.request, json, base64, sys
resp = urllib.request.urlopen(urllib.request.Request(
    '$CDN/$file',
    headers={'Authorization': 'Bearer $TOKEN'}
))
d = json.loads(resp.read())
content = base64.b64decode(d['content'].replace('\n',''))
open('/tmp/_tool_cdn_tmp', 'wb').write(content)
"
    actual=$(sha256sum /tmp/_tool_cdn_tmp | cut -d' ' -f1)

    if [ "$actual" != "$expected" ]; then
        echo "HASH MISMATCH: $file"
        echo "  expected: $expected"
        echo "  actual:   $actual"
        exit 1
    fi

    mv /tmp/_tool_cdn_tmp "$outpath"
    chmod +x "$outpath"
    echo "  OK: $outpath"
done

echo ""
echo "All tools verified and installed to $DEST"
