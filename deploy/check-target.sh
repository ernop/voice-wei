#!/bin/bash
# Refuses a deploy target that could reach outside the app's own directory.
# Every rsync that writes to the host runs this first (deploy.yml,
# deploy-telemetry.yml, deploy.sh): an empty or malformed DEPLOY_PATH would
# otherwise aim rsync --delete at the remote filesystem root or at the
# domain owner's site. Rules: docs/setup.md, "Deploy target guard".
#
# Usage: deploy/check-target.sh USER HOST PATH
# One trailing slash on PATH is ignored; callers strip it the same way.

set -eu

if [ "$#" -ne 3 ]; then
    echo "Usage: $0 USER HOST PATH" >&2
    exit 2
fi

user=$1
host=$2
path=${3%/}

refuse() {
    echo "Refusing deploy target: $1" >&2
    exit 1
}

user_pattern='^[a-z_][a-z0-9_-]*$'
host_pattern='^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
# Absolute, and every component a plain name: no empty, '.', '..', or hidden
# components, and nothing a shell or rsync would reinterpret.
path_pattern='^(/[A-Za-z0-9_][A-Za-z0-9_.-]*)+$'

[[ $user =~ $user_pattern ]] || refuse "user must be a plain account name"
[ "$user" != "root" ] || refuse "user must not be root"
[[ $host =~ $host_pattern ]] || refuse "host must be a hostname or IPv4 address"
[[ $path =~ $path_pattern ]] || refuse "path must be absolute with plain-name components"
case "$path/" in
    */voice-wei/*) ;;
    *) refuse "path must lie inside a directory named voice-wei" ;;
esac

echo "Deploy target accepted: $user@$host:$path"
