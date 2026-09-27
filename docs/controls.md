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
| Numeric stepper | `step-field` (with internal `step-label`) + `step-btn` / `step-value` | practice-controls.css |
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

## Inventory - the Lyrics page (player.html, styles in player.css) - CONVERGED

The Lyrics page consumes the canonical `vf-btn` segment rows,
`panel-action-btn`, `secondary-btn`, `primary-btn`, `step-field` /
`step-btn` / `step-value`, `display-toggle`, `listen-button`,
`submit-button-large`, and `text-input`, plus two declared page surfaces:

| Class | Job | Where |
|-------|-----|-------|
| `media-btn` (+ `media-btn-track`, `media-btn-play` with `.is-playing`, `media-btn-seek`, `media-btn-star` with `.favorited`, `media-btn-lyrics` with `lyrics-available` / `lyrics-loading` / `lyrics-unavailable`, `media-btn-overlay-action`) | The one media-transport family: white text, hover changes background only | Now-playing card, Big Lyrics transport and top actions |
| `favorite-btn` (+ `.favorited`), `lyrics-row-btn`, `playlist-remove-btn` | Row-level star, lyric-state chip, remove (40px targets) | Playlist rows; the star also on Song Library rows |
| `lyrics-sync-btn`, `lyrics-offset-value` | Lyric timing correction and its live offset | Lyrics card and Big Lyrics |

Placement of the canonical controls: the Playlist card's curation row is
`primary-btn` (Load favorites, with a `+N` count), a `display-toggle`
(Favorites only), and `secondary-btn danger` (Unload unstarred, Clear); the
filter row pairs the `text-input` with the Timed only toggle; the Order row
is `panel-action-btn` (Shuffle, Artist, Year) plus the Notes toggle. The
This song card uses a labeled `segment-row` (Second line: Identity / Song
Report), a `step-field` (Every), `primary-btn` (Request Song Report), and a
`vf-btn` toggle (Report Text); Share song is a `secondary-btn`. Search is a
`primary-btn`, Ask AI a `secondary-btn`, and the Ask AI model pills a
`segment-row` inside a fold-out whose closed line names the current model.
Big Lyrics display options are labeled `segment-row`s (Width, Align,
Spacing, Backdrop) and a Size `step-field` showing the percentage. The Log
header and the key/settings actions use `panel-action-btn`.

Retired in the 2026-09-27 redo and blocked by `tests/test-controls.js`:
`control-btn`, `control-btn-large`, `control-btn-small`,
`transport-bar-btn`, `transport-bar-playpause`, `big-lyrics-btn`,
`lyrics-control-btn`, `lyrics-overlay-transport-btn`,
`lyrics-overlay-control-btn`, `lyrics-overlay-action-btn`,
`lyrics-panel-hide-btn`, `typed-command-submit-btn`, `close-settings-btn`,
`save-api-key-btn`, `api-key-action-btn`, and `song-library-fav`. The hidden
central player block and the `quick-actions` row are gone. Retired earlier
(v218): `quick-action-btn` on the player (deploys.html and wording.html still
carry the class until their own pass) and `clear-playlist-btn`.

## Inventory - Books (ebook.css) - CONVERGED

Books now loads practice-controls.css and uses the shared vocabulary;
ebook.css is in the ownership test and holds layout only. The mapping
that was executed:

| Retired dialect | Now |
|-----------------|-----|
| `small-action-btn` (+ `.danger`) | `panel-action-btn` (+ `.danger`); `transport-step-btn` survives as a layout modifier |
| `primary-action-btn`, `upload-button` | `primary-btn` |
| `danger-action-btn` | `secondary-btn danger` |
| `speed-step-btn` + `speed-control` | `step-field` + `step-btn` / `step-value` |
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

1. **Action chips - DONE on the Lyrics page (2026-09-27).** Its dialect
   buttons became `panel-action-btn` / `secondary-btn` / `primary-btn` and
   their CSS is deleted. deploys.html and wording.html still carry
   `quick-action-btn` until their own pass.
2. **One media-transport family - DONE (2026-09-27).** `media-btn` with
   size/context modifiers serves the now-playing card and Big Lyrics; the
   central player is deleted. Lyrics availability is a state class on
   `media-btn-lyrics`.
3. **Ownership and enforcement - DONE (2026-09-27).** The Lyrics page's
   styles live in `player.css`, which is in `PAGE_SHEETS`; every retired
   class is on the retired-dialects list.
4. **Books pass - DONE.** The Books mapping table above was executed:
   ebook.html loads practice-controls.css, ebook.css lost its private
   button vocabulary, ebook.css is in the ownership test, and the Books
   dialects are on the retired list with `ebook` checked as a page.

Feature unification between tabs (shared favorites/history surfaces,
transport conventions, car mode) builds on this: controls converge first
so features that move between tabs arrive already speaking the shared
control language.

## Owner display rules

Standing owner direction for every designed UI in this repo (the Lyrics page
is the first page built entirely to them; `tests/test-player-ui.js` enforces
them there):

1. **No gray text.** Neutral text is pure white (#fff) on dark backgrounds
   and pure black (#000) on light ones. No translucent or tinted-neutral
   text, gray placeholders, or opacity that dims text; hierarchy comes from
   size, weight, spacing, and placement. Semantic colors (timed green,
   star yellow, error red) are allowed only when strongly legible. Disabled
   controls read as a dashed empty outline, not dimmed text.
2. **One line per row.** A list or table row never stacks a second line of
   different information; extra data goes inline on the same line (cut off
   with an ellipsis), into a detail view, or away.
3. **Data values out-rank labels.** Numbers, durations, times, status, and
   progress are the most legible thing in their region; labels and units
   are smaller or lighter. Tabular figures where values align.
4. **Fluid widths.** Primary containers, cards, and data layouts size by
   percentage/fraction of the available width; no fixed pixel max-width
   that leaves empty side margins while content wraps.
5. **Sliders show their scale.** Visible notches with numeric labels,
   numbers at both endpoints, and the current value shown numerically (the
   Lyrics seek scale is the reference).
6. **Resizable containers reflow.** Enlarging or shrinking a resizable
   panel, modal, or canvas changes its contents in both axes.
7. **Headers out-rank their body.** A heading or label is larger and/or
   heavier than the text beneath it, never both smaller and lighter.

Buttons follow `.cursor/rules/06-ui-patterns.mdc`: white text in normal and
hover states (black on the bright green primary and Listen buttons, per
rule 1), hover changes the background only, 0.2s transitions.

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
is RETIRED: every page is converted and `tests/test-controls.js` blocks
the class from reappearing. Scales' abbreviation toggle covers in-pill
labels via `.step-label[data-abbr][data-full]`.
The user-facing name for the root-pitch chooser is **Key** on every
practice page (state keys may still say `root` / `rootPitch`).
Trace's **Low** and **High** controls use the same semitone pitch-stepper
surface for chart endpoints; its **Window** stepper is a discrete
viewport-width picker (2-60s), not a musical note/gap timing control.

Pitch Test / Sing launches from a fixed bottom dock (`.pitch-test-dock`),
not from the transport row. Transport is playback only
(Listen/Stop/Play/Next/Repeat).
