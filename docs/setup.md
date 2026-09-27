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
  → GitHub Actions "deploy" job:
      deploy/check-target.sh refuses any target outside a voice-wei directory
      rsync --delete through deploy/rsync-filter to /srv/voice-wei/site
    → live in ~15s; "Verify deployment" confirms the live VERSION and
      header build id equal the shipped VERSION (the live signal)
    → "Smoke-check host site and proxy": fuseki.net still serves, none of
      our files answer at its root, proxy.php works
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
  Fuseki's generated site. That is the server side of the boundary; the
  pipeline side is the deploy target guard below, so a misconfigured secret
  cannot aim the publish anywhere else either
- Ownership boundary with the fuseki.net project (who owns the domain,
  headers, PHP runtime; what voice-wei may assume):
  [hosting-contract.md](hosting-contract.md)

## GitHub Actions workflow

Production shipping is defined in `.github/workflows/deploy.yml`:

Two parallel jobs:

- **deploy**: checkout → SSH → target guard → rsync `--delete` through the
  publish filter — **site live** — then "Verify deployment" and "Smoke-check
  host site and proxy" (post-deploy checks below).
- **validate**: checkout; Node 24; cached `node_modules` + cached Playwright
  Chromium (the Lyrics startup gate's 1000ms wall-clock budget needs the
  faster-starting Playwright build, measured 2026-07-24); typecheck + lint in
  parallel, then the full `npm test` gate alone on the idle runner.

`.github/workflows/deploy-telemetry.yml` starts only after a fully successful
production workflow (both jobs). It generates `deploy-telemetry.json` by
merging GitHub's recent runs into the live copy's history, then uploads it.
The publish never deletes that file (see the publish filter), so the Deploys
page keeps its data across deploys and history accumulates. Before
2026-09-27 every deploy deleted it: the Deploys page fell back to the GitHub
API until the next green telemetry run (nine days after one failed run in
August), and each regeneration started from nothing, capping history at the
latest 100 runs.

Warm runs install nothing: `node_modules` and Chromium come from caches.
Concurrency remains one workflow at a time; in-flight runs are never
cancelled (an aborted rsync `--delete` could leave a partial tree). The
concurrency group covers the whole workflow, so a newer push queues behind
the entire running workflow (deploy plus validate, about a minute), not
just its ~15s deploy job.

### Publish filter (`deploy/rsync-filter`)

One file lists what never ships; CI and `deploy.sh` both publish through it
(`--filter='merge deploy/rsync-filter'` with `--delete --delete-excluded`),
so the two paths cannot drift. Excluded: `.git`, `.gitignore`,
`.cursorignore`, `.cursor`, `.github`, `.ast-grep`, `.vscode`, `.dev`,
`config.json`, `config.example.json`, `tests`, `types`, `demos`, `deploy`,
`node_modules`, `__pycache__`, `*.pyc`, `*.md`, `*.txt`, `*.sh`, `*.py`,
`tsconfig.json`, `sgconfig.yml`, `package.json`, `package-lock.json`,
`dev-server.js`, `pipeline-*.svg`, `screenshot-*.png`.

`deploy-telemetry.json` has its own owner, the telemetry workflow: the
filter protects the host's copy from deletion (`P`) and never sends a local
one (`-`).

What visitors need: `*.html`, `*.js`, `*.css`, `*.json`/`*.jsonl` data,
`proxy.php`, `favicon.svg`, `VERSION`, and `deploy-telemetry.json` (from the
telemetry workflow). `tests/test-deploy.js` evaluates the filter against the
repository in the local gate: only top-level product files ship, every
gitignored artifact is excluded (`deploy.sh` publishes a working tree, which
can hold `config.json` or the private deploy key), and every file a page
loads or fetches is published.

### Deploy target guard (`deploy/check-target.sh`)

Decision (2026-09-27): confinement to the voice-wei directory is enforced by
the pipeline itself, not only by host permissions. Every writer to the host
runs the guard immediately before its rsync: the publish step in
`deploy.yml`, the upload in `deploy-telemetry.yml`, and `deploy.sh`.
`tests/test-deploy.js` fails if any rsync in those files is not preceded by
it. The guard refuses the target unless:

- the user is a plain account name and not `root`;
- the host is a hostname or IPv4 address (no `@`, `:`, spaces, or options);
- the path is absolute and every component is a plain name (no empty, `.`,
  `..`, hidden, or special-character components; one trailing slash is
  ignored and callers strip it the same way);
- the path lies inside a directory named `voice-wei`.

Why: the target used to be assembled from the secrets inline. An empty
`DEPLOY_PATH` produced `user@host:/`, aiming `rsync --delete
--delete-excluded` at the remote filesystem root, and `/srv` planned
deletion of the sibling Fuseki site (a dry run against a replica host listed
91 deletions, including Fuseki's `index.html`). Only the deploy account's
permissions stood in the way, and those would still have let it delete its
own tree and its `~/.ssh`. Secrets also reach every script as `env:` data,
never as interpolated script text, so a stray character in a secret cannot
change the command.

### Post-deploy checks

- **Verify deployment** (`deploy/verify-live.sh APP_URL VERSION`): the live
  `VERSION` and the header build id in `app-version.js` both equal the
  shipped number. This step is the live signal. Agents confirm a ship with
  the same command, e.g. `deploy/verify-live.sh https://fuseki.net/voice-wei/ 355`.
- **Smoke-check host site and proxy** (`deploy/smoke-live.sh APP_URL`): the
  host's root (`https://fuseki.net/`) serves HTML; this app's
  `app-version.js` and `proxy.php` do not answer at that root; `proxy.php`
  reports a working cURL; and it imports `https://example.com/` end to end.
  It runs after Verify, so a red smoke step means the ship is live but the
  named piece needs attention: the host site belongs to the fuseki.net
  project, `proxy.php` failures point at PHP-FPM or outbound network.
  Keyless music search is deliberately not gated: it depends on third-party
  Piped/Invidious instances whose outages the player rides out with its
  search cache.
- **Local gate**: `tests/test-deploy.js` holds the guard's accept/refuse
  table, the writer wiring, the publish contents, one build number across
  `VERSION`, `app-version.js`, the header fallback, and every `?v=`, and the
  tenant scope: `proxy.php` is the only server-side code, no server config
  files ship, pages use only relative URLs, and shipped code sets no cookies
  and never clears origin-wide storage.

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `DEPLOY_SSH_KEY` | Private SSH key (full file, BEGIN/END lines) |
| `DEPLOY_HOST` | Server hostname |
| `DEPLOY_USER` | SSH username |
| `DEPLOY_PATH` | Remote directory path (`/srv/voice-wei/site`); must be absolute and inside a `voice-wei` directory (the guard refuses anything else) |
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

Or local (needs the `config.json` deploy block, `jq`, and `rsync`). It runs
the same target guard and publish filter as CI, then the same verify and
smoke checks against the app URL derived from `deploy.publicUrl`:

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
