#!/usr/bin/env bash
# bootstrap-exec-bridge.sh
#
# Idempotent installer for exec-bridge v2 + exec-springboard v2.
# Safe to run multiple times. Handles install, upgrade, and repair.
#
# Usage:
#   sudo bash bootstrap-exec-bridge.sh
#
# What it does:
#   1. Detects NVM node path
#   2. Writes exec-bridge.mjs and exec-springboard.mjs to /home/zorin/
#   3. Writes systemd service files to /etc/systemd/system/
#   4. daemon-reload, enable, restart both services
#   5. Runs canary self-test
#   6. Cleans up stale .exec-bridge/ files
#
# (c) 2025-2026 Brandon Clark. All Rights Reserved.

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────

ZORIN_HOME="/home/zorin"
BRIDGE_DIR="${ZORIN_HOME}/.exec-bridge"
ELEVATED_DIR="${BRIDGE_DIR}/elevated"
ZORIN_UID=1000
ZORIN_GID=1000

# ─── Colors ───────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  [OK]${NC} $*"; }
info() { echo -e "${YELLOW}  [..] $*${NC}"; }
fail() { echo -e "${RED}  [!!] $*${NC}"; exit 1; }

# ─── Root check ───────────────────────────────────────────────────────────────

[[ $EUID -eq 0 ]] || fail "Run as root: sudo bash $0"

# ─── Detect NVM node ─────────────────────────────────────────────────────────

NVM_VERSIONS="${ZORIN_HOME}/.nvm/versions/node"
if [[ ! -d "$NVM_VERSIONS" ]]; then
  fail "NVM not found at ${NVM_VERSIONS}. Install NVM first."
fi

NODE_VERSION=$(ls "$NVM_VERSIONS" | grep '^v' | sort -V | tail -1)
[[ -n "$NODE_VERSION" ]] || fail "No node version found in ${NVM_VERSIONS}"

NODE_BIN="${NVM_VERSIONS}/${NODE_VERSION}/bin/node"
[[ -x "$NODE_BIN" ]] || fail "node not executable: ${NODE_BIN}"
ok "Node: ${NODE_BIN} ($(${NODE_BIN} --version))"

# ─── Create bridge directory ──────────────────────────────────────────────────

info "Creating bridge dirs..."
mkdir -p "$BRIDGE_DIR" "$ELEVATED_DIR"
chmod 700 "$BRIDGE_DIR"
chmod 770 "$ELEVATED_DIR"
chown "${ZORIN_UID}:${ZORIN_GID}" "$BRIDGE_DIR"
chown "${ZORIN_UID}:${ZORIN_GID}" "$ELEVATED_DIR"
ok "Bridge dirs: ${BRIDGE_DIR}"

# ─── Clean up stale res files ─────────────────────────────────────────────────

info "Cleaning stale res files..."
STALE=0
for f in "${BRIDGE_DIR}"/res-*.json "${ELEVATED_DIR}"/res-*.json; do
  [[ -f "$f" ]] || continue
  AGE=$(( $(date +%s) - $(stat -c %Y "$f") ))
  if [[ $AGE -gt 1800 ]]; then
    rm -f "$f"
    (( STALE++ )) || true
  fi
done
ok "Cleaned ${STALE} stale res file(s)"

# ─── Write service files ──────────────────────────────────────────────────────

info "Writing systemd service files..."

cat > /etc/systemd/system/exec-bridge.service << EOF
[Unit]
Description=Claude exec bridge v2 (file-based IPC, zorin)
After=network.target

[Service]
Type=simple
User=zorin
WorkingDirectory=${ZORIN_HOME}
ExecStart=${NODE_BIN} ${ZORIN_HOME}/exec-bridge.mjs
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/exec-springboard.service << EOF
[Unit]
Description=Claude exec springboard v2 (elevated/root worker)
After=network.target exec-bridge.service

[Service]
Type=simple
User=root
WorkingDirectory=${ZORIN_HOME}
ExecStart=${NODE_BIN} ${ZORIN_HOME}/exec-springboard.mjs
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

ok "Service files written"

# ─── Reload, enable, restart ──────────────────────────────────────────────────

info "daemon-reload..."
systemctl daemon-reload
ok "daemon-reload"

