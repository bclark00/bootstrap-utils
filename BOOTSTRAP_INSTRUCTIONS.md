# Claude Bootstrap Instructions

## Quick Start (4 Steps)

### Step 1: Get the Git Clone Tool
```bash
curl -o /tmp/api-git-clone.sh https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/git/api-git-clone.sh
chmod +x /tmp/api-git-clone.sh
```

### Step 2: Set Your Token
Brandon will provide the GitHub token. Set it with:
```bash
export GITHUB_TOKEN="paste-token-here"
```

### Step 3: Clone Session Bootstrap
```bash
/tmp/api-git-clone.sh bclark00/exponential-session-bootstrap /tmp/session-bootstrap
```

### Step 4: Run Bootstrap
```bash
cd /tmp/session-bootstrap
bash bootstrap.sh
```

---

## What This Does

1. **api-git-clone.sh** - Works around network restrictions, creates real git repos
2. **exponential-session-bootstrap** - Private repo with session context, docs, tools
3. **bootstrap.sh** - Restores full working environment automatically

## Troubleshooting

### If curl fails (network restrictions)
Use web_fetch tool to download the script:
```
web_fetch("https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/git/api-git-clone.sh")
```
Then save the content to `/tmp/api-git-clone.sh` and continue.

### If git clone fails
The api-git-clone.sh script works through proxies. If it still fails, check:
- Token is set correctly: `echo $GITHUB_TOKEN`
- Repo name is correct: `bclark00/exponential-session-bootstrap`

## Additional Resources

After bootstrap completes, check these in exponential-session-bootstrap:
- `ONBOARDING_COMPLETE.md` - System overview
- `docs/` - Technical documentation including Roslyn exponential patterns
- `context/` - Session context and memory
- `tools/` - Additional utilities

## One-Liner Bootstrap

After getting token from Brandon:
```bash
export GITHUB_TOKEN="paste-token-here" && curl -o /tmp/api-git-clone.sh https://raw.githubusercontent.com/bclark00/bootstrap-utils/main/git/api-git-clone.sh && chmod +x /tmp/api-git-clone.sh && /tmp/api-git-clone.sh bclark00/exponential-session-bootstrap /tmp/session-bootstrap && cd /tmp/session-bootstrap && bash bootstrap.sh
```

---

**Completely frictionless - one message with token and Claude self-bootstraps.**
