#!/bin/bash
# Deploy Voice-Wei to production (manual bypass of GitHub Actions).
# Reads deploy.user / deploy.host / deploy.remotePath / deploy.publicUrl from
# config.json. Publishes the committed tree (HEAD) exactly as CI does, through
# deploy/publish-site.sh, then runs the same live checks. Uncommitted edits
# and untracked files never ship.
# Usage: ./deploy.sh [--dry-run]
#        ./deploy.sh --rollback [RELEASE]   (releases layout: back to RELEASE,
#                                            by default the previous release)

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
app_url="${public_url%/*}/"

if [ "$1" = "--rollback" ]; then
    deploy/swap-release.sh "$deploy_user" "$deploy_host" "$remote_dir" --rollback ${2:+"$2"}
    curl -fsS "${app_url}release.json?cb=$(date +%s)"
    deploy/smoke-live.sh "$app_url"
    exit 0
fi

DRY_RUN=""
if [ "$1" = "--dry-run" ]; then
    DRY_RUN="--dry-run"
    echo "DRY RUN - no files will be transferred"
    echo ""
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "Note: publishing HEAD $(git rev-parse --short HEAD); uncommitted changes are not deployed."
fi
echo "Deploying Voice-Wei to $deploy_user@$deploy_host:${remote_dir%/}"
echo ""

deploy/publish-site.sh "$deploy_user" "$deploy_host" "$remote_dir" $DRY_RUN

if [ -n "$DRY_RUN" ]; then
    exit 0
fi

echo ""
deploy/verify-live.sh "$app_url" "$(git show HEAD:VERSION | tr -d '[:space:]')" "$(git rev-parse HEAD)"
deploy/smoke-live.sh "$app_url"
echo ""
echo "Live at $public_url"
echo "API keys are entered in the browser Settings UI (localStorage), not config.json."
