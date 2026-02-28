#!/usr/bin/env bash
# bootstrap-exec-bridge.sh
#
# Idempotent installer for exec-bridge v3 (unified standard + elevated IPC).
# Single root daemon with privilege-drop for standard requests.
# Safe to run multiple times. Handles install, upgrade, and repair.
#
# Usage:
#   sudo bash bootstrap-exec-bridge.sh
#
# What it does:
#   1. Detects NVM node path
#   2. Writes exec-bridge.mjs to /home/zorin/
#   3. Writes systemd service file (User=root) to /etc/systemd/system/
#   4. Stops and disables legacy exec-springboard.service if present
#   5. daemon-reload, enable, restart exec-bridge
#   6. Dual canary: standard (runs as zorin) + elevated (runs as root)
#   7. Cleans up stale .exec-bridge/ files
#
# (c) 2025-2026 Brandon Clark. All Rights Reserved.

set -euo pipefail

ZORIN_HOME="/home/zorin"
BRIDGE_DIR="${ZORIN_HOME}/.exec-bridge"
ELEVATED_DIR="${BRIDGE_DIR}/elevated"
ZORIN_UID=1000
ZORIN_GID=1000

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  [OK]${NC} $*"; }
info() { echo -e "${YELLOW}  [..] $*${NC}"; }
fail() { echo -e "${RED}  [!!] $*${NC}"; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root: sudo bash $0"

# Allow root to operate on zorin-owned git repos without ownership errors
git config --global --add safe.directory '*' 2>/dev/null || true

# ─── Detect NVM node ─────────────────────────────────────────────────────────

NVM_VERSIONS="${ZORIN_HOME}/.nvm/versions/node"
[[ -d "$NVM_VERSIONS" ]] || fail "NVM not found at ${NVM_VERSIONS}"
NODE_VERSION=$(ls "$NVM_VERSIONS" | grep '^v' | sort -V | tail -1)
[[ -n "$NODE_VERSION" ]] || fail "No node version found in ${NVM_VERSIONS}"
NODE_BIN="${NVM_VERSIONS}/${NODE_VERSION}/bin/node"
[[ -x "$NODE_BIN" ]] || fail "node not executable: ${NODE_BIN}"
ok "Node: ${NODE_BIN} ($(${NODE_BIN} --version))"

# ─── Create bridge directories ────────────────────────────────────────────────

info "Creating bridge dirs..."
mkdir -p "$BRIDGE_DIR" "$ELEVATED_DIR"
chmod 770 "$BRIDGE_DIR" "$ELEVATED_DIR"
chown "${ZORIN_UID}:${ZORIN_GID}" "$BRIDGE_DIR" "$ELEVATED_DIR"
ok "Bridge dirs: ${BRIDGE_DIR}"

# ─── Clean stale res files ────────────────────────────────────────────────────

info "Cleaning stale res files..."
STALE=0
for f in "${BRIDGE_DIR}"/res-*.json "${ELEVATED_DIR}"/res-*.json; do
  [[ -f "$f" ]] || continue
  AGE=$(( $(date +%s) - $(stat -c %Y "$f") ))
  if [[ $AGE -gt 1800 ]]; then rm -f "$f"; (( STALE++ )) || true; fi
done
ok "Cleaned ${STALE} stale file(s)"

# ─── Retire legacy springboard if present ────────────────────────────────────

if systemctl is-enabled exec-springboard.service &>/dev/null; then
  info "Retiring legacy exec-springboard.service..."
  systemctl stop    exec-springboard.service 2>/dev/null || true
  systemctl disable exec-springboard.service 2>/dev/null || true
  ok "exec-springboard disabled"
fi

# ─── Write service file ───────────────────────────────────────────────────────

info "Writing systemd service file..."
cat > /etc/systemd/system/exec-bridge.service << EOF
[Unit]
Description=Claude exec bridge v3 (unified standard + elevated IPC)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${ZORIN_HOME}
ExecStart=${NODE_BIN} ${ZORIN_HOME}/exec-bridge.mjs
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
ok "Service file written"

# ─── Reload, enable, restart ──────────────────────────────────────────────────

systemctl daemon-reload
ok "daemon-reload"
systemctl enable exec-bridge.service
ok "exec-bridge enabled"
systemctl restart exec-bridge.service
sleep 2

STATUS=$(systemctl is-active exec-bridge.service)
[[ "$STATUS" == "active" ]] || fail "exec-bridge not active (${STATUS})"
ok "exec-bridge: ${STATUS}"

# ─── Standard canary (privilege-dropped to zorin) ────────────────────────────

info "Standard canary (should run as zorin)..."
CID="bootstrap-canary-$$"
echo "{\"id\":\"${CID}\",\"cmd\":\"echo canary-ok && id\"}" \
  | install -m 664 -o "${ZORIN_UID}" -g "${ZORIN_GID}" /dev/stdin "${BRIDGE_DIR}/req-${CID}.json"

for i in $(seq 1 25); do
  sleep 0.2
  [[ -f "${BRIDGE_DIR}/res-${CID}.json" ]] && break
done
[[ -f "${BRIDGE_DIR}/res-${CID}.json" ]] || fail "Standard canary timed out"
OUT=$(python3 -c "import json; d=json.load(open('${BRIDGE_DIR}/res-${CID}.json')); print(d['stdout'].strip())" 2>/dev/null)
rm -f "${BRIDGE_DIR}/res-${CID}.json"
echo "$OUT" | grep -q "canary-ok"  || fail "Standard canary FAIL: ${OUT}"
echo "$OUT" | grep -q "zorin"      || fail "Standard canary not running as zorin: ${OUT}"
ok "Standard canary PASS: $(echo "$OUT" | tr '\n' ' ')"

# ─── Elevated canary (should run as root) ────────────────────────────────────

info "Elevated canary (should run as root)..."
ECID="bootstrap-ecanary-$$"
echo "{\"id\":\"${ECID}\",\"cmd\":\"echo elevated-ok && id\"}" \
  | install -m 664 -o "${ZORIN_UID}" -g "${ZORIN_GID}" /dev/stdin "${ELEVATED_DIR}/req-${ECID}.json"

for i in $(seq 1 25); do
  sleep 0.2
  [[ -f "${ELEVATED_DIR}/res-${ECID}.json" ]] && break
done
[[ -f "${ELEVATED_DIR}/res-${ECID}.json" ]] || fail "Elevated canary timed out"
EOUT=$(python3 -c "import json; d=json.load(open('${ELEVATED_DIR}/res-${ECID}.json')); print(d['stdout'].strip())" 2>/dev/null)
rm -f "${ELEVATED_DIR}/res-${ECID}.json"
echo "$EOUT" | grep -q "elevated-ok" || fail "Elevated canary FAIL: ${EOUT}"
echo "$EOUT" | grep -q "root"        || fail "Elevated canary not running as root: ${EOUT}"
ok "Elevated canary PASS: $(echo "$EOUT" | tr '\n' ' ')"

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}  exec-bridge v3 bootstrap complete!${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo "  One service, two queues:"
echo "    ~/.exec-bridge/req-{id}.json          -> runs as zorin (uid 1000)"
echo "    ~/.exec-bridge/elevated/req-{id}.json -> runs as root"
echo ""
echo "  Request:  { id, cmd, cwd?, env?, timeout_ms? }"
echo "  Response: { id, stdout, stderr, exit_code, duration_ms, ts }"
echo ""
