#!/bin/bash
# Points the live symlink PATH at a newly published release with one atomic
# rename (rsync writes the new symlink under a temporary name, then renames it
# over PATH). Releases layout only. Compare-and-swap: it goes live only if
# LIVE, the release the deploy started from, is still live, so a deploy never
# replaces a release that another deploy put live meanwhile.
#
# Usage: deploy/swap-release.sh USER HOST PATH RELEASE LIVE

set -euo pipefail

if [ "$#" -ne 5 ]; then
    echo "Usage: $0 USER HOST PATH RELEASE LIVE" >&2
    exit 2
fi

cd "$(dirname "$0")/.."
user=$1
host=$2
path=${3%/}
target=$4
started_from=$5
base=${path%/*}
name=${path##*/}

deploy/check-target.sh "$user" "$host" "$base" > /dev/null
layout=$(deploy/host-layout.sh "$user" "$host" "$path")
if [ "${layout%% *}" != "releases" ]; then
    echo "Refusing swap: $path is served in place, not from releases" >&2
    exit 1
fi
live=${layout#releases }
if [ "$live" != "$started_from" ]; then
    echo "Not swapping: another deploy put $live live after this one began from $started_from"
    exit 0
fi
releases=$(rsync --list-only "$user@$host:$base/releases/" | awk '$1 ~ /^d/ && $NF != "." { print $NF }')
if ! printf '%s\n' "$releases" | grep -qxF "$target"; then
    echo "Refusing swap: releases/$target does not exist" >&2
    exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ln -s "releases/$target" "$work/$name"
rsync -l "$work/$name" "$user@$host:$base/"
echo "Live release: $live -> $target"
