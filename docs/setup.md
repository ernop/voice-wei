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
  → GitHub Actions "deploy" job (one at a time):
      deploy/publish-site.sh: target guard, then the committed tree
      (git archive HEAD) through deploy/rsync-filter, in the layout the
      host provides: rewritten in place, or a new release swapped in with
      one rename
    → live in ~15s; "Verify deployment" confirms the live VERSION, header
      build id, and release.json commit (the live signal)
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
deploy by pushing `master`.

### Production layout

- Public URL: `https://fuseki.net/voice-wei/`
- Deploy account: `voicewei`, with no sudo access
- Document root: `/srv/voice-wei/site`, served in place today; the
  atomic-release layout below is requested from the fuseki.net project
  ([hosting-contract.md](hosting-contract.md), "Pending requests")
- GitHub's deploy key is restricted against forwarding and interactive shells;
  the deploy scripts need only rsync
- nginx maps `/voice-wei/` to the dedicated document root, rate-limits
  `/voice-wei/proxy.php` for search and remote imports, and sends only that
  exact path to the `voicewei` PHP-FPM pool; every other `.php` request
  returns 404
- The pool (`deploy/voicewei-fpm.conf`) runs as `voicewei`, allows four
  on-demand workers, confines PHP filesystem access to `/srv/voice-wei` and
  `/tmp`, and disables process/shell execution functions. Its release-layout
  lines (`open_basedir` widened from `/srv/voice-wei/site`, and
  `opcache.revalidate_path`) are part of the pending host request
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

- **deploy**: checkout → SSH → `deploy/publish-site.sh` — **site live** —
  then "Verify deployment" and "Smoke-check host site and proxy"
  (post-deploy checks below).
- **validate**: checkout; Node 24; cached `node_modules` + cached Playwright
  Chromium (the Lyrics startup gate's 1000ms wall-clock budget needs the
  faster-starting Playwright build, measured 2026-07-24); typecheck + lint in
  parallel, then the full `npm test` gate alone on the idle runner.

`.github/workflows/deploy-telemetry.yml` starts only after a fully successful
production workflow (both jobs). It generates `deploy-telemetry.json` by
merging GitHub's recent runs into the live copy's history, then
`deploy/upload-telemetry.sh` puts it where the host layout serves it from.
Publishing never deletes that file, so the Deploys page keeps its data across
deploys and history accumulates. Before 2026-09-27 every deploy deleted it:
the Deploys page fell back to the GitHub API until the next green telemetry
run (nine days after one failed run in August), and each regeneration started
from nothing, capping history at the latest 100 runs.

Warm runs install nothing: `node_modules` and Chromium come from caches.

Concurrency (decision 2026-09-27): only the deploy job queues. Its
concurrency group `deploy-production` runs one deploy at a time and never
cancels a running one (a half-finished publish must not be abandoned); a
newer push's deploy waits for the running deploy, not for that push's
validate job, and validate jobs of consecutive pushes run side by side. A
deploy still waiting when an even newer push arrives is replaced by it, so
that run ends cancelled and its validate result stands on its own.

### Publish filter (`deploy/rsync-filter`)

One file lists what never ships, read by `deploy/publish-site.sh` for every
layout (with `--delete --delete-excluded` when publishing in place).
Excluded: `.git`, `.gitignore`, `.cursorignore`, `.cursor`, `.github`,
`.ast-grep`, `.vscode`, `.dev`, `config.json`, `config.example.json`,
`tests`, `types`, `demos`, `deploy`, `node_modules`, `__pycache__`, `*.pyc`,
`*.md`, `*.txt`, `*.sh`, `*.py`, `tsconfig.json`, `sgconfig.yml`,
`package.json`, `package-lock.json`, `dev-server.js`, `pipeline-*.svg`,
`screenshot-*.png`, `coolness-log.jsonl`.

