# Control and Button Library

The complete inventory of button/control classes across every page, who
owns them, and the unification plan - written to prepare feature
unification between tabs and the final standardization pass, starting
with the music UI. The design rules these classes implement (canonical
pickers, grouping, settings order) live in
[architecture.md](architecture.md); this doc tracks the concrete class
vocabulary and what still deviates from it.

## Target vocabulary (roles, not looks)

Every button on every page must resolve to one of these roles. A class
that duplicates a role is a dialect and gets retired; a class that truly
is not one of these roles gets listed under "Deliberately distinct
surfaces" in architecture.md with its reasoning.

| Role | Canonical class | Owner sheet |
|------|-----------------|-------------|
| Option chip (pick one of N) | `vf-btn` (+ `.selected`), in a `segment-row` or `vf-row` | practice-controls.css |
| Numeric stepper | `step-field` / `step-field-bare` + `step-btn` | practice-controls.css |
| Small action chip (Copy, Clear, Save, Apply...) | `panel-action-btn` (+ `.danger`) | practice-controls.css |
| Mid-size neutral action | `secondary-btn` (+ `.danger`) | practice-controls.css |
| Mid-size primary action (Import, Generate, Play) | `primary-btn` | practice-controls.css |
| Practice transport | `listen-button`, `play-button` (+ `.listening`), `stop-button`, `next-button`, `repeat-button` (+ `.selected`) | practice-controls.css / style.css |
| Pitch test / sing launch | `pitch-test-launch-button` in `.pitch-test-dock` (bottom sheet; not in the transport row) | practice-controls.css |
| Primary submit | `submit-button-large` | style.css |
| On/off toggle | `display-toggle` chip checkbox | practice-controls.css |
| Text field | `text-input` (pages size it, never re-skin) | style.css |
| Site chrome | `footer-btn`, `settings-btn` | style.css |

Modifiers are fixed too: `.selected` for selected state (no `.active`
dialects), `.danger` for destructive, `.listening` for an active mic.

**Density:** adding `vf-compact` to a settings container switches every
shared control inside it to the 16px pill density introduced on Phrases.
Phrases and Scales use it; a page that wants the compact car-glance
layout opts in with that one class instead of re-declaring sizes.

## Inventory - conforming pages

Scales, Intervals, Phrases, Trace, and Pitch use only the canonical
vocabulary plus their declared gameplay surfaces:

| Page | Gameplay-surface classes (deliberate) |
|------|--------------------------------------|
| Intervals | `answer-btn` (ear answer grid), `drone-btn` (drone test) |
| Phrases | `phrase-stage-btn` (stage actions), `phrase-toggle-btn` (a `vf-btn` modifier) |
| Scales | piano keyboard keys |
| Shared panel | `pitch-test-btn` (panel internals), `history-play-btn` (history rows) |

`tests/test-css-ownership.js` enforces that these page sheets never
redefine a shared class, and `tests/test-controls.js` fails if a retired
dialect class reappears.

## Inventory - the music UI (player.html, styles in style.css)

The player consumes the canonical `vf-btn` segment rows, `panel-action-btn`,
`primary-btn`, `step-field`/`step-btn`, `listen-button`,
`submit-button-large`, and `text-input`. The song-report row uses those
canonical controls directly: Request is primary, Identity/Song Report is a
segment, the seconds-per-line picker is a step field, and Report Text is a
`vf-btn` toggle that opens the saved report as text in a bounded scrollable
panel. Share Song is a `secondary-btn` in the same selected-song action row;
it is disabled until a song is selected and copies that exact recording's
self-contained URL. Song Report is
available whenever a song is selected: it activates a saved report or requests
one when none is stored, and its label carries request wait/result state. The
Log header uses `panel-action-btn`; **Show Previous** is a separate explicit
history action and opening the panel itself shows only current-session lines.
The player also carries these dialects, all defined in style.css:

