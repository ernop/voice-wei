#!/bin/bash
# Deploy Voice Music Control
# Reads settings from config.json
# Usage: ./deploy.sh [--dry-run]

set -e

# Check for jq
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed."
    echo "Install with: brew install jq (macOS) or apt install jq (Linux)"
    exit 1
fi

# Check for config.json
if [ ! -f "config.json" ]; then
    echo "Error: config.json not found."
    echo "Copy config.example.json to config.json and fill in your settings."
    exit 1
fi

# Read deployment settings from config.json
USER=$(jq -r '.deploy.user' config.json)
HOST=$(jq -r '.deploy.host' config.json)
REMOTE_DIR=$(jq -r '.deploy.remotePath' config.json)
PUBLIC_URL=$(jq -r '.deploy.publicUrl' config.json)

# Validate settings
if [ "$USER" = "null" ] || [ "$HOST" = "null" ] || [ "$REMOTE_DIR" = "null" ]; then
    echo "Error: Missing deploy settings in config.json"
    echo "Make sure deploy.user, deploy.host, and deploy.remotePath are set."
    exit 1
fi

# Check for --dry-run flag
DRY_RUN=""
if [ "$1" = "--dry-run" ]; then
    DRY_RUN="--dry-run"
    echo "DRY RUN - no files will be transferred"
    echo ""
fi

echo "Deploying Voice Music Control to $USER@$HOST:$REMOTE_DIR"
echo ""

rsync -avz $DRY_RUN \
  --exclude='.git' \
  --exclude='.gitignore' \
  --exclude='.cursor' \
  --exclude='config.json' \
  --exclude='*.md' \
  --exclude='*.txt' \
  --exclude='*.sh' \
  ./ "$USER@$HOST:$REMOTE_DIR/"

echo ""
echo "Files deployed!"
echo ""
echo "Next steps:"
echo "1. Ensure config.json exists on server with Claude API key"
echo "2. Visit $PUBLIC_URL"
