# Environment and Deployment Setup

How to prepare a machine to work on this repo and how the deploy pipeline
gets code to production. What to run before shipping is in
[agents.md](../agents.md) ("Shipping"); the test suites themselves are
described in [architecture.md](architecture.md) ("Testing").

## Cloud Agent / Fresh Linux VM Setup

Run the repo setup script before verification in a new Cursor cloud agent or
fresh Linux VM:

```bash
./setup-cloud-agent.sh
```

It installs the missing OS tools this repo's checks need when they are absent:

- `php-cli` for `php -l proxy.php`
- `php-curl` for local `proxy.php` page/search endpoint checks
- `python3-pip` for Python tooling availability
- npm dev dependencies from `package.json` without creating a lockfile
- Playwright's bundled Chromium browser for headless browser checks

The browser tests use Playwright's installed Chromium by default. If a specific
system Chrome is needed, set `CHROME_PATH` to that compatible Chrome/Chromium
binary.

Cursor environment setup agent prompt:

```text
For the Voice-Wei repo, update the cloud-agent environment so fresh agents can
run verification without manual setup. Install OS packages php-cli and
python3-pip in the image or startup script. On startup in the repo, run
./setup-cloud-agent.sh, which installs npm dependencies with npm install
--no-audit --no-fund --no-package-lock, installs Playwright Chromium and its
system dependencies with npx playwright install --with-deps chromium, and
checks node, npm, Playwright, python3, pip3, and php.
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

All pages share a single version number in the `VERSION` file. That number is
also the header label and every asset `?v=N`. Yui uses it after reload to
confirm the live site has the build just shipped.

Ship workflow (user-facing changes only):

```bash
./bump-version.sh        # once per ship
git add …                # include VERSION, app-version.js, shared-header.js, *.html ?v=
git commit …
git push origin master   # one push → Actions → rsync → live
# reload https://fuseki.net/music8899b/… and check the header version
```

`./bump-version.sh` updates:
- `VERSION` (source of truth)
- `app-version.js` / `shared-header.js` label
- Cache-busting query strings on every `*.html` (`?v=N`)

Skip the bump when the commit only touches rsync-excluded paths (docs, tests,
scripts, `.cursor/`). Never push a bump-only commit.
