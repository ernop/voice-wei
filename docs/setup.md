# Deployment Setup

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
