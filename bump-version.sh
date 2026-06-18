#!/bin/bash
# Bump version number across all pages and shared assets.
#
# Workflow (see .cursor/rules/10-deploy-workflow.mdc):
#   1. After every push to master — bump (start dev cycle at new ?v=)
#   2. Work and commit without bumping
#   3. Push — deploys that version
#   4. After push succeeds — bump again (prep next dev cycle)
#
# Usage: ./bump-version.sh [new_version]
# If no version provided, increments current version by 1.

set -e

VERSION_FILE="VERSION"
HEADER_FILE="shared-header.js"
APP_VERSION_FILE="app-version.js"
CURRENT=$(tr -d '[:space:]' < "$VERSION_FILE")

if [ -n "$1" ]; then
    NEW="$1"
else
    NEW=$((CURRENT + 1))
fi

echo "Bumping version: v$CURRENT -> v$NEW"

echo "$NEW" > "$VERSION_FILE"

if [ -f "$HEADER_FILE" ]; then
    sed -i "s/: '[0-9.]*';$/: '$NEW';/" "$HEADER_FILE"
    echo "  Updated $HEADER_FILE fallback"
fi

if [ -f "$APP_VERSION_FILE" ]; then
    sed -i "s/current: '[0-9.]*'/current: '$NEW'/g" "$APP_VERSION_FILE"
    echo "  Updated $APP_VERSION_FILE"
fi

for file in *.html; do
    if [ -f "$file" ]; then
        sed -i "s/?v=[0-9]*/?v=$NEW/g" "$file"
        echo "  Updated $file"
    fi
done

echo "Done. Version is now v$NEW"
