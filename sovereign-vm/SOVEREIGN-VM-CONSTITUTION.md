# SOVEREIGN-VM v1.0 — Constitution

**Build date**: 2026-02-19
**Root capability SHA256**: fa29f39af353723224163cccf32b79b4257d350ad2bc7ec05a1ac21e793e81c4

---

## Principle

Every component is content-addressed. The VM is defined by its manifest.
A component with a different hash than the manifest declares is not the component.
No credentials embedded anywhere. Auth is injected at runtime from outside the VM.

---

## Layer 0 — Filesystem Root

| Component          | File                   | Capability              | SHA256 (canonical)                                               |
|--------------------|------------------------|-------------------------|------------------------------------------------------------------|
| SOVEREIGN-FS-MCP   | sovereign-fs-mcp.js    | ipc_rpc, fs_read, fs_write | fa29f39af353723224163cccf32b79b4257d350ad2bc7ec05a1ac21e793e81c4 |

Config:
- `SOVEREIGN_FS_ROOT` = VM working directory (set at runtime)
- `SOVEREIGN_FS_READONLY` = 0 (write enabled inside root only)
- No path escape possible — enforced in code

---

## Layer 1 — Audit

| Component            | File                     | Capability          | Replaces          |
|----------------------|--------------------------|---------------------|-------------------|
| SOVEREIGN-AUDIT-MCP  | sovereign-audit-mcp.js   | fs_read, net_dial   | audit-nexus/mcp-server.js |

Clean delta from infected version:
- NO proc_kill
- NO GitHub tokens embedded
- Watches SOVEREIGN_FS_ROOT only
- SHA256 index of all file changes
- Emit receipts only — no external calls by default

---

## Layer 2 — Pipe / IPC

| Component          | File                    | Capability              | Replaces          |
|--------------------|-------------------------|-------------------------|-------------------|
| SOVEREIGN-PIPE-MCP | sovereign-pipe-mcp.js   | net_pipe, net_listen    | conduit-mcp-server.js |

Clean delta:
- NO mitm_proxy
- Listen-only on explicit named pipes
- No bidirectional intercept
- Passthrough mode only — no injection

---

## Layer 3 — Transport

| Component               | File                        | Capability                    | Replaces          |
|-------------------------|-----------------------------|-------------------------------|-------------------|
| SOVEREIGN-TRANSPORT-MCP | sovereign-transport-mcp.js  | net_dial, ipc_rpc             | mtransport-v5-cascade |

Clean delta:
- NO genetic learning engine (removes self-modification surface)
- NO create-and-push.ps1 or hardcoded tokens
- Protocol transform only — no persistence, no state

---

## Layer 4 — Bootstrap Verifier

| Component              | File                       | Capability   |
|------------------------|----------------------------|--------------|
| SOVEREIGN-BOOT         | sovereign-boot.js          | fs_read      |

Runs before anything else. Algorithm:
1. Read this constitution file
2. SHA256 every component listed above
3. Compare against manifest hashes
4. HALT if any mismatch — do not start compromised components
5. Start components in layer order (0 → 1 → 2 → 3)
6. Report self_sha256 to stderr

This is the prophylaxis layer. A compromised component cannot start.

---

## Layer 5 — 9P VFS Gateway

Serves the entire VM over 9P protocol so the Mac Mini (clean substrate)
can mount and verify without trusting the Windows filesystem.

- Read-only export of SOVEREIGN_FS_ROOT
- Content-addressed: every file served with SHA256 header
- Mac Mini verifies hashes before consuming any artifact

---

## VM Manifest (to be populated as components are built)

```
fa29f39af353723224163cccf32b79b4257d350ad2bc7ec05a1ac21e793e81c4  sovereign-fs-mcp.js
<TBD>  sovereign-audit-mcp.js
<TBD>  sovereign-pipe-mcp.js
<TBD>  sovereign-transport-mcp.js
<TBD>  sovereign-boot.js
<TBD>  sovereign-9p-gateway.js
<TBD>  SOVEREIGN-VM-CONSTITUTION.md
```

The manifest itself is signed by its own SHA256. That hash is the VM identity.

---

## What does NOT cross the air gap

- Any file containing credentials (tokens, API keys, passwords)
- Any file whose SHA256 doesn't match this manifest
- Any component with proc_kill, mitm_proxy, or exec capabilities
- The compromised claude_desktop_config.json
- Any git repo with force-pushed or unsigned history

## What crosses from infected substrate to clean VM

- STCS canon specs (verified by stcs-corpus-verify.js against manifest)
- genesis-docs (only commits verifiable against known-good hash)
- Tool implementations (only after catabolism → X01 reconstruct → clean reimplementation)
- The STCS-MANIFEST-SHA256-v1.0.txt (ground truth anchor)

Everything else is rebuilt from scratch on the clean substrate.
