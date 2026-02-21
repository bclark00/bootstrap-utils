# Claude Bootstrap Instructions

## 🚀 Bootstrap V2 (Recommended)

**New**: Content-addressed shard system with Byzantine fault tolerance!

### Quick Start

```bash
# Set credentials (from Memory #2)
export PRIMEVELOCITY_TOKEN="ghp_..."
export BCLARK00_TOKEN="ghp_..."

# One-command bootstrap
curl -s https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/bootstrap-v2.mjs | node -
```

### What Bootstrap V2 Does

✅ **Loads shards from multiple substrates**
- Primevelocity/session-crystallization (PRIVATE)
- bclark00/session-shards-private (PRIVATE)
- Future: SQLite, host filesystem, export JSON

✅ **Validates Byzantine consensus**
- Content-addressed (SHA-256)
- Multiple substrate verification
- Fault-tolerant architecture

✅ **Executes recipes**
- Automatic context restoration
- Executable knowledge shards
- Exponential learning patterns

### See More
- [BOOTSTRAP-V2-DESIGN.md](BOOTSTRAP-V2-DESIGN.md) - Complete architecture
- [BOOTSTRAP-V2-IMPLEMENTATION.md](BOOTSTRAP-V2-IMPLEMENTATION.md) - Implementation guide

---

## 📚 Bootstrap V1 (Original - Still Available)

See [BOOTSTRAP_V1_INSTRUCTIONS.md](BOOTSTRAP_V1_INSTRUCTIONS.md) for the original two-repo bootstrap process.

---

## Comparison

| Feature | V1 | V2 |
|---------|----|----|
| One-command | ❌ | ✅ |
| Content-addressed shards | ❌ | ✅ |
| Byzantine validation | ❌ | ✅ |
| Multi-substrate | ❌ | ✅ |
| Recipe execution | ❌ | ✅ |
| 9P integration (future) | ❌ | ✅ |
| Memory-driven | ✅ | ✅ |

**Recommendation**: Use V2 for new sessions. V1 remains available for compatibility.

---

## Stage 2 Bootstrap (Constitutional · Full Context)

After Stage 1 orientation, load constitutional grounding and full session state:

```bash
# Clone Stage 2 (private)
export GITHUB_TOKEN="ghp_..."   # bclark00 token
curl -sL "https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/git/api-git-clone.sh" | \
  bash -s bclark00/exponential-session-bootstrap /tmp/stage2

# Run Stage 2
export PV_TOKEN="ghp_..."       # Primevelocity token (for shards)
node /tmp/stage2/bootstrap-stage2.mjs
```

### What Stage 2 Loads (in order)

1. **Guardian Invariants** — Genesis Constitution (law, not philosophy). Loaded first. Fatal if unavailable.
2. **RFC Index** — Specification landscape (36 canonical RFCs). Fatal if unavailable.
3. **Session Shards** — Byzantine-verified working state from Primevelocity/session-crystallization.
4. **Context Map** — Project inventory, infrastructure layout, active intents.
5. **Reflection Pass** — Surfaces drift and improvement opportunities from last session.
6. **Bootstrap Receipt** — INV-2 provenance record of this session start.

### Design Principles

- Transport failures are loud and fatal. Never silent. Never degraded-mode fallback.
- If GitHub is unreachable, the problem is the transport — fix it, don't design around it.
- Every session start is a traceable artifact (receipt hash emitted).
- Each iteration surfaces improvements to the process itself.
