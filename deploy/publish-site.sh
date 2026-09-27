#!/bin/bash
# Publishes the committed tree (git archive HEAD, never the working tree) to
# the host with rsync --delete: the one publish path for CI and ./deploy.sh.
# Content is compared by checksum and mtimes are not copied: git archive
# stamps every file with the commit time, so a size-and-mtime check could
# skip a same-size edit, while untouched files keep their served mtime/ETag.
# The tree carries release.json (version, commit, release, layout), which
# deploy/verify-live.sh checks.
#
# Usage: deploy/publish-site.sh USER HOST PATH [--dry-run]
# RSYNC_RSH selects the SSH command (CI puts its deploy key there).

set -euo pipefail

usage() {
    echo "Usage: $0 USER HOST PATH [--dry-run]" >&2
    exit 2
}
[ "$#" -eq 3 ] || { [ "$#" -eq 4 ] && [ "$4" = "--dry-run" ]; } || usage

cd "$(dirname "$0")/.."
user=$1
host=$2
path=${3%/}
dry_run=${4-}

deploy/check-target.sh "$user" "$host" "$path"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/tree"
git archive HEAD | tar -x -C "$work/tree"
commit=$(git rev-parse HEAD)
version=$(tr -d '[:space:]' < "$work/tree/VERSION")
release="$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:7}"
printf '{"version": "%s", "commit": "%s", "release": "%s", "layout": "%s"}\n' \
    "$version" "$commit" "$release" "in-place" > "$work/tree/release.json"

publish=(rsync -rlpcz --itemize-changes --prune-empty-dirs --filter='merge deploy/rsync-filter')
if [ -n "$dry_run" ]; then
    publish+=(--dry-run)
fi

echo "Publishing $release (v$version) in place"
"${publish[@]}" --delete --delete-excluded "$work/tree/" "$user@$host:$path/"
