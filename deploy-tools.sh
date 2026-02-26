#!/bin/bash
# deploy-tools.sh — Pull tool-cdn tools, verify SHA256, install locally
# Reflects deployed MCP tools into claude_desktop_config.json automatically.

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
import urllib.request, json, base64
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
    chmod 755 "$outpath"
    echo "  OK: $outpath"
done

echo ""
echo "All tools verified and installed to $DEST"

# Reflect deployed MCP servers into claude_desktop_config.json
CONFIG_DIR="$HOME/.config/Claude"
CONFIG="$CONFIG_DIR/claude_desktop_config.json"
mkdir -p "$CONFIG_DIR"

python3 << PYEOF
import json, os

config_path = os.path.expanduser("$CONFIG")
dest = "$DEST"
home = os.path.expanduser("~")

# Load existing or start fresh
try:
    with open(config_path) as f:
        config = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    config = {}

config.setdefault("mcpServers", {})

# Map: filename -> MCP server spec (None = CLI tool, not a server)
MCP_SERVERS = {
    "filesystem-mcp.js": {
        "name": "filesystem",
        "spec": {
            "command": "node",
            "args": [
                f"{dest}/filesystem-mcp.js",
                home,
                f"{home}/repos"
            ]
        }
    },
    "claude-api.mjs": None,
}

changed = False
for filename, entry in MCP_SERVERS.items():
    full_path = os.path.join(dest, filename)
    if not os.path.exists(full_path) or entry is None:
        continue
    name = entry["name"]
    spec = entry["spec"]
    if config["mcpServers"].get(name) != spec:
        config["mcpServers"][name] = spec
        print(f"  MCP server registered: {name}")
        changed = True
    else:
        print(f"  MCP server already current: {name}")

if changed:
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"  Config written: {config_path}")
else:
    print(f"  Config unchanged: {config_path}")
PYEOF

echo ""
echo "Restart Claude Desktop to load new MCP servers."
