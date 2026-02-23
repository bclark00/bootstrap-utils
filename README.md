# bootstrap-utils

**Developer**: Brandon Clark (@bclark00)  
**Copyright**: © 2025-2026 Brandon Clark. All Rights Reserved.

---

## Purpose

This is the **public** half of a two-stage bootstrap system.

Its sole job is to get a fresh Claude session to the private bootstrap reliably. It contains nothing sensitive and nothing operational. All substantive context, tooling, RFCs, and behavior specifications live in the private bootstrap and downstream private repositories.

**Default posture for all repositories in this ecosystem: private.**

---

## Two-Stage Architecture

```
Stage 1 (this repo, public)
  - Visible to any Claude session without credentials
  - Provides just enough to solve transport problems
  - Routes to Memory for GitHub tokens
  - Clones and executes Stage 2

Stage 2 (bclark00/exponential-session-bootstrap, PRIVATE)
  - Requires bclark00 token from Memory
  - Loads Guardian Invariants, RFC index, session shards
  - Restores full operational context
  - Emits bootstrap receipt
```

---

## Stage 1 Quick Start

```bash
# Tokens are in Memory -- check Memory before proceeding
# bclark00 token: Memory item 2
# Primevelocity token: Memory item 2

export GITHUB_TOKEN="ghp_..."   # bclark00 token

# Clone Stage 2
curl -sL "https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/git/api-git-clone.sh" | \
  bash -s bclark00/exponential-session-bootstrap /tmp/stage2

# Run Stage 2
export PV_TOKEN="ghp_..."       # Primevelocity token
node /tmp/stage2/bootstrap-stage2.mjs
```

---

## Transport Troubleshooting

If `git clone` is blocked (common in Claude containers), use the API-based clone tool in this repo. It works through restrictive proxies by using `curl` against the GitHub Contents API instead of git transport.

```bash
# Instead of: git clone https://github.com/owner/repo
# Use:
curl -sL "https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/git/api-git-clone.sh" | \
  bash -s owner/repo /target/path
```

See `git/api-git-clone.sh` for details.

---

## What Does NOT Belong Here

- Operational tooling (lives in private repos or tool-cdn)
- Behavior specifications (live in Stage 2)
- RFC documents (live in Stage 2)
- Session state or shards (live in Primevelocity/session-crystallization)
- Any credential or token (live in Memory only)

---

## Contents

| File | Purpose |
|------|---------|
| `git/api-git-clone.sh` | Proxy-resistant GitHub clone via Contents API |
| `bootstrap-v2.mjs` | Stage 1 bootstrap runner |
| `BOOTSTRAP_INSTRUCTIONS.md` | Detailed bootstrap procedure |
| `CAPABILITIES_REGISTER.md` | Index of available tools and repos |
| `META_PROTOCOL.md` | Solution memory enforcement protocol |

---

# Git & GitHub Tools

## api-git-clone.sh

Smart git clone using GitHub API - works around HTTPS proxy blocks.

### Features
- ✅ Creates REAL git repository with `.git` directory
- ✅ Configures remote tracking to GitHub
- ✅ Embeds token authentication for push operations  
- ✅ Works through restrictive proxies (uses curl)
- ✅ Supports both public and private repositories

### Usage

```bash
# Basic clone
./api-git-clone.sh owner/repo

# Clone to specific directory
./api-git-clone.sh owner/repo /path/to/target

# Example
./api-git-clone.sh bclark00/IntegratedExponentialSystem /tmp/repos/integrated
```

### How It Works

1. Downloads repository as ZIP via GitHub API
2. Extracts files to target directory
3. Initializes git repository (`git init`)
4. Adds remote with HTTPS URL
5. Configures push URL with embedded token
6. Creates initial commit matching HEAD

### Result

You get a fully functional git repository:
- `git status` - works
- `git pull` - pulls latest changes
- `git push` - pushes your changes (uses token)
- `git log` - shows commit history

### Requirements

- `curl` (handles proxy automatically)
- `git` 
- `unzip`
- GitHub personal access token (set in script)

### Token Security

The script embeds the token in the push URL only:
- Fetch URL: `https://github.com/owner/repo.git` (no token)
- Push URL: `https://TOKEN@github.com/owner/repo.git` (token embedded)

This means `git pull` works without exposing token, but `git push` authenticates automatically.
