#!/bin/bash
# Confirms the live app serves the shipped build: VERSION and the header's
# build id (app-version.js) both carry the expected number. CI runs this as
# "Verify deployment"; ./deploy.sh and agents run it after a ship.
#
# Usage: deploy/verify-live.sh APP_URL EXPECTED_VERSION
#   e.g. deploy/verify-live.sh https://fuseki.net/voice-wei/ 355

set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 APP_URL EXPECTED_VERSION" >&2
    exit 2
fi

app_url=${1%/}/
expected=$2
number_pattern='^[0-9]+$'
if ! [[ $expected =~ $number_pattern ]]; then
    echo "EXPECTED_VERSION must be a number (got '$expected')" >&2
    exit 2
fi

not_live() {
    echo "NOT LIVE: $1" >&2
    exit 1
}

cache_bust="cb=$(date +%s)"

live=$(curl -fsS "${app_url}VERSION?$cache_bust" | tr -d '[:space:]')
echo "VERSION: expected $expected, live $live"
[ "$live" = "$expected" ] || not_live "live VERSION is '$live', expected $expected"

header=$(curl -fsS "${app_url}app-version.js?$cache_bust" | sed -nE "s/.*current: '([0-9]+)'.*/\1/p")
echo "Header build id (app-version.js): $header"
[ "$header" = "$expected" ] || not_live "live header build id is '$header', expected $expected"
