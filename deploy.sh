#!/bin/bash
# Deploy Voice-Wei to production (manual bypass of GitHub Actions).
# Reads deploy.user / deploy.host / deploy.remotePath / deploy.publicUrl from
# config.json. Publishes with the same target guard and filter as
# .github/workflows/deploy.yml (deploy/check-target.sh, deploy/rsync-filter),
# then runs the same live checks.
# Usage: ./deploy.sh [--dry-run]

set -e

cd "$(dirname "$0")"

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

deploy_user=$(jq -r '.deploy.user // empty' config.json)
deploy_host=$(jq -r '.deploy.host // empty' config.json)
remote_dir=$(jq -r '.deploy.remotePath // empty' config.json)
# publicUrl names a page inside the app directory; its directory is the app URL.
public_url=$(jq -r '.deploy.publicUrl // empty' config.json)

if [ -z "$deploy_user" ] || [ -z "$deploy_host" ] || [ -z "$remote_dir" ] || [ -z "$public_url" ]; then
    echo "Error: Missing deploy settings in config.json"
    echo "Make sure deploy.user, deploy.host, deploy.remotePath, and deploy.publicUrl are set."
    exit 1
fi

deploy/check-target.sh "$deploy_user" "$deploy_host" "$remote_dir"

DRY_RUN=""
if [ "$1" = "--dry-run" ]; then
    DRY_RUN="--dry-run"
    echo "DRY RUN - no files will be transferred"
    echo ""
fi

echo "Deploying Voice-Wei to $deploy_user@$deploy_host:${remote_dir%/}"
echo ""

rsync -avz $DRY_RUN --delete --delete-excluded --prune-empty-dirs \
  --filter='merge deploy/rsync-filter' \
  ./ "$deploy_user@$deploy_host:${remote_dir%/}/"

if [ -n "$DRY_RUN" ]; then
    exit 0
fi

app_url="${public_url%/*}/"
echo ""
deploy/verify-live.sh "$app_url" "$(tr -d '[:space:]' < VERSION)"
deploy/smoke-live.sh "$app_url"
echo ""
echo "Live at $public_url"
echo "API keys are entered in the browser Settings UI (localStorage), not config.json."
