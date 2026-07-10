#!/bin/bash
# Deploy Voice-Wei to production (manual bypass of GitHub Actions).
# Reads deploy.user / deploy.host / deploy.remotePath from config.json.
# Keep the rsync exclude list in sync with .github/workflows/deploy.yml.
# Usage: ./deploy.sh [--dry-run]

set -e

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed."
    echo "Install with: brew install jq (macOS) or apt install jq (Linux)"
    exit 1
fi

if [ ! -f "config.json" ]; then
    echo "Error: config.json not found."
    echo "Copy config.example.json to config.json and fill in deploy settings."
    exit 1
fi

USER=$(jq -r '.deploy.user' config.json)
HOST=$(jq -r '.deploy.host' config.json)
REMOTE_DIR=$(jq -r '.deploy.remotePath' config.json)
PUBLIC_URL=$(jq -r '.deploy.publicUrl' config.json)

if [ "$USER" = "null" ] || [ "$HOST" = "null" ] || [ "$REMOTE_DIR" = "null" ]; then
    echo "Error: Missing deploy settings in config.json"
    echo "Make sure deploy.user, deploy.host, and deploy.remotePath are set."
    exit 1
fi

DRY_RUN=""
if [ "$1" = "--dry-run" ]; then
    DRY_RUN="--dry-run"
    echo "DRY RUN - no files will be transferred"
    echo ""
fi

echo "Deploying Voice-Wei to $USER@$HOST:$REMOTE_DIR"
echo ""

# Same excludes as .github/workflows/deploy.yml (including --delete).
rsync -avz $DRY_RUN \
  --delete \
  --exclude='.git' \
  --exclude='.gitignore' \
  --exclude='.cursor' \
  --exclude='.github' \
  --exclude='.ast-grep' \
  --exclude='.vscode' \
  --exclude='.dev' \
  --exclude='config.json' \
  --exclude='tests' \
  --exclude='types' \
  --exclude='demos' \
  --exclude='deploy' \
  --exclude='node_modules' \
  --exclude='*.md' \
  --exclude='*.txt' \
  --exclude='*.sh' \
  --exclude='*.py' \
  --exclude='tsconfig.json' \
  --exclude='sgconfig.yml' \
  --exclude='package.json' \
  --exclude='dev-server.js' \
  --exclude='pipeline-*.svg' \
  --exclude='screenshot-*.png' \
  ./ "$USER@$HOST:$REMOTE_DIR/"

echo ""
echo "Files deployed."
echo "Visit $PUBLIC_URL and confirm the header version matches this ship."
echo "API keys are entered in the browser Settings UI (localStorage), not config.json."

# cache-warm probe 20260710T152043Z
