#!/bin/bash
# One-time host change for atomic voice-wei releases, run as root on the
# server by the fuseki.net project (docs/hosting-contract.md, "Pending
# requests"). Nginx is unchanged: it keeps serving /srv/voice-wei/site, which
# becomes a symlink the deploy swaps between complete releases.
#   1. voicewei PHP-FPM pool: opcache follows the swapped symlink (without
#      it, warm workers keep running the previous release's proxy.php), and
#      open_basedir covers the whole tenant directory.
#   2. voicewei owns /srv/voice-wei, so deploys can add releases and swap.
#   3. The live tree becomes the first release: a hardlinked snapshot, then
#      one atomic exchange of the directory and the symlink (no moment
#      without a site). The old directory stays as site.pre-releases.
# Safe to run while a deploy is in flight: that deploy's verify step fails
# (its files land in the old directory) and a re-run publishes a release.

set -euo pipefail

base=/srv/voice-wei
pool=/etc/php/8.3/fpm/pool.d/voicewei.conf

cd "$base"
[ -d site ] && [ ! -L site ] || { echo "site is not the in-place directory; nothing to do" >&2; exit 1; }

sed -i 's#^php_admin_value\[open_basedir\] = /srv/voice-wei/site:/tmp$#php_admin_value[open_basedir] = /srv/voice-wei:/tmp#' "$pool"
grep -qx 'php_admin_value\[open_basedir\] = /srv/voice-wei:/tmp' "$pool"
grep -qx 'php_admin_flag\[opcache.revalidate_path\] = on' "$pool" \
    || echo 'php_admin_flag[opcache.revalidate_path] = on' >> "$pool"
php-fpm8.3 -t
systemctl reload php8.3-fpm

chown voicewei:voicewei "$base"
install -d -o voicewei -g voicewei releases shared

release="$(date -u +%Y%m%dT%H%M%SZ)-initial"
cp -al site "releases/$release"
if [ -f "releases/$release/deploy-telemetry.json" ]; then
    mv "releases/$release/deploy-telemetry.json" shared/deploy-telemetry.json
fi
ln -s ../../shared/deploy-telemetry.json "releases/$release/deploy-telemetry.json"
chown -hR voicewei:voicewei releases shared

ln -s "releases/$release" site.next
chown -h voicewei:voicewei site.next
python3 - <<'PY'
import ctypes
libc = ctypes.CDLL(None, use_errno=True)
RENAME_EXCHANGE = 2
if libc.renameat2(-100, b"site.next", -100, b"site", RENAME_EXCHANGE) != 0:
    raise OSError(ctypes.get_errno(), "renameat2 exchange of site and site.next failed")
PY
mv site.next site.pre-releases
ls -l "$base"
