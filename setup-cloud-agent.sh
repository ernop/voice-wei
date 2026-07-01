#!/usr/bin/env bash
# Prepare a Cursor/cloud-agent VM for this repo's verification commands.

set -euo pipefail

cd "$(dirname "$0")"

install_apt_packages() {
    if ! command -v apt-get >/dev/null 2>&1; then
        return
    fi

    local packages=()
    if ! command -v php >/dev/null 2>&1; then
        packages+=("php-cli")
    fi
    if ! command -v php >/dev/null 2>&1 || ! php -r 'exit(extension_loaded("curl") ? 0 : 1);'; then
        packages+=("php-curl")
    fi
    if ! command -v pip3 >/dev/null 2>&1; then
        packages+=("python3-pip")
    fi

    if [ "${#packages[@]}" -eq 0 ]; then
        return
    fi

    local sudo_cmd=""
    if [ "$(id -u)" -ne 0 ]; then
        sudo_cmd="sudo"
    fi

    $sudo_cmd apt-get update
    if [ -n "$sudo_cmd" ]; then
        $sudo_cmd DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
    else
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
    fi
}

install_apt_packages

npm install --no-audit --no-fund --no-package-lock
npx playwright install chromium

node --version
npm --version
npx playwright --version
python3 --version
pip3 --version
php --version

echo "Cloud agent setup complete."
