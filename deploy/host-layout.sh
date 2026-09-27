#!/bin/bash
# Prints the layout the host gives the app at PATH, one line:
#   in-place       PATH is the served directory; a deploy rewrites it in place.
#   releases NAME  PATH is a symlink to releases/NAME beside it; a deploy
#                  publishes a new release and swaps the symlink with one rename.
# The host owns the layout (docs/hosting-contract.md); the deploy scripts
# follow whichever one it provides.
#
# Usage: deploy/host-layout.sh USER HOST PATH

set -euo pipefail

if [ "$#" -ne 3 ]; then
    echo "Usage: $0 USER HOST PATH" >&2
    exit 2
fi

"$(dirname "$0")/check-target.sh" "$1" "$2" "$3" > /dev/null
path=${3%/}
name=${path##*/}
entry=$(rsync -l -d --list-only "$1@$2:$path")
release_pattern='^releases/[A-Za-z0-9_][A-Za-z0-9_.-]*$'

case "$entry" in
    d*" $name")
        echo "in-place"
        ;;
    l*" $name -> "*)
        target=${entry#* -> }
        if ! [[ $target =~ $release_pattern ]]; then
            echo "Refusing host layout: $path points at '$target', not releases/NAME" >&2
            exit 1
        fi
        echo "releases ${target#releases/}"
        ;;
    *)
        echo "Refusing host layout: $path is neither a directory nor a release symlink" >&2
        exit 1
        ;;
esac
