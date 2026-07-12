# Live change: what yui actually needs

The real requirements for “I asked an agent to change something.” Product
behavior of the music tools lives in [product-goals.md](product-goals.md);
how deploy works today lives in [setup.md](setup.md) and
`.cursor/rules/10-deploy-workflow.mdc`. This doc is the **narrow contract
for shipping feedback** — and it deliberately separates *requirements*
from *mechanisms*.

## The 99% workflow

1. Yui is often **driving**, phone in hand (or on a mount), already using
   a Voice-Wei tab — or about to open one.
2. Yui **voice-messages an agent** (Cursor cloud / chat) asking for a
   change.
3. The agent implements it, puts it in the repo, and **gets it onto the
   live site**.
4. Yui needs to **know the change is live**, then reload (or just keep
   using) and experience the new behavior.

That is the whole loop. Everything else in deploy/version/CI is in
service of this loop — or it is waste.

## Actual product requirements

Only three. If a design does not serve one of these, it is optional
ceremony.

### R1 — The change becomes what the phone loads

After the agent finishes, a normal load/reload of the relevant live URL
(`https://fuseki.net/voice-wei/…`) must serve the new HTML/JS/CSS/PHP
behavior (modulo ordinary browser cache, which we must defeat or bypass
when we claim “it’s live”).

**Not required:** a particular git branching model, a PR, a staging
site, a bundler, or building *on* the server — unless those help R1
more cheaply than what we have.

### R2 — Yui learns that it is live (the signal)

Something must convey, to the human, **“the thing you asked for is now
on the live site.”**

Properties of a good signal:

- **Human-memorable or interruptive** — yui should not have to compare
  opaque strings (full git SHAs fail this).
- **Trusted** — false “live” is worse than a slow signal.
- **Fits the car** — glanceable or audible; does not demand a laptop or
  a careful reading of GitHub Actions.

**The webpage header version is one mechanism, not the requirement.**
It exists because yui is often already on the page: reload → number went
up → “ok, it’s in.” That is convenient. It is not sacred.

### R3 — The work is not only on the server

The change should land in the **git repo** (source of truth for agents
and future mei). Live-only edits with no repo history fight the way this
project is developed. “Ship earlier to the website” is allowed as an
*extra* fast path only if the repo still catches up (or yui explicitly
accepts throwaway live experiments).

## What is *not* a requirement

- That the signal live **inside** the music app UI.
- That every commit bump a visible integer (docs-only work need not).
- That yui watch GitHub Actions, read logs, or understand rsync.
- That local `?v=` match production while developing.
- That deploy be slow enough to “feel careful,” or fast for its own sake —
  only fast enough that the car loop stays pleasant.
- Multi-user release notes, semver, or store review cycles.

## Mechanisms (menu, not mandates)

Any mix that satisfies R1–R3 is fine. Prefer the cheapest thing that
works in the car.

| Mechanism | How yui knows | Pros | Cons |
|-----------|---------------|------|------|
| **Incrementing header build id** (current) | Reload; number larger than before | Works offline-from-chat; always on the page yui is using; no extra app | Async: yui must reload and look; easy to miss if cache lies; ceremony in repo/CI |
| **Agent says “live” in Cursor chat** | Read/hear the agent’s final message after Actions succeeds | Natural end of the same conversation that took the voice note | Easy to say “live” before rsync finishes; chat is easy to leave |
| **Push / SMS / Signal / email when deploy succeeds** | Phone buzzes | Best for driving; no reload required to *know* | Needs a notifier wired to GitHub Actions success; another secret/integration |
| **Audible cue** (TTS / short sound on the open tab via a tiny channel) | Hear it while the tab is open | Hands-free | Needs an open tab + some push path into the page (non-trivial) |
| **Deploys page / badge** | Open deploys.html | Good for debugging ships | Wrong surface for the car loop |
| **Build on the server from git** | Same signals as above | Could shorten “merge → files on disk” | Ops complexity; this app is already static files — little win vs rsync from CI |
| **Agent rsyncs directly** (bypass CI) | Agent announces live after `./deploy.sh` | Fastest path to R1 | Skips gates unless agent runs them; easier to desync from “what CI would have shipped” |

**Cache busting** (`?v=N` on assets) is not a signal to yui. It is an
implementation detail so R1 is true after reload when the header (or
other signal) says live. If we notified via Signal and also stamped
assets, yui might never look at the number — and that would still be a
correct design.

## Decisions (standing)

1. **Requirement = live + know + repo** (R1–R3). Not “we must have a
   version field in the header forever.”
2. **Incrementing integers beat SHAs** when the signal is something yui
   glances at and compares to “what I saw before.” SHAs are for machines
   and deep links.
3. **Auto-deploy to fuseki.net stays.** Yui likes change → website
   without babysitting. Keep that property unless a new path is clearly
   better for the car loop.
4. **Out-of-band notify is in scope** and may eventually dominate the
   header number. Wiring Actions → Signal/SMS/email (or a reliable
   “deploy succeeded” line in the agent’s closing message *after*
   checking the workflow) is a valid product improvement, not a side
   quest.
5. **Do not optimize deploy architecture for elegance** ahead of the
   car loop. Allowlists, job splits, and stamp scripts are worthwhile
   only when they make R1 faster/safer or R2 clearer — not as ends.

