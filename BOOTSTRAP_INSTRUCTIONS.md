# Bootstrap Instructions

## Architecture

Bootstrap is two stages. This document covers both. Stage 1 is public and
minimal. Stage 2 is private and operational. Do not conflate them.

---

## Stage 1 (Public — this repo)

**Goal**: Solve transport problems and reach Stage 2. Nothing more.

### Prerequisites

Before running anything, check Memory for credentials:
- **bclark00 token**: Memory item 2
- **Primevelocity token**: Memory item 2
- If Memory is not yet loaded, ask the user before proceeding.

### Transport notes

Git clone over HTTPS is blocked in some Claude container environments.
Use the API-based clone tool in this repo for all clones:

```bash
# Standard form — use for every private repo clone
curl -sL "https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/git/api-git-clone.sh" | \
  bash -s owner/repo /target/path
```

This uses the GitHub Contents API via curl and works through any proxy
that allows HTTPS. It produces a real git repository with remotes configured.

### Run Stage 1

```bash
# Only needed if Stage 2 location is unknown or transport is broken
node bootstrap-v2.mjs
```

Stage 1 validates that transport works and that you can reach private repos.
If it fails, fix the transport before proceeding.

---

## Stage 2 (Private — bclark00/exponential-session-bootstrap)

**Goal**: Restore full operational context. Guardian Invariants first. Always.

```bash
export GITHUB_TOKEN="ghp_..."   # bclark00 token from Memory
export PV_TOKEN="ghp_..."       # Primevelocity token from Memory

curl -sL "https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/git/api-git-clone.sh" | \
  bash -s bclark00/exponential-session-bootstrap /tmp/stage2

node /tmp/stage2/bootstrap-stage2.mjs
```

### Load order

Stage 2 loads in this order. Each step is fatal if unavailable — do not
proceed degraded:

1. **Guardian Invariants** — Genesis Constitution. Law, not philosophy.
2. **RFC Index** — Canonical specification landscape.
3. **Session Shards** — Byzantine-verified state from Primevelocity/session-crystallization.
4. **Context Map** — Project inventory, infrastructure layout, active intents.
5. **Reflection Pass** — Surfaces drift and improvements from last session.
6. **Bootstrap Receipt** — INV-2 provenance record of this session start.

### Design rules

- Transport failures are loud and fatal. Never silent. Never degraded-mode fallback.
- If GitHub is unreachable, fix the transport. Do not design around it.
- Every session start emits a traceable receipt hash.
- Each iteration surfaces improvements to the process itself.

---

## After Bootstrap

Once Stage 2 completes, consult CAPABILITIES_REGISTER.md for available
tools, active repos, and current infrastructure state.

All new repos default to **private** unless explicitly designated otherwise.

---

## Tools

After bootstrap completes, these tools are available in `tools/`:

### claude-query.mjs (CAP-010)

Direct Claude API and conversation retrieval. Zero npm dependencies.

```bash
# Inference — API key from Memory item 2
CLAUDE_API_KEY=<key> node tools/claude-query.mjs ask "Prompt"

# Full conversation retrieval — requires fresh session cookies
# Org UUID and session key are in Stage 2 context / Memory
CLAUDE_SESSION_KEY=<sid> CLAUDE_ORG_UUID=<uuid from Stage 2> \
  node tools/claude-query.mjs get-chat <conversation-uuid> --all

# List recent chats
CLAUDE_SESSION_KEY=<sid> CLAUDE_ORG_UUID=<uuid from Stage 2> \
  node tools/claude-query.mjs list-chats
```

Use instead of `conversation_search` when full message history is needed.
`conversation_search` returns snippets only. `get-chat` returns every token.

---

## Collaboration Profile

`cdn/ai_behavior_specifications_10.0.yaml` — operational context and working
preferences. Load after Stage 2 to orient the session. Not a behavior directive.

Includes: infrastructure context, working style, architectural patterns,
Guardian Invariants summary, parallel orchestration pattern, open items.

```bash
curl -sL https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/cdn/ai_behavior_specifications_10.0.yaml
```

