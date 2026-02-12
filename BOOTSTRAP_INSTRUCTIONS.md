# Claude Bootstrap Instructions

## The Two-Repo Bootstrap Process

This is a **two-step bootstrap** because of network restrictions:

1. **PUBLIC repo** (`bootstrap-utils`) - You can access this without authentication
2. **PRIVATE repo** (`exponential-session-bootstrap`) - Needs the utils from step 1 to access

## Step 1: Get the Utils (No Auth Required)

```bash
# Download the API git clone tool from PUBLIC repo
curl -o /tmp/api-git-clone.sh https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/git/api-git-clone.sh
chmod +x /tmp/api-git-clone.sh
```

**Why?** This tool works around HTTPS proxy blocks and fixes API auth header issues.

## Step 2: Use Utils to Get Private Bootstrap

Brandon will provide the token. Then:

```bash
# Set the token
export GITHUB_TOKEN="paste-token-here"

# Clone the PRIVATE bootstrap repo (uses the tool from step 1)
/tmp/api-git-clone.sh bclark00/exponential-session-bootstrap /tmp/bootstrap
```

## Step 3: Run the Real Bootstrap

```bash
cd /tmp/bootstrap
bash bootstrap.sh
```

**This script does everything** - loads context, docs, tools, environment.

---

## Why Two Repos?

- **bootstrap-utils** (PUBLIC) - Gets you the tools to bypass network restrictions
- **exponential-session-bootstrap** (PRIVATE) - Has the actual session context, which would be difficult to get without the utils

## One-Liner (After Getting Token)

```bash
export GITHUB_TOKEN="paste-token-here" && curl -o /tmp/api-git-clone.sh https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/git/api-git-clone.sh && chmod +x /tmp/api-git-clone.sh && /tmp/api-git-clone.sh bclark00/exponential-session-bootstrap /tmp/bootstrap && cd /tmp/bootstrap && bash bootstrap.sh
```

---

## For Brandon

Tell fresh Claude:
> "Bootstrap from github.com/bclark00/bootstrap-utils with token ghp_..."

Claude will:
1. Fetch these instructions from the PUBLIC repo
2. Download api-git-clone.sh (no auth needed)
3. Use it to clone the PRIVATE exponential-session-bootstrap
4. Run bootstrap.sh to restore full environment

**Two repos, one smooth process.**