| Dialect class | Job today | Resolution |
|---------------|-----------|------------|
| `typed-command-submit-btn` | Send the typed request | Retire -> `secondary-btn` (or `submit-button-large` if it should carry primary weight) |
| `close-settings-btn` | Close the settings panel | Retire -> `panel-action-btn` (shared with Books) |
| `save-api-key-btn` | Save an API key | Retire -> `panel-action-btn` (shared with Books) |
| `api-key-action-btn` (+ `.danger`) | Show/Change/Remove key | Retire -> `panel-action-btn` (shared with Books) |
| `control-btn` / `control-btn-large` / `control-btn-small` | Central player transport (prev/play/stop/next, rewind/forward, lyrics launchers) | Keep as ONE named media-transport family (see below) |
| `transport-bar-btn` (+ `transport-bar-playpause`) | Sticky bottom transport bar | Fold into the same media-transport family |
| `big-lyrics-btn`, `lyrics-control-btn` | Lyrics launchers (now in the central player's secondary control row) | State classes on media-transport buttons, not separate button kinds |
| `lyrics-overlay-transport-btn`, `lyrics-overlay-control-btn`, `lyrics-overlay-action-btn`, `lyrics-panel-hide-btn` | Overlay transport + view chips + hide | Three near-identical chip kinds; collapse to media-transport (transport) and `panel-action-btn` (view chips, hide) |
| `lyrics-sync-btn`, `lyrics-offset-value` | Shared timing correction controls and live offset in the sticky bar and Big Lyrics | Keep as one semantic lyric-sync family across both surfaces |
| `favorite-btn`, `lyrics-row-btn`, `playlist-remove-btn` | Playlist row star / per-row lyrics chip / per-row remove | Row-level gameplay surface; keep, document in architecture's distinct list |

Retired in the playlist-organization pass (v218): `quick-action-btn` on the
player (now `secondary-btn` / `primary-btn`; deploys.html still carries the
class and CSS until its own pass) and `clear-playlist-btn` (now
`panel-action-btn danger` in the playlist header alongside Shuffle and the
sort chips).

**Media transport is deliberately distinct, but it must be one family.**
architecture.md already exempts the player's media transport bar from the
practice-transport look; today that exemption is spent on three separate
families (`control-btn*`, `transport-bar-btn`, overlay transport). The
end state is a single `media-btn` family with size/context modifiers,
used by the central player, the sticky bar, and the lyrics overlay.

## Inventory - Books (ebook.css) - CONVERGED

Books now loads practice-controls.css and uses the shared vocabulary;
ebook.css is in the ownership test and holds layout only. The mapping
that was executed:

| Retired dialect | Now |
|-----------------|-----|
| `small-action-btn` (+ `.danger`) | `panel-action-btn` (+ `.danger`); `transport-step-btn` survives as a layout modifier |
| `primary-action-btn`, `upload-button` | `primary-btn` |
| `danger-action-btn` | `secondary-btn danger` |
| `speed-step-btn` + `speed-control` | `step-field step-field-bare` + `step-btn` / `step-value` |
| `voice-sample-btn` (+ `.selected`, `.playing`) | `vf-btn` (+ `.selected`); `.playing` styled as a scoped state in ebook.css |
| `back-library-btn` | `secondary-btn` |
| `save-api-key-btn`, `api-key-action-btn`, `close-settings-btn`, `clear-log-btn` (Books markup only) | `panel-action-btn` (+ `.danger`) |
| `model-selector` (Books' selects) | renamed `books-select` so the retired player dialect name stays dead |

Books' OpenAI voice/model `<select>`s stay (dynamic lists; the declared
exception in architecture.md). The Listen card's transport grid keeps
the shared classes but sizes them tall (58px) for driving. AI Research is its
own blue-bordered card immediately after Listen, with a full-width
`primary-btn` launch, `primary-btn` Research submit, and `panel-action-btn`
Close / answer navigation controls. Seven compact answer buttons cover
page/paragraph/sentence backward and forward with Play centered. Saved research
rows use the existing panel vocabulary. The sticky reader toolbar adds explicit
Go to latest read / Go to playing section actions. Normal audio controls are
chapter-level; audio-part generation/download/deletion and markers are grouped
inside collapsed Advanced/Audio details. No new button dialect is introduced.

## Other pages

- `index.html`: card links only, no buttons.
- `deploys.html`: one `quick-action-btn` (Refresh) - retires with the
  player's class into `secondary-btn`.
- `shared-header.js`: emits `settings-btn` and `footer-btn` (site chrome).

## Unification plan (music UI first)

Ordered so each stage ships alone, and the page never gets worse at its
job (architecture.md, "How to decide what a control looks like"):

1. **Action chips.** Replace `quick-action-btn`, `clear-playlist-btn`,
   `typed-command-submit-btn`, `close-settings-btn`, `save-api-key-btn`,
   `api-key-action-btn`, `lyrics-overlay-action-btn`, and
   `lyrics-panel-hide-btn` with `panel-action-btn` / `secondary-btn`
   (+ `.danger`) on player.html and deploys.html. Delete the retired CSS.
2. **One media-transport family.** Define `media-btn` (one look, size and
   context modifiers) in the player's stylesheet; migrate the central
   player, sticky transport bar, and lyrics overlay transport onto it.
   Lyrics availability (`lyrics-available` / `lyrics-loading` /
   `lyrics-unavailable`) becomes state classes on `media-btn`.
3. **Ownership and enforcement.** Carve the player's styles out of
   style.css into `player.css`, add `player.css` to the `PAGE_SHEETS`
   list in `tests/test-css-ownership.js`, and add every retired class
   from stages 1-2 to the retired-dialects list in
   `tests/test-controls.js` so they cannot reappear.
4. **Books pass - DONE.** The Books mapping table above was executed:
   ebook.html loads practice-controls.css, ebook.css lost its private
   button vocabulary, ebook.css is in the ownership test, and the Books
   dialects are on the retired list with `ebook` checked as a page.

Feature unification between tabs (shared favorites/history surfaces,
transport conventions, car mode) builds on this: controls converge first
so features that move between tabs arrive already speaking the shared
control language.

## Dead classes (removed)

- `load-favorites-btn` (style.css) - markup now uses `quick-action-btn`;
  rules deleted.
- `preview-voice-btn` (ebook.css) - superseded by `voice-sample-btn`
  (itself now retired into `vf-btn`); rules deleted.
- All Books button dialects in the table above - retired into the
  shared vocabulary and blocked by `tests/test-controls.js`.
- `display-toggles` and `echo-toggle` (scales.css) - Scales' display
  toggles moved into the voice-first settings block as a labeled row.

## Stepper and Key labeling

Numeric steppers carry their label INSIDE the pill shell as a
`step-label` first child (architecture.md, Grouping rule 4), so label
and control can never separate at a wrap point. A labeled segment row
does the same. `step-field-bare` (external `vf-label` + unlabeled pill)
is the retiring dialect: Staff is converted; trace/intervals/pitch-meter
already used internal labels; phrases/scales/intervals rows convert on
their next pass.
The user-facing name for the root-pitch chooser is **Key** on every
practice page (state keys may still say `root` / `rootPitch`).
Trace's **Low** and **High** controls use the same semitone pitch-stepper
surface for chart endpoints; its **Window** stepper is a discrete
viewport-width picker (2-60s), not a musical note/gap timing control.

Pitch Test / Sing launches from a fixed bottom dock (`.pitch-test-dock`),
not from the transport row. Transport is playback only
(Listen/Stop/Play/Next/Repeat).
