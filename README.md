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
