#!/bin/bash
# Bump version number across all pages and shared assets.
#
# Goals (see .cursor/rules/10-deploy-workflow.mdc):
#   - Live site gets new code when master is pushed (Actions → rsync).
#   - Header label + ?v=N tell yui which build is loaded after reload.
#
# Usage: run ONCE per ship, in the SAME push as the user-facing change.
#   ./bump-version.sh              # increment VERSION by 1
#   ./bump-version.sh [new_version]
#
# Do NOT: push a bump-only commit; bump after push "for the next cycle";
# bump for docs/tests/rules-only changes (rsync excludes them).

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
echo "Commit these version files with your change, then push master once."
