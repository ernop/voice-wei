#!/bin/bash
# Points the live symlink PATH at a release with one atomic rename (rsync
# writes the new symlink under a temporary name, then renames it over PATH).
# Releases layout only.
#   --forward RELEASE LIVE  go live only if LIVE is still the live release
#                           (compare-and-swap: a deploy never replaces a
#                           release that another deploy put live meanwhile)
#   --rollback [RELEASE]    go back to RELEASE, by default the newest release
#                           older than the live one
#
# Usage: deploy/swap-release.sh USER HOST PATH --forward RELEASE LIVE
#        deploy/swap-release.sh USER HOST PATH --rollback [RELEASE]

set -euo pipefail

usage() {
    echo "Usage: $0 USER HOST PATH --forward RELEASE LIVE | --rollback [RELEASE]" >&2
    exit 2
}
[ "$#" -ge 4 ] || usage
case "$4" in
    --forward) [ "$#" -eq 6 ] || usage ;;
    --rollback) [ "$#" -le 5 ] || usage ;;
    *) usage ;;
esac

cd "$(dirname "$0")/.."
user=$1
host=$2
path=${3%/}
base=${path%/*}
name=${path##*/}

deploy/check-target.sh "$user" "$host" "$base" > /dev/null
layout=$(deploy/host-layout.sh "$user" "$host" "$path")
if [ "${layout%% *}" != "releases" ]; then
    echo "Refusing swap: $path is served in place, not from releases" >&2
    exit 1
fi
live=${layout#releases }
releases=$(rsync --list-only "$user@$host:$base/releases/" | awk '$1 ~ /^d/ && $NF != "." { print $NF }' | sort)

if [ "$4" = "--forward" ]; then
    target=$5
    if [ "$live" != "$6" ]; then
        echo "Not swapping: another deploy put $live live after this one began from $6"
        exit 0
    fi
else
    target=${5-}
    if [ -z "$target" ]; then
        target=$(printf '%s\n' "$releases" | awk -v live="$live" '$0 < live' | tail -n 1)
        [ -n "$target" ] || { echo "Refusing rollback: no release older than the live $live" >&2; exit 1; }
    fi
fi
if ! printf '%s\n' "$releases" | grep -qxF "$target"; then
    echo "Refusing swap: releases/$target does not exist" >&2
    exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ln -s "releases/$target" "$work/$name"
rsync -l "$work/$name" "$user@$host:$base/"
echo "Live release: $live -> $target"
