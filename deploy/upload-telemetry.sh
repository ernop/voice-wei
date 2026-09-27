#!/bin/bash
# Uploads deploy-telemetry.json into PATH, where the in-place publish protects
# it from deletion.
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
rsync -avz "$file" "$user@$host:$path/deploy-telemetry.json"