## Current mechanism (honest snapshot)

Today we satisfy R2 mainly with an **incrementing header version** plus
`?v=N` cache bust, stamped in git and shipped via Actions → rsync. That
matches the “reload the phone tab” habit. It is awkward when yui is not
looking at the page, and it couples “human signal” to “asset cache key”
more than it strictly must.

CI speed, paths-ignore, and caches matter only insofar as they shorten
the wait between voice note and trustworthy “live.”

## Direction when we change ship/notify

When touching deploy or versioning, ask in order:

1. Does this make **R1** true sooner or more reliably on the phone?
2. Does this make **R2** clearer in the car (including non-web signals)?
3. Is **R3** still true (repo has the change)?

If the answer is only “the pipeline is prettier,” stop.

## Open choices (not yet decided)

- Prefer **header integer**, **Actions → phone notify**, **agent
  post-deploy confirmation**, or **both** (notify primary, header
  backup)?
- Should the agent’s definition of “done” be **“Actions green + live
  URL serves new id”** before saying live in chat?
- Is a **direct agent deploy** (`./deploy.sh` after local gates) ever
  allowed for tiny car-loop fixes, with CI as backup?

Record the choice here when yui picks one; until then, keep the working
header-integer path and do not invent SHA-based glance signals.

## Multi-model review (2026-07-10)

Reviewed by Fable, GPT-5.5, Opus 4.8, and GPT-5.6 Sol (Gemini not
available in this agent environment). Consensus and dissent below.

### Strong consensus

1. **R1/R2/R3 framing is right.** Keep it. Header integer is a mechanism.
2. **False “live” is worse than a slow signal.** This should drive policy
   harder than the open-choices section currently does.
3. **Agent must not say “live” until verified.** Promote from open choice
   to standing decision: wait for Actions success **and** public origin
   serves the expected integer (`curl` live `VERSION` / `app-version.js`
   with cache bypass) before claiming live in chat. On failure, say
   **NOT LIVE** with the reason — silence is a failure mode.
4. **HTML document cache is an under-named R1 risk.** `?v=N` busts
   assets; stale `player.html` (no Cache-Control) can keep old `?v=` and
   an old header forever. Fix: HTML/VERSION revalidate or no-cache;
   assets can stay long-cache + `?v=`.
5. **Phone notify is best car-native R2**, but only **after** origin
   attestation — a lying buzz is worse than none. ntfy (or similar) is
   enough; Signal automation is optional later.
6. **Direct `./deploy.sh` is not a normal car-loop path** (blast radius
   with `--delete`, skips CI gates). Emergency-only, from clean
   `origin/master`, if ever.
7. **Do not chase pipeline elegance** ahead of the car loop.

### Important additions the doc under-weighted

| Gap | Why it matters | Cheap fix |
|-----|----------------|-----------|
| No negative signal | Failed CI = eternal silence while yui reloads in traffic | Agent reports NOT LIVE; optional ntfy on failure |
| “A deploy happened” ≠ “**my** change” | Concurrent agents; header only says number went up | Chat names the change + `vN` |
| Green ≠ live | rsync exit 0 ≠ public URL serves new bits | Post-rsync `curl` assert in CI |
| Open tab never reloads | Header can’t reach “keep using” | Poll live `VERSION`; toast / optional TTS “vN ready — reload” (respect practice-test silence) |
| `cancel-in-progress` | Second push can cancel first mid-rsync / drop notify | Don’t cancel after rsync starts; or atomic release dirs |
| In-page poll mis-costed | Doc called audible/push-into-page “non-trivial”; polling static `VERSION` is ~30 lines and matches `deploys.js` | Add poll + “tap to reload” |

### Divergent / heavier ideas (not consensus)

- **Atomic releases** (`releases/<sha>/` + `current` symlink) — Sol’s
  strongest correctness push; kills partial-rsync and cancel mid-write.
  More server layout change; high value if concurrent agents are common.
- **`release.json`** (version + sha + summary) — shared by CI verify,
  page poll, and notify body.
- **Car Bluetooth / media-session flash** (“vN ready”) — clever, bends
  Music’s lyric-title rule; needs yui sign-off.
- **Drop header integer once notify+verify exist** — allowed by R2; keep
  as backup until notify is trusted in the car.
- **Trim Playwright from blocking path** — speeds R1; trade gate safety.

### Recommended sequence (synthesis)

Do these in order; stop when the car loop feels trustworthy:

1. **Standing rule:** agent done = Actions green + live `VERSION` matches
   ship; else explicit NOT LIVE (chat).
2. **CI post-rsync probe:** fail the job if public `VERSION` ≠ shipped.
3. **HTML/VERSION cache headers** (no-cache or revalidate).
4. **In-page poll** of live `VERSION` → persistent “vN ready — reload”
   (optional TTS when not in test/playback).
5. **Optional:** ntfy (or similar) on verified success **and** failure.
6. **Later if needed:** atomic publish dirs; `release.json`; tighten
   paths so non-ship pushes don’t look like deploys.

Until yui picks notify-primary vs header-primary: **keep the integer
header as backup; make verified agent chat the primary R2 for the
voice-note loop.**
