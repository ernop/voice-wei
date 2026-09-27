# Hosting contract: voice-wei as a tenant of fuseki.net

Who owns the domain, the server, and the boundary between them. The ship
loop this must never break is in [live-change.md](live-change.md); the
deploy mechanics are in [setup.md](setup.md) and
`.cursor/rules/10-deploy-workflow.mdc`. This doc is the interface between
the two projects, written so agents on either side can check their work
against it.

## The decision (yui, 2026-09-02)

**The fuseki.net project owns the domain and the server. Voice-wei is a
tenant.** Voice-wei does not own nginx config, TLS, response headers, the
PHP runtime, the webroot layout, or anything at the domain root. It owns
exactly one directory (`/voice-wei/` today) and the pipeline that fills
it, and it must stay hostable "here or there" — movable to any host that
meets the short requirements list below, with no code changes.

Rationale: the 2026-08-31 fuseki.net rebuild showed the server config is
actively evolving (strict CSP, `permissions-policy`, `nosniff`, new nginx
layout). Two projects both acting like they own one domain is how tenants
get broken by landlord renovations. One owner, one explicit contract.

## What voice-wei requires from any host

A host is suitable iff all of these hold. This is the complete list; a
requirement not written here does not exist.

1. **Static file serving** for one directory tree, with correct MIME
   types for `.html`, `.js`, `.css`, `.json`, `.svg`. (The host sends
   `x-content-type-options: nosniff`, so a wrong MIME type is a hard
   script-load failure, not a quirk.)
2. **HTTPS.** The Web Speech API refuses the microphone on plain HTTP.
3. **No CSP on voice-wei paths.** The pages load pdf.js/jszip from cdnjs
   and call Anthropic/OpenAI APIs directly from the browser; any
   restrictive `content-security-policy` header breaks them.
4. **No `permissions-policy` that blocks the microphone** on voice-wei
   paths. (fuseki.net's root sends `microphone=()`; the voice-wei
   location must stay exempt.)
5. **PHP execution for `proxy.php`** (one file), with outbound network
   access — keyless music search and Books/webpage/PDF import go through
   it. Keyless is part of the product contract
   (`.cursor/rules/12-migration-contract.mdc`).
6. **Tenant directory integrity.** Host-side deploys (the fuseki.net site
   generator, config pushes) must never delete or rewrite files inside
   the voice-wei directory. On the current host this is structural, not
   an exclude rule: voice-wei has its own document root
   (`/srv/voice-wei/site`) that nginx maps to `/voice-wei/`, fully
   separate from Fuseki's generated site (see the production layout in
   [setup.md](setup.md)). Any future host must preserve this property.
7. **Write access for the tenant pipeline.** Voice-wei's own deploy
   (GitHub Actions rsync, or `./deploy.sh`) keeps direct write access to
   its directory, preserving the push-to-live-in-~15s car loop. The host
   does not mediate or gate voice-wei deploys. That directory's absolute
   path must include a component named `voice-wei`: the pipeline's deploy
   target guard refuses any other target ([setup.md](setup.md), "Deploy
   target guard").

## What voice-wei promises the host

1. Everything lives under the one allotted directory; nothing is written
   at the domain root or in other paths.
2. All runtime URLs are relative (`proxy.php?...`, `ebook.js?v=N`), so
   the directory can move hosts or prefixes without code edits. Keep it
   that way: new code must not hardcode the domain or the `/voice-wei/`
   prefix.
3. No demands on the host beyond the requirements list. Server-side
   wishes (compression, caching headers) are requests to the fuseki.net
   project, not entitlements.

## Where the domain appears in this repo

The runtime is domain-free. The full inventory of `fuseki.net`
references, all in tooling, is:

- `.github/workflows/deploy.yml` — `APP_URL`, the app URL the post-deploy
  verify and smoke checks probe (the smoke check derives the host root
  from it).
- `.github/scripts/generate-deploy-telemetry.js` — default existing
  telemetry URL (env-overridable).
- `config.example.json` — the example `deploy.publicUrl` for `./deploy.sh`.
- `tests/audit-search-live.js` — a comment showing an example
  `PROXY_BASE`.

Rehosting voice-wei means: point the `DEPLOY_*` secrets at the new host (its
path inside a `voice-wei` directory), update those URLs, done.

## Known gaps on the current host (fuseki.net side)

Tracked here so tenants' agents do not "fix" them unilaterally; they
belong to the fuseki.net project.

- **No response compression.** The new nginx serves everything identity —
  `ebook.js` is 221 KB uncompressed over cellular where ~50 KB gzipped
  would do. Longer transfers widen the window for mobile load failures
  (observed 2026-09-02: transient "Failed to load script ebook.js" on 5G
  while the server was verifiably healthy).


## Independent-origin hosting review (2026-09-26)

The owner requested a review of Fuseki hosting for this app, Minesweeper
Friendly now, and Nectaris Remake later. New apps use separate HTTPS origins
and isolated deployment identities; their Fuseki paths become entry links.
Voice-Wei remains at its current origin for this change. Moving it requires
explicit transfer of its known browser storage, microphone permission
regranting, deployment URL updates, and preservation of the Articles tab's
staff-session/CSRF-protected voice-draft integration. Do not add blanket CORS
or shared Domain cookies to make a redirect appear sufficient. Its current
PHP runtime/deployment shared identity and in-place rsync also remain review
findings for the migration. The Fuseki project owns this work and its pending
status in the [independent application hosting plan](https://github.com/ernop/fuseki4_ai/blob/master/docs/minesweeper-friendly-hosting-plan.md).

Editor origin move (owner decision 2026-09-26): the Fuseki editor leaves
fuseki.net for its own origin, `https://edit.fuseki.net/<prefix>`, so no
script on fuseki.net (this app included) shares the editor's origin or
cookies. The Articles tab calls the voice-draft API with credentialed CORS;
the editor admits `https://fuseki.net` on those three endpoints only and
keeps its CSRF token check. After the switch, the owner re-enters the editor
URL in the Articles tab once. When Voice-Wei itself moves origin, the editor's
single allowed origin (`VOICE_DRAFT_ORIGIN`) moves with it.
