#!/bin/bash
# Publishes the committed tree (git archive HEAD, never the working tree) to
# the host: the one publish path for CI and ./deploy.sh. The host decides the
# layout (deploy/host-layout.sh):
#   in-place  rsync --delete into PATH.
#   releases  rsync into releases/<id> beside PATH, hardlinking unchanged
#             files from the live release, swap PATH to it atomically
#             (deploy/swap-release.sh), and keep the newest KEEP_RELEASES.
# Content is compared by checksum and mtimes are not copied: git archive
# stamps every file with the commit time, so a size-and-mtime check could
# skip a same-size edit, while untouched files keep their served mtime/ETag.
# Each tree carries release.json (version, commit, release, layout), which
# deploy/verify-live.sh checks.
#
# Usage: deploy/publish-site.sh USER HOST PATH [--dry-run]
# RSYNC_RSH selects the SSH command (CI puts its deploy key there).

set -euo pipefail

KEEP_RELEASES=5

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
layout=$(deploy/host-layout.sh "$user" "$host" "$path")

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/tree" "$work/empty"
git archive HEAD | tar -x -C "$work/tree"
commit=$(git rev-parse HEAD)
version=$(tr -d '[:space:]' < "$work/tree/VERSION")
release="$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:7}"
printf '{"version": "%s", "commit": "%s", "release": "%s", "layout": "%s"}\n' \
    "$version" "$commit" "$release" "${layout%% *}" > "$work/tree/release.json"

publish=(rsync -rlpcz --itemize-changes --prune-empty-dirs --filter='merge deploy/rsync-filter')
if [ -n "$dry_run" ]; then
    publish+=(--dry-run)
fi

if [ "$layout" = "in-place" ]; then
    echo "Publishing $release (v$version) in place"
    "${publish[@]}" --delete --delete-excluded "$work/tree/" "$user@$host:$path/"
    exit 0
fi

live=${layout#releases }
base=${path%/*}
deploy/check-target.sh "$user" "$host" "$base"
ln -s ../../shared/deploy-telemetry.json "$work/tree/deploy-telemetry.json"

echo "Publishing release $release (v$version); live release is $live"
"${publish[@]}" --link-dest="../$live" "$work/tree/" "$user@$host:$base/releases/$release/"
if [ -n "$dry_run" ]; then
    exit 0
fi
deploy/swap-release.sh "$user" "$host" "$path" --forward "$release" "$live"

name=${path##*/}
state=$(rsync -rl --list-only --filter="+ /$name" --filter='+ /releases/' --filter='+ /releases/*/' \
    --filter='- *' "$user@$host:$base/")
live_now=$(printf '%s\n' "$state" | sed -n "s#.* $name -> releases/##p")
releases=$(printf '%s\n' "$state" | awk '$1 ~ /^d/ && $NF ~ /^releases\/./ { sub(/^releases\//, "", $NF); print $NF }' | sort)
if [ -z "$live_now" ] || ! printf '%s\n' "$releases" | grep -qxF "$live_now"; then
    echo "Refusing to prune: cannot read the live release" >&2
    exit 1
fi
# The newest releases stay for rollback; the live one and this one always stay.
keep=$({ printf '%s\n' "$releases" | tail -n "$KEEP_RELEASES"; echo "$live_now"; echo "$release"; } | sort -u)
protect=()
for kept in $keep; do
    protect+=(--filter="P /$kept/")
done
rsync -r --delete --itemize-changes "${protect[@]}" "$work/empty/" "$user@$host:$base/releases/"
