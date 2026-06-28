# Environment and Deployment Setup

## Cloud Agent / Fresh Linux VM Setup

Run the repo setup script before verification in a new Cursor cloud agent or
fresh Linux VM:

```bash
./setup-cloud-agent.sh
```

It installs the missing OS tools this repo's checks need when they are absent:

- `php-cli` for `php -l proxy.php`
- `python3-pip` for Python tooling availability
- npm dev dependencies from `package.json` without creating a lockfile

The browser tests use Playwright with the installed Chrome. If an image does
not include Chrome, install Chrome in the base image or set `CHROME_PATH` to a
compatible Chromium/Chrome binary.

Cursor environment setup agent prompt:

```text
For the Voice-Wei repo, update the cloud-agent environment so fresh agents can
run verification without manual setup. Install OS packages php-cli and
python3-pip in the image or startup script. Ensure Chrome is available for
Playwright tests, or set CHROME_PATH to the installed Chromium/Chrome binary.
On startup in the repo, run ./setup-cloud-agent.sh, which installs npm
dependencies with npm install --no-audit --no-fund --no-package-lock and checks
node, npm, python3, pip3, and php.
```

This project uses GitHub Actions for automatic deployment to production.

## How It Works

```
Push to master → GitHub Actions → rsync to server
```

Every push to the `master` branch triggers a deploy. Cursor agents can also deploy by pushing to master.

## GitHub Actions Workflow

The workflow is defined in `.github/workflows/deploy.yml`. It:

1. Checks out the code
2. Sets up SSH with a deploy key from GitHub Secrets
3. Runs rsync to sync files to the server
4. Excludes: `.git`, `.gitignore`, `.cursor`, `.github`, `config.json`, `*.md`, `*.txt`, `*.sh`

## Required GitHub Secrets

Set these in the repo: Settings > Secrets and variables > Actions

| Secret | Description |
|--------|-------------|
| `DEPLOY_SSH_KEY` | Private SSH key (the full file contents including BEGIN/END lines) |
| `DEPLOY_HOST` | Server hostname |
| `DEPLOY_USER` | SSH username |
| `DEPLOY_PATH` | Remote directory path |

## Setting Up Secrets via CLI

```powershell
# Install GitHub CLI if needed
winget install GitHub.cli
gh auth login

# Set secrets (from Windows with WSL for the SSH key)
wsl cat ~/.ssh/id_rsa > $env:TEMP\key.txt
(Get-Content $env:TEMP\key.txt -Raw) -replace "`r`n", "`n" | gh secret set DEPLOY_SSH_KEY --repo OWNER/REPO

gh secret set DEPLOY_HOST --repo OWNER/REPO
gh secret set DEPLOY_USER --repo OWNER/REPO
gh secret set DEPLOY_PATH --repo OWNER/REPO
```

Note: The SSH key must have Unix line endings (LF, not CRLF). The PowerShell snippet above handles this conversion.

## Manual Deploy

You can also trigger a deploy manually:

```powershell
gh workflow run deploy.yml --repo OWNER/REPO
```

Or use the "Run workflow" button in GitHub Actions UI.

## Local Deploy (Bypass CI)

The `deploy.sh` script still works for local deploys:

```bash
./deploy.sh           # Deploy
./deploy.sh --dry-run # Preview what would be synced
```

This reads credentials from `config.json` (see `config.example.json` for format).

## Version Management

All pages share a single version number in the `VERSION` file. The active
workflow is post-push bumping:

```bash
git push origin master   # deploys the committed version
./bump-version.sh        # opens the next dev/cache-bust cycle
```

This updates:
- `VERSION` file (single source of truth)
- `shared-header.js` version label (v30)
- Cache-busting query strings (?v=30)

The version appears in the top-right of each page and ensures browsers fetch
updated CSS/JS files. Work after the bump should include the bumped cache keys
in the next deploy commit; after that push succeeds, bump again.
