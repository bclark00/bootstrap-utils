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
