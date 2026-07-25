# Environment and Deployment Setup

How to prepare a machine to work on this repo and how code reaches
production. Shipping checklist: [agents.md](../agents.md). Test suites:
[architecture.md](architecture.md). Binding deploy/version rules:
[`.cursor/rules/10-deploy-workflow.mdc`](../.cursor/rules/10-deploy-workflow.mdc).

## Cloud Agent / Fresh Linux VM Setup

```bash
./setup-cloud-agent.sh
```

Installs when missing: `php-cli`, `php-curl`, `python3-pip`, npm deps
(no lockfile), Playwright Chromium. Browser tests use that Chromium by
default; set `CHROME_PATH` only to force a specific binary.

## Run locally

Canonical (serves static pages, keyless music search, and the Books URL importer):

```bash
php -S 127.0.0.1:8000
# http://127.0.0.1:8000/scales.html
```

`python3 -m http.server 8000` is static-only — fine for practice tools, not
Music search or Books URL import. Optional: `npm run dev` (port 8765 + error sink),
`python3 dev-server.py` (8000 + livereload). Details:
`.cursor/rules/04-local-tooling.mdc`.

## Browser API keys

Music needs one Claude or OpenAI key for request interpretation. Books needs
OpenAI for generated speech. Each AI key is entered in Settings and stored
only in that browser. YouTube search needs no key: the same-origin PHP endpoint
queries Piped/Invidious, with IndexedDB search results retained for outages.

## How deploy works

```
Push to master (deployable paths)
  → GitHub Actions "deploy" job: rsync --delete to /srv/voice-wei/site
    → live in ~15s; job verifies live VERSION equals the shipped VERSION
  → GitHub Actions "validate" job IN PARALLEL: typecheck + lint + npm test
    → red validate = the live site needs a fix-forward push now
  → completed-workflow trigger refreshes deploy-telemetry.json
  → reload; check header version
```

Deploy-first is deliberate (single-user site, yui's direction 2026-07-25):
agents run the ~13s local gate before pushing; CI validation is the backstop
that runs after the site is already live.

Docs/rules-only pushes are `paths-ignore`d and do not run the workflow.
`workflow_dispatch` can redeploy the current commit manually. Cursor agents
deploy by pushing `master` (or merging a PR into `master`).

### Production layout

- Public URL: `https://fuseki.net/voice-wei/`
- Deploy account: `voicewei`, with no sudo access
- Document root: `/srv/voice-wei/site`
- GitHub's deploy key is restricted against forwarding and interactive shells
- nginx maps `/voice-wei/` to the dedicated document root, rate-limits
  `/voice-wei/proxy.php` for search and remote imports, and sends only that
  exact path to the `voicewei` PHP-FPM pool; every other `.php` request
  returns 404
- The pool runs as `voicewei`, allows four on-demand workers, confines PHP
  filesystem access to the site root and `/tmp`, and disables process/shell
  execution functions
- `rsync --delete` is scoped to the dedicated document root and cannot touch
  Fuseki's generated site

## GitHub Actions workflow

Production shipping is defined in `.github/workflows/deploy.yml`:

Two parallel jobs:

- **deploy**: checkout → SSH → rsync `--delete` (excludes below) — **site
  live** — then verify the live `VERSION` equals the shipped one.
- **validate**: checkout; Node 24; cached `node_modules` + cached Playwright
  Chromium (the Lyrics startup gate's 1000ms wall-clock budget needs the
  faster-starting Playwright build, measured 2026-07-24); typecheck + lint in
  parallel, then the full `npm test` gate alone on the idle runner.

`.github/workflows/deploy-telemetry.yml` starts only after a fully successful
production workflow (both jobs). It generates and uploads
`deploy-telemetry.json` independently.

Warm runs install nothing: `node_modules` and Chromium come from caches.
Concurrency remains one workflow at a time; in-flight runs are never
cancelled (an aborted rsync `--delete` could leave a partial tree), newer
pushes queue behind the ~15s deploy instead.

### rsync excludes (CI and `deploy.sh` must match)

`.git`, `.gitignore`, `.cursorignore`, `.cursor`, `.github`, `.ast-grep`,
`.vscode`, `.dev`, `config.json`, `config.example.json`, `tests`, `types`,
`demos`, `deploy`, `node_modules`, `__pycache__`, `*.pyc`, `*.md`, `*.txt`,
`*.sh`, `*.py`, `tsconfig.json`, `sgconfig.yml`, `package.json`,
`package-lock.json`, `dev-server.js`, `pipeline-*.svg`, `screenshot-*.png`

What visitors need: `*.html`, `*.js`, `*.css`, `proxy.php`, `favicon.svg`,
`VERSION`, `app-version.js`, and `deploy-telemetry.json` (second rsync).

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `DEPLOY_SSH_KEY` | Private SSH key (full file, BEGIN/END lines) |
| `DEPLOY_HOST` | Server hostname |
| `DEPLOY_USER` | SSH username |
| `DEPLOY_PATH` | Remote directory path (`/srv/voice-wei/site`) |
| `DEPLOY_KNOWN_HOSTS` | Pinned OpenSSH known-hosts line for `DEPLOY_HOST` |

```powershell
winget install GitHub.cli
gh auth login
# Unix LF for the key file, then:
gh secret set DEPLOY_SSH_KEY --repo OWNER/REPO < key.pem
gh secret set DEPLOY_HOST --repo OWNER/REPO
gh secret set DEPLOY_USER --repo OWNER/REPO
gh secret set DEPLOY_PATH --repo OWNER/REPO
gh secret set DEPLOY_KNOWN_HOSTS --repo OWNER/REPO < known_hosts
```

## Manual deploy

```powershell
gh workflow run deploy.yml --repo OWNER/REPO
```

Or local (same excludes as CI; needs `config.json` deploy block):

```bash
./deploy.sh           # Deploy
./deploy.sh --dry-run # Preview
```

Claude, OpenAI, and YouTube API keys are **not** in `config.json` or on the
server — they live in each browser's Settings UI (localStorage).

## Version Management

One number in `VERSION`, also the header label and every asset `?v=N`. After
deploy, reload and check the header to confirm the build.

```bash
./bump-version.sh        # once per user-facing ship
git add …                # include VERSION, app-version.js, shared-header.js, *.html
git commit …
git push origin master   # one push → Actions → live
```

Skip the bump for docs/tests/rules-only commits. Never push bump-only commits.
