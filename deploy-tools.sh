#!/bin/bash
# deploy-tools.sh — Pull tool-cdn tools, verify SHA256, install locally.
# Reflects deployed tools into claude_desktop_config.json via genesis-mcp facade.

set -euo pipefail

TOKEN="${PV_TOKEN:?PV_TOKEN required}"
CDN="https://api.github.com/repos/Primevelocity/tool-cdn/contents"
DEST="${TOOL_CDN_DIR:-/home/zorin/tool-cdn}"

declare -A TOOLS=(
    ["genesis-mcp.js"]="c8d081692eeee39c552fa3639a0fab3e0d3e755e4c37362b940d7f85459e075a"
    ["filesystem-mcp.js"]="e47cd59df16c42b5db215b6c57ab1c879b44feaa042baf9f84a2871a9e6e634a"
    ["claude-api.mjs"]="dc29b2338b5d8719566f5fef1c3e2ddd42c7215a6049fcd0b6c519d8abc51890"
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
        echo "HASH MISMATCH: $file  expected=$expected  actual=$actual"
        exit 1
    fi
    mv /tmp/_tool_cdn_tmp "$outpath"
    chmod 755 "$outpath"
    echo "  OK: $outpath"
done

echo ""
echo "All tools verified and installed to $DEST"

# Reflect into claude_desktop_config.json — single genesis-mcp entry covers everything
CONFIG_DIR="$HOME/.config/Claude"
CONFIG="$CONFIG_DIR/claude_desktop_config.json"
mkdir -p "$CONFIG_DIR"

python3 << PYEOF
import json, os

config_path = "$CONFIG"
dest        = "$DEST"
home        = os.path.expanduser("~")

try:
    with open(config_path) as f:
        config = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    config = {}

config.setdefault("mcpServers", {})

# genesis-mcp is the single facade — it dynamically exposes everything else
# Find node binary (nvm-aware)
import shutil, subprocess
node_bin = shutil.which("node") or subprocess.run(
    ["bash", "-lc", "which node"], capture_output=True, text=True
).stdout.strip() or "node"

spec = {
    "command": node_bin,
    "args": [
        f"{dest}/genesis-mcp.js",
        home,
        f"{home}/repos"
    ],
    "env": {
        "TOOL_CDN_DIR": dest
    }
}

changed = config["mcpServers"].get("genesis") != spec
if changed:
    config["mcpServers"]["genesis"] = spec
    # Remove legacy standalone filesystem entry if present
    config["mcpServers"].pop("filesystem", None)
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"  Config updated: {config_path}")
    print(f"  MCP server: genesis -> {dest}/genesis-mcp.js")
else:
    print(f"  Config already current: {config_path}")
PYEOF

echo ""
echo "Restart Claude Desktop to load genesis-mcp."
echo "Tools exposed: fs:*, compose, claude-api:* (and any future tool-cdn additions)"