`coolness-log.jsonl` (1.2 MB, the Wording CLI's append-only batch log) stopped
shipping on 2026-09-27: no page reads it. `deploy-telemetry.json` has its own
owner, the telemetry workflow: an in-place publish protects the host's copy
(`P`), and every release links `deploy-telemetry.json` to
`../../shared/deploy-telemetry.json` beside the releases.

What visitors need: `*.html`, `*.js`, `*.css`, the `coolness-*.json` data
the Wording tab fetches, `proxy.php`, `favicon.svg`, `VERSION`,
`release.json` (written by each publish), and `deploy-telemetry.json` (from
the telemetry workflow). `tests/test-deploy.js` evaluates the filter against
the repository in the local gate: only top-level product files ship, every
local-only artifact named in `.gitignore` is excluded, every file a page loads
or fetches is published, and every published data file is read by a page.

### Deploy target guard (`deploy/check-target.sh`)

Decision (2026-09-27): confinement to the voice-wei directory is enforced by
the pipeline itself, not only by host permissions. Every script that touches
the host (`publish-site.sh`, `host-layout.sh`, `swap-release.sh`,
`upload-telemetry.sh`) runs the guard before its first rsync, and guards the
directory beside the target (`/srv/voice-wei`) before writing releases,
the live symlink, or `shared/` there. The workflows and `deploy.sh` never run
rsync themselves. `tests/test-deploy.js` fails on any of these regressions.
The guard refuses the target unless:

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

### Host layouts and atomic releases

Decision (2026-09-27, yui approved): publishing becomes atomic, so a page
load never mixes files from two builds (new HTML naming `?v=N+1` assets that
are not uploaded yet, which the browser then caches under the new URL). The
host owns the layout; `deploy/host-layout.sh` reads which one it provides,
and every deploy script follows it. There is one decision point, not a
fallback chain:

- **in-place** (today): `DEPLOY_PATH` is the served directory.
  `publish-site.sh` rewrites it with `rsync --delete`, one file at a time.
- **releases** (after the pending host change): `DEPLOY_PATH` is a symlink
  to `releases/<id>` beside it. Nginx is unchanged: it keeps serving
  `/srv/voice-wei/site`. Each deploy:
  1. publishes the committed tree into a new `releases/<id>` (id =
     UTC timestamp and short commit), hardlinking files that are unchanged
     from the live release, so only changed files travel and old releases
     keep their inodes;
  2. swaps the symlink with one rename (`deploy/swap-release.sh`: rsync
     writes the new symlink under a temporary name and renames it over
     `site`; traced on the replica as `symlink()` then `rename()`). The swap
     is compare-and-swap: it happens only if the live release is still the
     one this deploy started from, so a deploy never replaces a release that
     another deploy put live meanwhile, and the losing deploy's verify step
     reports NOT LIVE;
  3. keeps the newest 5 releases plus the live one and prunes the rest.

  Host-owned state lives in `shared/` beside the releases
  (`shared/deploy-telemetry.json`).

Both layouts publish by checksum without copying mtimes. `git archive`
stamps every file with the commit time, so a size-and-mtime comparison could
skip a same-size edit when two deployed commits share a second, while
untouched files keep their served mtime and ETag. Each tree carries
`release.json` (`version`, `commit`, `release`, `layout`); `verify-live.sh`
checks the commit, which proves this deploy is live even without a version
bump and even when `VERSION` matches an older tree.

Rehearsed on a replica host (sshd, a non-root `voicewei` account, nginx with
the production mapping, and PHP 8.3.6 FPM with the production pool) running
the exact `deploy/host-release-setup.sh`. Findings that shaped the design:

- With the docroot as a symlink and the production pool unchanged, warm FPM
  workers kept running the previous release's `proxy.php` for the whole
  observation window after a swap (opcache keyed to the resolved path; a
  cold worker picked up the new code at once). `opcache.revalidate_path = on`
  removed it: 0 stale answers and 0 errors across 13,000 warm requests and 5
  swaps, and 30/30 fresh answers right after each of 5 real release deploys.
  Nginx picked up static files at once.
- A swap onto a still-real directory fails loudly ("cannot delete non-empty
  directory") and leaves it intact, so the pipeline cannot break a host that
  has not been converted.
- The conversion itself (an atomic `renameat2` exchange of the directory and
  the symlink) held up under continuous requests and back-to-back deploys
  with 0 failed requests. A deploy caught mid-upload by the conversion
  finished into the old directory and its verify step said NOT LIVE (its
  commit, not its unchanged `VERSION`, gave it away); the next deploy
  published a release.
- A pre-2026-09-27 pipeline run after the conversion (a re-run of an old
  workflow, or a stale `deploy.sh`) writes through the symlink into the live
  release: the site stays up and serves that older tree until the next
  deploy. Two deploys racing (a manual `deploy.sh` overlapping CI, which
  itself runs one deploy at a time) end with exactly one live and the other
  reporting NOT LIVE.

Rollback paths: `./deploy.sh --rollback [RELEASE]` points `site` back at the
previous (or a named) release in one rename; a revert commit and push
publishes forward as usual; and the host can undo the conversion by
exchanging `site` with the kept `site.pre-releases` directory, after which
deploys detect in-place again (hosting-contract.md).

### Post-deploy checks

- **Verify deployment** (`deploy/verify-live.sh APP_URL VERSION [COMMIT]`):
  the live `VERSION` and the header build id in `app-version.js` equal the
  shipped number, and `release.json` names the shipped commit. This step is
  the live signal. Agents confirm a ship with the same command, e.g.
  `deploy/verify-live.sh https://fuseki.net/voice-wei/ 355 <sha>`; leave the
  commit off when another push may have landed on top of yours.
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
  table, the writer wiring (callers never run rsync; every deploy script
  guards first), the single `git archive` source, job-level deploy
  concurrency, the commit-checking verify step, the publish contents, one
  build number across `VERSION`, `app-version.js`, the header fallback, and
  every `?v=`, and the tenant scope: `proxy.php` is the only server-side
  code, no server config files ship, pages use only relative URLs, and
  shipped code sets no cookies and never clears origin-wide storage.

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

Or local (needs the `config.json` deploy block, `jq`, and `rsync`).
`deploy.sh` publishes the committed tree (HEAD) through the same
`deploy/publish-site.sh` as CI, so uncommitted edits and untracked files
never ship (it says so when the working tree is dirty), then runs the same
verify and smoke checks against the app URL derived from `deploy.publicUrl`:

```bash
./deploy.sh                      # Deploy HEAD
./deploy.sh --dry-run            # Preview
./deploy.sh --rollback [RELEASE] # Releases layout: back to the previous (or named) release
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
