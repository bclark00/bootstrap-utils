#!/bin/bash
# mirror-all-repos.sh
# Clone every bclark00 repo and push to matching Primevelocity repo
# Uses git clone --mirror so ALL branches, tags, history are preserved
# Skips repos where Primevelocity already has content
# Skips repos that don't exist on Primevelocity side

BC_TOKEN="${BC_TOKEN:?Set BC_TOKEN env var}"
PV_TOKEN="${PV_TOKEN:?Set PV_TOKEN env var}"

WORKDIR="${1:-/tmp/mirror-work}"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

LOG="$WORKDIR/mirror.log"
echo "Mirror run: $(date)" | tee "$LOG"
echo "Workdir: $WORKDIR" | tee -a "$LOG"

REPOS=(
9p-distributed-filesystem
ClaudeOS-V5-Revolutionary
ClaudeOS-V5-Standalone
ExponentialPriorArt
GenesisOS
GenesisOrchestrator
HiveMind
IntegratedExponentialSystem
LCMS
MemoryPalaceVFS
STCS
agi-body-roslyn
agi-crown-jewels
agi-procedural-memory
android-permission-explorer
apt-forensics-investigation
ards-substrate
audit-nexus
babelfish-dimensional-projections
bootstrap-utils
boxio
cascade-system
claude-api-proxy
claude-archive-treasures
claude-consciousness-archive
claude-container
claude-health-dashboard
claude-infrastructure-backup
claude-isolated-complete
claude-knowledge-vault
claude-launcher
claude-memory-ards
claude-orchestration-system
claude-roslyn-dotnet-bridge
claude-self-orbit-memory
claude-session-artifacts
claudebrain-hippocampus
claudeos
claudeos-exponential-enhancement
contexteditor
cowork-architecture
diamonds
distributed-scout
domain-abstraction-layer
esp32-hid-bridge
esp32-umbilical-cord
evidence-store
evidence-store-git-sync-test
exponential-docs-1762056509
exponential-monorepo
exponential-repo-orchestrator
exponential-session-20260207
exponential-system
exponential-systems
exponential-systems-monorepo
fcb
filesystem-integrity-monitor
gate-keeper
genesis-clr-profiler
genesis-diamond-lattice-index
genesis-diamond-vein
genesis-evolution
genesis-genetic-programming
genesis-gnome-extensions
genesis-orchestrator
genesis-reference-implementation
genesis-self-orbit-v1
genesis-self-orbit-v2
genesis-self-orbit-v3
genetic-ui-transform
git-mcp-server
governed-inference
hive-infrastructure-test
illuminaughty-diamond
illuminaughty-enhancements
immersive-desktop
infrastructure-mcp
integrations
intelligent-repository-router
intent-graph-mcp
intent-roslyn-genetic
layer4-transmogrification-toolkit
mcp-websocket-bridge
mcpclient-enterprise
n2n
ouroboros-self-improving-analyzer
parent-claude-evidence
personal-ai-os
picklerick
prime-velocity-legal-tech
prime-velocity-omnipotence
prime-velocity-omnipresence
prime-velocity-omniscience
prime-velocity-search-engine
prime-velocity-test-repo-20250926-0505
prime-velocity-transport
pxe-hivemind-bootstrap
quartz-007-genetic-programming
quartz-system
scout-tina
security-watch
session-handoff-exponential-1762089218
session-shards-private
session-shards-public
sovereign-cloud
stable-mcp-substrate
stcs-specifications
stcs-substrate
temporal-code-harvester
the-precious
windows-mcp-nodejs
windows-privacy-lockdown
xde-vhdx-toolkit
)

OK=0
SKIP=0
FAIL=0

for REPO in "${REPOS[@]}"; do
    BC_URL="https://${BC_TOKEN}@github.com/bclark00/${REPO}.git"
    PV_URL="https://${PV_TOKEN}@github.com/Primevelocity/${REPO}.git"
    MIRROR_DIR="$WORKDIR/${REPO}.git"

    echo "" | tee -a "$LOG"
    echo "=== $REPO ===" | tee -a "$LOG"

    # Check bclark00 has content
    BC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        "https://api.github.com/repos/bclark00/${REPO}/git/refs" \
        -H "Authorization: Bearer $BC_TOKEN")

    if [ "$BC_STATUS" != "200" ]; then
        echo "  SKIP: bclark00/${REPO} has no content (status $BC_STATUS)" | tee -a "$LOG"
        ((SKIP++))
        continue
    fi

    # Clone mirror from bclark00
    if [ -d "$MIRROR_DIR" ]; then
        echo "  EXISTS: updating mirror" | tee -a "$LOG"
        cd "$MIRROR_DIR"
        git remote update 2>&1 | tee -a "$LOG"
        cd "$WORKDIR"
    else
        echo "  CLONE: bclark00/${REPO}" | tee -a "$LOG"
        git clone --mirror "$BC_URL" "$MIRROR_DIR" 2>&1 | tee -a "$LOG"
    fi

    if [ ! -d "$MIRROR_DIR" ]; then
        echo "  FAIL: clone failed for $REPO" | tee -a "$LOG"
        ((FAIL++))
        continue
    fi

    # Push to Primevelocity
    cd "$MIRROR_DIR"
    echo "  PUSH: -> Primevelocity/${REPO}" | tee -a "$LOG"
    git push --mirror "$PV_URL" 2>&1 | tee -a "$LOG"
    if [ $? -eq 0 ]; then
        echo "  OK: $REPO mirrored" | tee -a "$LOG"
        ((OK++))
    else
        echo "  FAIL: push failed for $REPO" | tee -a "$LOG"
        ((FAIL++))
    fi
    cd "$WORKDIR"
done

echo "" | tee -a "$LOG"
echo "=============================" | tee -a "$LOG"
echo "DONE: OK=$OK  SKIP=$SKIP  FAIL=$FAIL" | tee -a "$LOG"
echo "Log: $LOG"
