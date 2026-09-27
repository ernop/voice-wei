#!/bin/bash
# Uploads deploy-telemetry.json to where the host layout serves it from: in
# place, PATH/deploy-telemetry.json; with releases, shared/ beside PATH, which
# every release links to (deploy/publish-site.sh).
#
# Usage: deploy/upload-telemetry.sh USER HOST PATH FILE

set -euo pipefail

if [ "$#" -ne 4 ]; then
    echo "Usage: $0 USER HOST PATH FILE" >&2
    exit 2
fi

file=$(cd "$(dirname "$4")" && pwd)/$(basename "$4")
cd "$(dirname "$0")/.."
user=$1
host=$2
path=${3%/}

deploy/check-target.sh "$user" "$host" "$path"
layout=$(deploy/host-layout.sh "$user" "$host" "$path")
case "${layout%% *}" in
    in-place)
        destination="$path/deploy-telemetry.json"
        ;;
    releases)
        base=${path%/*}
        deploy/check-target.sh "$user" "$host" "$base" > /dev/null
        destination="$base/shared/deploy-telemetry.json"
        ;;
esac

rsync -avz "$file" "$user@$host:$destination"
