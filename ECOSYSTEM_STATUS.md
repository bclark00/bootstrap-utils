# Exponential Ecosystem Status
**Last Updated**: 2026-02-16  
**Copyright**: © 2025-2026 Brandon Clark. All Rights Reserved.

---

## GitHub Ecosystem Overview

**Total Repositories**: 198  
**Last Verified**: 2026-02-16 via repo-orchestrator MCP

### Account Breakdown

| Account | Total Repos | Private | Public |
|---------|-------------|---------|--------|
| **bclark00** | 128 | 122 | 6 |
| **Primevelocity** | 70 | 68 | 2 |
| **TOTAL** | 198 | 190 (96%) | 8 (4%) |

### Health Status (as of 2026-02-16)

| Status | Count | Percentage |
|--------|-------|------------|
| Active | 170 | 86% |
| Stale | 16 | 8% |
| Dormant | 11 | 5.5% |
| Moderate | 1 | 0.5% |

**Average Activity Score**: 78.0%

---

## Authentication & Tokens

### GitHub Personal Access Tokens

**bclark00 Token**:
- **Location**: Claude Memory #2 (also in git/api-git-clone.sh for bootstrap ops)
- **Scope**: Full `repo` access (public AND private)
- **Access**: All 128 bclark00 repos
- **Verified**: 2026-02-16 ✅
- **Method**: Use `/user/repos?affiliation=owner` endpoint (NOT `/users/bclark00/repos`)

**Primevelocity Token**:
- **Location**: Claude Memory #2
- **Scope**: Full `repo` access (public AND private)
- **Access**: All 70 Primevelocity repos
- **Verified**: 2026-02-16 ✅

### Important: Token Scope Discovery

**Problem**: The `/users/{username}/repos` endpoint only returns PUBLIC repos, even with authentication.

**Solution**: Use the authenticated `/user/repos?affiliation=owner` endpoint to access ALL repos including private ones.

**Example**:
```bash
# WRONG - Only shows 6 public repos
curl -H "Authorization: Bearer TOKEN" \
  https://api.github.com/users/bclark00/repos

# RIGHT - Shows all 128 repos (122 private + 6 public)
curl -H "Authorization: Bearer TOKEN" \
  https://api.github.com/user/repos?affiliation=owner&per_page=100
```

**Pagination**: bclark00 repos span 2 pages (100 + 28)

---

## Repo Orchestrator MCP

**Status**: ✅ OPERATIONAL (Fixed 2026-02-16)  
**Location**: `/home/zorin/repo-orchestrator/`  
**Database**: `/home/zorin/repo-orchestrator/db/orchestrator.db`

### Available Tools

1. `get_ecosystem_stats` - Overview of all 198 repos
2. `search_repos` - Search by name/description
3. `get_repo_details` - Detailed repo info + relationships
4. `get_stale_repos` - Find inactive repos (configurable days)
5. `get_recent_activity` - Recently updated repos
6. `get_repo_families` - Detect related repo groups
7. `get_critical_repos` - Check infrastructure repo status
8. `get_language_breakdown` - Stats by programming language

### Rebuild Database

When repos change, rebuild with:
```bash
cd /home/zorin/repo-orchestrator
node rebuild-db.js
```

This fetches all repos from both accounts and updates the SQLite database.

---

## Detected Repo Families

Repos are automatically grouped by naming patterns:

- **exponential-suite**: `exponential-*` prefix
- **genesis-core**: `genesis-*` prefix
- **conversation-tools**: `conversation-*` prefix
- **intent-system**: `intent-*` prefix
- **mcp-servers**: `-mcp` suffix
- **integrated-systems**: `Integrated*` prefix
- **illuminaughty-suite**: `illuminaughty` in name

---

## Critical Infrastructure Repos

These repos are essential to the exponential ecosystem:

1. **conversation-extracts-complete** (Primevelocity, PRIVATE)
2. **conversation-dimensions** (Primevelocity, PRIVATE)
3. **exponential-infrastructure-hub** (bclark00)
4. **intent-graph-mcp** (bclark00, PRIVATE)
5. **IntegratedExponentialSystem** (bclark00)
6. **exponential-session-bootstrap** (bclark00)
7. **genesis-exponential-build** (bclark00)
8. **bootstrap-utils** (bclark00, PUBLIC - this repo)

Check status with:
```javascript
repo-orchestrator:get_critical_repos()
```

---

## Illuminaughty Repos

**Confirmed to exist** (2026-02-16):

1. **bclark00/illuminaughty-diamond** (PRIVATE)
   - Diamond-layer integration
   - Language: Python
   - Status: Active
   - Activity Score: 0.993

2. **bclark00/illuminaughty-enhancements** (PRIVATE)
   - Architecture specifications
   - Quartz System + Diamond + ActivationField
   - Status: Active
   - Activity Score: 0.993

Both repos are highly active and part of the illuminaughty-suite family.

---

## Usage Examples

### Check if a repo exists
```javascript
repo-orchestrator:search_repos({ query: "illuminaughty" })
```

### Get total repo count
```javascript
repo-orchestrator:get_ecosystem_stats()
```

### Find stale repos (no activity in 90+ days)
```javascript
repo-orchestrator:get_stale_repos({ days: 90 })
```

### Get recent activity (last 7 days)
```javascript
repo-orchestrator:get_recent_activity({ days: 7 })
```

---

## Token Security

**bclark00 Token**: Available in Claude Memory #2 and git/api-git-clone.sh
- Used for bootstrap operations
- Allows anyone with access to clone public repos
- Grants access to private repos for authenticated sessions

**Primevelocity Token**: Private (Claude Memory #2 only)
- Crown jewel protection
- Not committed to public repos
- Full repo access to all Primevelocity repos

Both tokens have full `repo` scope for their respective accounts.

---

## Integration with Bootstrap

The repo-orchestrator MCP provides real-time ecosystem intelligence to:
- Verify repo existence before operations
- Find related repos by naming patterns
- Track repo health and activity
- Detect stale repos for cleanup
- Monitor critical infrastructure

This ensures bootstrap operations work with current ecosystem state.

---

## Maintenance

**Update this file when**:
- Adding significant numbers of new repos
- Changing authentication methods
- Updating token scopes
- Major ecosystem reorganization

**Rebuild database when**:
- Creating new repos
- Archiving repos
- Changing repo visibility (public/private)
- After bulk operations

---

**Last Verification**: 2026-02-16  
**Verified By**: Claude via repo-orchestrator MCP  
**Method**: Direct GitHub API calls with `/user/repos` endpoint
