# Product Goals

The distilled view of what this system is for. `vision.md` is the raw,
unfiltered idea pool (several overlapping brainstorm dumps); `PRODUCT.md`
documents implemented behavior in detail. This file is the short list that
should stay true: when a change does not serve one of these goals, question
it.

## What this system is

Voice-first music tools for a singer who practices hands-free, often while
driving. The heart of every tool is one loop:

1. **The system produces a target** - a scale, an interval, a phrase, a note.
2. **The learner reproduces it** - sings it back or names it.
3. **The system verifies** - pitch trace, cents readout, right/wrong stats.

The overarching training goal (from the original voice notes): *high
availability of correct musical tones - hear it, match it instantly*, with
specific attention to control in the lower range (the learner tends to
overshoot around degrees 6-7-8).

## Per-tool goals

| Tab | Goal | Done well when |
|-----|------|----------------|
| Scales | Speak a practice pattern, hear it played correctly | Any reasonable spoken command produces the right notes with the right timing; settings are also clickable and persist |
| Intervals | Drill interval distances by level | Patterns generate endlessly at the chosen difficulty; hands-free Next/Stop |
| Phrases | Remember and reproduce whole melodic shapes | Generated phrases respect the bounds; reproject cleanly across keys; the embedded test verifies the singing |
| Trace | Free singing with eyes on the pitch line | Trace is accurate, glitch-free, and starts when the voice does |
| Pitch | Structured accuracy practice with scoring | Call-and-response and play-along produce honest per-note results |
| Ears | Name and sing intervals from sound alone | Adaptive weighting pushes weak intervals; lifetime stats persist |
| Music | Hands-free music listening via natural language | Claude interprets the request; playlist plays without touching the screen |
| Books | Turn ebooks into listenable audio | Conversion works on real files; output is downloadable |

## System invariants

- **Hands-free first**: voice commands, hardware media keys, large controls,
  spoken feedback where it helps driving.
- **Exact audio control**: the piano engine knows every sounding voice;
  old-settings audio never overlaps new-settings audio; stop means stop.
- **One shared library per concern**, enforced by lint guards; pages are
  thin consumers (see docs/convergence-plan.md).
- **Defined parameters**: every setting picks a change behavior from the
  fixed vocabulary in docs/parameters.md and persists per tab.
- **Runs on a phone in a car**: Chrome/Edge/Safari, HTTPS, no build step,
  no backend beyond the YouTube proxy.

## Current priorities (deduplicated from the idea pool)

1. **Deeper judgment**: per-note scoring in the shared sing panel; progress
   tracking over time; call-and-response variants on more tools.
2. **Car mode**: larger UI preset, wake word, fewer on-screen elements.
3. **Training content**: more coach-style exercises and preset packs;
   lower-range control drills specifically.
4. **Conversational player**: follow-ups like "more like that", playlist
   operations by voice, reliability when Piped/Invidious instances are down.
5. **Resilience**: PWA/offline caching, surfacing proxy health.
