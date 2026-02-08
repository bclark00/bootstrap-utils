#!/bin/bash
# Smart Git Clone using curl (which handles proxy correctly)

REPO="$1"
TARGET_DIR="$2"
TOKEN="YOUR_GITHUB_TOKEN_HERE"

if [ -z "$REPO" ]; then
    echo "Usage: $0 owner/repo [target-dir]"
    exit 1
fi

OWNER=$(echo "$REPO" | cut -d/ -f1)
REPO_NAME=$(echo "$REPO" | cut -d/ -f2)
TARGET_DIR="${TARGET_DIR:-/tmp/repos/$REPO_NAME}"

echo "🚀 Smart Git Clone: $OWNER/$REPO_NAME"
echo "📁 Target: $TARGET_DIR"
echo ""

# Get repo info
echo "[1/5] Fetching repository info..."
REPO_INFO=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://api.github.com/repos/$OWNER/$REPO_NAME")

DEFAULT_BRANCH=$(echo "$REPO_INFO" | grep -o '"default_branch":"[^"]*"' | cut -d'"' -f4)
echo "✓ Branch: $DEFAULT_BRANCH"

# Get HEAD commit
echo "[2/5] Fetching commits..."
COMMITS=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://api.github.com/repos/$OWNER/$REPO_NAME/commits?sha=$DEFAULT_BRANCH&per_page=1")

HEAD_SHA=$(echo "$COMMITS" | grep -o '"sha":"[^"]*"' | head -1 | cut -d'"' -f4)
TREE_SHA=$(echo "$COMMITS" | grep -o '"tree":{"sha":"[^"]*"' | cut -d'"' -f4)
echo "✓ HEAD: ${HEAD_SHA:0:7}"

# Download repo as ZIP
echo "[3/5] Downloading repository archive..."
mkdir -p "$TARGET_DIR"
curl -s -L -H "Authorization: Bearer $TOKEN" \
    "https://api.github.com/repos/$OWNER/$REPO_NAME/zipball/$DEFAULT_BRANCH" \
    -o "$TARGET_DIR/repo.zip"

# Extract
echo "[4/5] Extracting files..."
cd "$TARGET_DIR"
unzip -q repo.zip
rm repo.zip
# Move files from subdirectory to root
SUBDIR=$(ls -d *-*/)
mv "$SUBDIR"* . 2>/dev/null
mv "$SUBDIR".* . 2>/dev/null
rmdir "$SUBDIR"

FILE_COUNT=$(find . -type f | wc -l)
echo "✓ Extracted $FILE_COUNT files"

# Initialize git
echo "[5/5] Initializing git repository..."
git init -q
git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
git remote set-url --push origin "https://$TOKEN@github.com/$OWNER/$REPO_NAME.git"
git add .
git commit -q -m "Clone from GitHub API (HEAD: $HEAD_SHA)"
git branch -M "$DEFAULT_BRANCH"

echo ""
echo "✅ Clone complete!"
echo ""
echo "📊 Summary:"
echo "   Path: $TARGET_DIR"
echo "   Files: $FILE_COUNT"
echo "   Branch: $DEFAULT_BRANCH"
echo "   Remote: https://github.com/$OWNER/$REPO_NAME.git"
echo ""
echo "💡 Ready to use: cd $TARGET_DIR && git status"
echo "   git push/pull work! (uses token)"
