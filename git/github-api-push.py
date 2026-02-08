#!/usr/bin/env python3
"""
GitHub API Push Tool
Pushes files to GitHub when 'git push' fails through proxies

Usage:
  python github-api-push.py owner/repo file1.txt file2.txt
  python github-api-push.py owner/repo --all
  
Companion to api-git-clone.sh - completes the workflow:
1. Clone with api-git-clone.sh (works through proxy)
2. Make changes locally
3. Push with github-api-push.py (works through proxy)
"""

import sys
import base64
import json
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: requests module not found")
    print("Install: pip install requests --break-system-packages")
    sys.exit(1)

# Configuration
TOKEN = "YOUR_GITHUB_TOKEN_HERE"  # Replace or set GITHUB_TOKEN env var
BRANCH = "main"

def upload_file(owner, repo, local_path, github_path, message):
    """Upload a single file to GitHub via Contents API"""
    print(f">> {github_path}...", end=" ", flush=True)
    
    try:
        with open(local_path, 'rb') as f:
            content = base64.b64encode(f.read()).decode('utf-8')
    except Exception as e:
        print(f"FAIL (read error: {e})")
        return False
    
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{github_path}"
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github.v3+json"
    }
    data = {
        "message": message,
        "content": content,
        "branch": BRANCH
    }
    
    try:
        response = requests.put(url, headers=headers, json=data, timeout=30)
        
        if response.status_code in [200, 201]:
            print("OK")
            return True
        elif response.status_code == 422:
            # File exists, need SHA
            get_response = requests.get(url, headers=headers, timeout=30)
            if get_response.status_code == 200:
                sha = get_response.json()['sha']
                data['sha'] = sha
                response = requests.put(url, headers=headers, json=data, timeout=30)
                if response.status_code in [200, 201]:
                    print("OK (updated)")
                    return True
        
        print(f"FAIL ({response.status_code})")
        return False
        
    except Exception as e:
        print(f"FAIL ({e})")
        return False

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    
    # Parse owner/repo
    repo_arg = sys.argv[1]
    if '/' not in repo_arg:
        print("ERROR: Repository must be in format owner/repo")
        sys.exit(1)
    
    owner, repo = repo_arg.split('/', 1)
    
    # Get token from env if not hardcoded
    global TOKEN
    import os
    if TOKEN == "YOUR_GITHUB_TOKEN_HERE":
        TOKEN = os.environ.get('GITHUB_TOKEN')
        if not TOKEN:
            print("ERROR: No GitHub token found")
            print("Set GITHUB_TOKEN environment variable or edit script")
            sys.exit(1)
    
    # Get files to upload
    files = sys.argv[2:]
    
    if '--all' in files:
        # Upload all tracked git files
        try:
            import subprocess
            result = subprocess.run(
                ['git', 'ls-files'],
                capture_output=True,
                text=True,
                check=True
            )
            files = result.stdout.strip().split('\n')
        except Exception as e:
            print(f"ERROR: Could not list git files: {e}")
            sys.exit(1)
    
    print(f"Pushing {len(files)} files to {owner}/{repo}...\n")
    
    success = 0
    failed = 0
    
    for file_path in files:
        local_path = Path(file_path)
        
        if not local_path.exists():
            print(f">> {file_path}... SKIP (not found)")
            continue
        
        if local_path.is_dir():
            print(f">> {file_path}... SKIP (directory)")
            continue
        
        # Use same path on GitHub as local
        github_path = file_path.replace('\\', '/')
        message = f"Update {github_path}"
        
        if upload_file(owner, repo, local_path, github_path, message):
            success += 1
        else:
            failed += 1
    
    print(f"\nComplete: {success} uploaded, {failed} failed")
    print(f"https://github.com/{owner}/{repo}")

if __name__ == '__main__':
    main()
