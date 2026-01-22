#!/bin/bash
# Bump version number across all pages
# Usage: ./bump-version.sh [new_version]
# If no version provided, increments current version by 1

set -e

VERSION_FILE="VERSION"
CURRENT=$(cat "$VERSION_FILE" | tr -d '[:space:]')

if [ -n "$1" ]; then
    NEW="$1"
else
    NEW=$((CURRENT + 1))
fi

echo "Bumping version: v$CURRENT -> v$NEW"

# Update VERSION file
echo "$NEW" > "$VERSION_FILE"

# Update all HTML files - version label and cache busting
for file in scales.html pitch-meter.html player.html ebook.html ears.html; do
    if [ -f "$file" ]; then
        # Update version-label span
        sed -i "s/version-label\">v[0-9.]*</version-label\">v$NEW</g" "$file"
        
        # Update cache busting ?v= parameters
        sed -i "s/?v=[0-9]*/?v=$NEW/g" "$file"
        
        echo "  Updated $file"
    fi
done

echo "Done. Version is now v$NEW"
echo ""
echo "Next steps:"
echo "  git add -A && git commit -m \"Bump version to v$NEW\" && git push"
