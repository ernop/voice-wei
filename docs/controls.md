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
| Practice transport | `listen-button`, `play-button` (+ `.listening`), `stop-button`, `next-button`, `repeat-button` (+ `.selected`), `pitch-test-launch-button` | practice-controls.css / style.css |
| Primary submit | `submit-button-large` | style.css |
| On/off toggle | `display-toggle` chip checkbox | practice-controls.css |
| Text field | `text-input` (pages size it, never re-skin) | style.css |
| Site chrome | `footer-btn`, `settings-btn` | style.css |

Modifiers are fixed too: `.selected` for selected state (no `.active`
dialects), `.danger` for destructive, `.listening` for an active mic.

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
`listen-button`, `submit-button-large`, and `text-input` - and carries
these dialects, all defined in style.css:

| Dialect class | Job today | Resolution |
|---------------|-----------|------------|
| `quick-action-btn` | Mid-size actions (Load Favorites, History/Cache, Refresh, Load Selected, Load Songs, Stop Melody) | Retire -> `secondary-btn` |
| `clear-playlist-btn` | Destructive playlist clear | Retire -> `panel-action-btn danger` |
| `typed-command-submit-btn` | Send the typed request | Retire -> `secondary-btn` (or `submit-button-large` if it should carry primary weight) |
| `close-settings-btn` | Close the settings panel | Retire -> `panel-action-btn` (shared with Books) |
| `save-api-key-btn` | Save an API key | Retire -> `panel-action-btn` (shared with Books) |
| `api-key-action-btn` (+ `.danger`) | Show/Change/Remove key | Retire -> `panel-action-btn` (shared with Books) |
| `control-btn` / `control-btn-large` / `control-btn-small` | Central player transport (prev/play/stop/next, rewind/forward) | Keep as ONE named media-transport family (see below) |
| `transport-bar-btn` (+ `transport-bar-playpause`) | Sticky bottom transport bar | Fold into the same media-transport family |
| `big-lyrics-btn`, `lyrics-control-btn` | Lyrics launchers in the transport bar | State classes on media-transport buttons, not separate button kinds |
| `lyrics-overlay-transport-btn`, `lyrics-overlay-control-btn`, `lyrics-overlay-action-btn`, `lyrics-panel-hide-btn` | Overlay transport + view chips + hide | Three near-identical chip kinds; collapse to media-transport (transport) and `panel-action-btn` (view chips, hide) |
| `favorite-btn`, `lyrics-row-btn` | Playlist row star / per-row lyrics status chip | Row-level gameplay surface; keep, document in architecture's distinct list |

**Media transport is deliberately distinct, but it must be one family.**
architecture.md already exempts the player's media transport bar from the
practice-transport look; today that exemption is spent on three separate
families (`control-btn*`, `transport-bar-btn`, overlay transport). The
end state is a single `media-btn` family with size/context modifiers,
used by the central player, the sticky bar, and the lyrics overlay.

## Inventory - Books (ebook.css)

Books is a deliberately distinct non-music tool, but its buttons do
ordinary jobs and map cleanly when the standardization pass reaches it:

| Dialect class | Job today | Maps to |
|---------------|-----------|---------|
| `small-action-btn` (+ `.danger`, `transport-step-btn`) | Small actions everywhere | `panel-action-btn` |
| `primary-action-btn` | Primary generate/import actions | `secondary-btn` or `submit-button-large` |
| `danger-action-btn` | Destructive (cancel generation) | `panel-action-btn danger` |
| `upload-button` | Import file | `secondary-btn` |
| `speed-step-btn` | TTS speed stepper | `step-field` + `step-btn` |
| `voice-sample-btn` | Per-voice sample chips | `panel-action-btn` |
| `back-library-btn` | Back navigation | `secondary-btn` |

Books' OpenAI voice/model `<select>`s stay (dynamic lists; the declared
exception in architecture.md).

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
   style.css into `player.css`, add `player.css` (and later `ebook.css`)
   to the `PAGE_SHEETS` list in `tests/test-css-ownership.js`, and add
   every retired class from stages 1-2 to the retired-dialects list in
   `tests/test-controls.js` so they cannot reappear.
4. **Books pass.** Apply the Books mapping table above, then retire
   ebook.css's private button vocabulary the same way.

Feature unification between tabs (shared favorites/history surfaces,
transport conventions, car mode) builds on this: controls converge first
so features that move between tabs arrive already speaking the shared
control language.

## Dead classes (removed)

- `load-favorites-btn` (style.css) - markup now uses `quick-action-btn`;
  rules deleted.
- `preview-voice-btn` (ebook.css) - superseded by `voice-sample-btn`;
  rules deleted.