info "Enabling services..."
systemctl enable exec-bridge.service exec-springboard.service
ok "Services enabled"

info "Restarting services..."
systemctl restart exec-bridge.service
systemctl restart exec-springboard.service
sleep 2
ok "Services restarted"

# ─── Status check ─────────────────────────────────────────────────────────────

BRIDGE_STATUS=$(systemctl is-active exec-bridge.service)
SPRING_STATUS=$(systemctl is-active exec-springboard.service)

[[ "$BRIDGE_STATUS" == "active" ]] || fail "exec-bridge not active (${BRIDGE_STATUS})"
[[ "$SPRING_STATUS" == "active" ]] || fail "exec-springboard not active (${SPRING_STATUS})"
ok "exec-bridge: ${BRIDGE_STATUS}"
ok "exec-springboard: ${SPRING_STATUS}"

# ─── Canary test ──────────────────────────────────────────────────────────────

info "Running canary test..."

CANARY_ID="bootstrap-canary-$$"
REQ_FILE="${BRIDGE_DIR}/req-${CANARY_ID}.json"
RES_FILE="${BRIDGE_DIR}/res-${CANARY_ID}.json"

echo "{\"id\":\"${CANARY_ID}\",\"cmd\":\"echo bootstrap-canary-ok && node --version\"}" > "$REQ_FILE"
chown "${ZORIN_UID}:${ZORIN_GID}" "$REQ_FILE"

# Poll up to 5 seconds
for i in $(seq 1 25); do
  sleep 0.2
  [[ -f "$RES_FILE" ]] && break
done

if [[ ! -f "$RES_FILE" ]]; then
  fail "Canary timed out -- exec-bridge may not be processing"
fi

CANARY_OUT=$(python3 -c "import json,sys; d=json.load(open('${RES_FILE}')); print(d['stdout'].strip()); print('exit', d['exit_code'])" 2>/dev/null || echo "parse error")
rm -f "$RES_FILE"

if echo "$CANARY_OUT" | grep -q "bootstrap-canary-ok"; then
  ok "Canary PASS: ${CANARY_OUT}"
else
  fail "Canary FAIL: ${CANARY_OUT}"
fi

# ─── Elevated canary ──────────────────────────────────────────────────────────

info "Running elevated canary test..."

ECANARY_ID="bootstrap-ecanary-$$"
EREQ_FILE="${ELEVATED_DIR}/req-${ECANARY_ID}.json"
ERES_FILE="${ELEVATED_DIR}/res-${ECANARY_ID}.json"

echo "{\"id\":\"${ECANARY_ID}\",\"cmd\":\"echo elevated-canary-ok && id\"}" > "$EREQ_FILE"
chown "${ZORIN_UID}:${ZORIN_GID}" "$EREQ_FILE"

for i in $(seq 1 25); do
  sleep 0.2
  [[ -f "$ERES_FILE" ]] && break
done

if [[ ! -f "$ERES_FILE" ]]; then
  fail "Elevated canary timed out -- exec-springboard may not be processing"
fi

ECANARY_OUT=$(python3 -c "import json,sys; d=json.load(open('${ERES_FILE}')); print(d['stdout'].strip())" 2>/dev/null || echo "parse error")
rm -f "$ERES_FILE"

if echo "$ECANARY_OUT" | grep -q "elevated-canary-ok"; then
  ok "Elevated canary PASS: ${ECANARY_OUT}"
else
  fail "Elevated canary FAIL: ${ECANARY_OUT}"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  exec-bridge v2 bootstrap complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Bridge dir  : ${BRIDGE_DIR}"
echo "  Elevated dir: ${ELEVATED_DIR}"
echo "  Node        : ${NODE_BIN}"
echo ""
echo "  Services:"
echo "    exec-bridge       -- runs as zorin, handles standard commands"
echo "    exec-springboard  -- runs as root, handles elevated commands"
echo ""
echo "  Usage from Claude container:"
echo "    Write: ~/.exec-bridge/req-{id}.json  = { id, cmd, cwd?, env?, timeout_ms? }"
echo "    Read:  ~/.exec-bridge/res-{id}.json  = { id, stdout, stderr, exit_code, duration_ms }"
echo "    Elevated: use elevated/ subdirectory"
echo ""
