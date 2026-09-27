#!/bin/bash
# Post-deploy smoke checks, run after the live build is verified:
#   1. The host's own site root still serves HTML: the publish did not harm
#      the site that owns the domain.
#   2. None of this app's files answer at the host root: the publish stayed
#      inside the app directory.
#   3. proxy.php executes with cURL and imports a public webpage end to end
#      (the Books and linked-page import path).
# Keyless music search is deliberately not checked. It depends on
# third-party Piped/Invidious instances whose outages the player rides out
# with its search cache, so their availability cannot gate a deploy.
#
# Usage: deploy/smoke-live.sh APP_URL   e.g. https://fuseki.net/voice-wei/

set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 APP_URL" >&2
    exit 2
fi

app_url=${1%/}/
host_root=$(printf '%s\n' "$app_url" | sed -E 's#^(https?://[^/]+)/.*$#\1/#')

smoke_failed() {
    echo "SMOKE FAILED: $1" >&2
    exit 1
}

if [ "$host_root" = "$app_url" ]; then
    echo "App serves the origin root; no host site to check"
else
    root_status=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "$host_root")
    echo "Host root $host_root: $root_status"
    case "$root_status" in
        "200 text/html"*) ;;
        *) smoke_failed "the host root did not serve HTML" ;;
    esac

    root_app_version=$(curl -sS "${host_root}app-version.js")
    case "$root_app_version" in
        *AppVersion*) smoke_failed "this app's app-version.js answers at the host root" ;;
    esac
    root_proxy=$(curl -sS "${host_root}proxy.php?test=1")
    case "$root_proxy" in
        *"Search and Books URL import"*) smoke_failed "this app's proxy.php answers at the host root" ;;
    esac
    echo "Host root serves none of this app's files"
fi

proxy_test=$(curl -sS "${app_url}proxy.php?test=1")
echo "proxy.php?test=1: $(printf '%s' "$proxy_test" | head -c 300)"
printf '%s' "$proxy_test" | jq -e '.curl_available == true' > /dev/null 2>&1 \
    || smoke_failed "proxy.php did not report a working cURL"

page_import=$(curl -sS "${app_url}proxy.php?readUrl=https%3A%2F%2Fexample.com%2F")
# A non-JSON answer (an nginx error page) has no title and fails below.
page_title=$(printf '%s' "$page_import" | jq -r '.title // empty' 2> /dev/null || true)
echo "proxy.php?readUrl=https://example.com/: title '$page_title'"
[ "$page_title" = "Example Domain" ] \
    || smoke_failed "webpage import through proxy.php failed: $(printf '%s' "$page_import" | head -c 300)"
