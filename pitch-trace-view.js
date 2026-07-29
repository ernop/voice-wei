// @ts-check
//-----------------------------------------------------------------------
// PITCH TRACE VIEW
// Canvas renderer for sung-pitch traces: scale-degree rails, optional
// guide/target outlines, the yellow voice line, and the playhead.
// Pages supply data through provider callbacks.
//
// Instrument law: the voice line derives ONLY from the sung history.
// Targets and rails are chart furniture - they set the frame (grid,
// zoom) and are drawn alongside, but no target, score, or exercise
// datum may move, hide, or recolor the voice line.
//
// The frame is equally a stable instrument face: rails and targets
// define it, and the sung history never resizes it (one momentary low
// note used to rescale the whole chart mid-take, crushing the lanes
// and disorienting the singer). Out-of-frame singing stays recorded at
// its true pitch but is clipped off-screen. Pages whose purpose is to
// follow the voice wherever it goes (pitch-meter) opt into
// `frameFollowsVoice` instead.
//
// Target bands are bare outlines of the hit zone (+/- BAND_CENTS).
// Scoring verdicts never recolor them - judgment lives in readouts,
// not in the chart. This module does not import pitch-score.js.
//-----------------------------------------------------------------------

const PitchTraceView = (function () {
    'use strict';

    const BACKGROUND = 'rgba(0, 0, 0, 0.5)';
    const RAIL_EMPHASIZED = 'rgba(134, 239, 172, 0.46)';
    const RAIL_DIMMED = 'rgba(134, 239, 172, 0.22)';
    const RAIL_LABEL_EMPHASIZED = 'rgba(216, 252, 225, 0.92)';
    const RAIL_LABEL_DIMMED = 'rgba(216, 252, 225, 0.55)';
    // Context rails (the scale notes just beyond the core octave) get
    // their own hue - sky blue against the scale's green.
    const RAIL_CONTEXT = 'rgba(125, 211, 252, 0.4)';
    const RAIL_LABEL_CONTEXT = 'rgba(186, 230, 253, 0.75)';
    const TRACE_COLOR = '#facc15';
    const MAX_TRACE_POINTS = 1200;

    // Hit-zone half-height in cents. Matches PitchScore.OK_CENTS by
    // convention so "inside the outline" means the same thing as a hit,
    // but the view owns the constant so Trace does not load scoring.
    const BAND_CENTS = 60;

    // Auto-frame padding in semitones beyond the rails/targets span.
    // The top pad leaves room for the highest target's band and its
    // label above it; the bottom pad keeps the lowest band off the
    // time axis.
    const FRAME_PAD_BELOW = 1;
    const FRAME_PAD_ABOVE = 2;

    // Bare outline only - never green/yellow/red from a verdict.
    const TARGET_OUTLINE = {
        fill: 'rgba(96, 165, 250, 0.12)',
        stroke: 'rgba(147, 197, 253, 0.75)',
        label: 'rgba(219, 234, 254, 0.85)'
    };
    const TARGET_INACTIVE = {
        fill: 'rgba(148, 163, 184, 0.08)',
        stroke: 'rgba(148, 163, 184, 0.35)',
        label: 'rgba(226, 232, 240, 0.4)'
    };

    /**
     * Rails come in three tiers: emphasized (the core scale), context
     * (neighbor notes drawn in their own color), and dimmed (the rest).
     *
     * @typedef {{ midi: number, label: string, emphasized: boolean, context?: boolean }} Rail
     * @typedef {{ midi: number, startMs: number, endMs: number, label: string, active?: boolean }} Target
     *
     * @param {{
     *   canvasId: string,
     *   defaultHeightPx: number,
     *   railLabelsBothSides?: boolean,
     *   isVisible?: () => boolean,
     *   emptyMessage?: () => string | null,
     *   rails: () => Rail[],
     *   targets: () => Target[],
     *   history: () => Array<{ time: number, midi: number, cents: number }>,
     *   clockMs: () => number,
     *   windowMs: () => number,
     *   fixedWindow?: () => boolean,
     *   verticalBounds?: () => { minMidi: number, maxMidi: number },
     *   frameFollowsVoice?: boolean,
     *   showPlayhead: () => boolean
     * }} options
     */
    function create(options) {
        // frameFollowsVoice hysteresis: expand immediately to cover
        // sung pitch, shrink only when history is cleared. Stops the
        // chart from bouncing when a brief extreme leaves the visible
        // window. Unused in the default stable-frame mode.
        /** @type {number | null} */
        let heldMinMidi = null;
        /** @type {number | null} */
        let heldMaxMidi = null;

        function canvasEl() {
            return /** @type {HTMLCanvasElement | null} */ (document.getElementById(options.canvasId));
        }

        function visible() {
            return options.isVisible ? options.isVisible() : true;
        }

        function resetVerticalRange() {
            heldMinMidi = null;
            heldMaxMidi = null;
        }

        function resize() {
            const canvas = canvasEl();
            if (!canvas || !visible()) return;
            const container = canvas.parentElement;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0) return;

            // Cap the backing store at 2x: beyond that, raster cost
            // quadruples for detail a dark chart cannot show.
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const cssHeight = canvas.getBoundingClientRect().height || options.defaultHeightPx;
            canvas.width = Math.floor(rect.width * dpr);
            canvas.height = Math.floor(cssHeight * dpr);
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${cssHeight}px`;

            const ctx = canvas.getContext('2d');
            if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            draw();
        }

        function draw() {
            if (!visible()) return;
            const canvas = canvasEl();
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const width = canvas.width / dpr;
            const height = canvas.height / dpr;
            if (width <= 0 || height <= 0) return;

            ctx.fillStyle = BACKGROUND;
            ctx.fillRect(0, 0, width, height);

            const message = options.emptyMessage ? options.emptyMessage() : null;
            if (message) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
                ctx.font = '14px system-ui';
                ctx.textAlign = 'center';
                ctx.fillText(message, width / 2, height / 2);
                return;
            }

            const rails = options.rails();
            const fixedBounds = options.verticalBounds ? options.verticalBounds() : null;
            if (!rails.length && !fixedBounds) return;

            // Time axis width is STABLE (caller supplies a fixed window
            // size). The window always scrolls with the playhead - never
            // grow the axis with the clock (that continuously squeezes
            // the whole chart and reads as twitch).
            const timeWindow = options.windowMs();
            const clock = options.clockMs();
            const windowStart = Math.max(0, clock - timeWindow);

            // History is time-ordered, so the visible slice is found by
            // scanning back from the end - no per-point predicate over
            // the whole take every frame.
            const rawHistory = options.history();
            if (!rawHistory.length) resetVerticalRange();

            const earliest = windowStart - PitchDetectCore.TRACE_BREAK_MS;
            let startIndex = rawHistory.length;
            while (startIndex > 0 && rawHistory[startIndex - 1].time >= earliest) startIndex--;
            const visibleHistory = startIndex === 0 ? rawHistory : rawHistory.slice(startIndex);
            const stride = Math.max(1, Math.ceil(visibleHistory.length / MAX_TRACE_POINTS));
            const history = stride === 1 ? visibleHistory : visibleHistory.filter((_, index) => index % stride === 0);

            const targets = options.targets();

            let minMidi;
            let maxMidi;
            if (fixedBounds) {
                minMidi = fixedBounds.minMidi;
                maxMidi = fixedBounds.maxMidi;
            } else {
                // Frame from the chart furniture: rails AND targets (a
                // target above the rails - chords stacking a fifth over
                // the octave - must sit inside the frame, not clipped at
                // its edge). In the default stable mode the sung history
                // never resizes the frame; see the instrument law above.
                minMidi = Infinity;
                maxMidi = -Infinity;
                for (const rail of rails) {
                    if (rail.midi < minMidi) minMidi = rail.midi;
                    if (rail.midi > maxMidi) maxMidi = rail.midi;
                }
                for (const target of targets) {
                    if (target.midi < minMidi) minMidi = target.midi;
                    if (target.midi > maxMidi) maxMidi = target.midi;
                }
                if (options.frameFollowsVoice && rawHistory.length) {
                    // Expand to cover what was sung. Held min/max never
                    // shrink mid-take (avoids vertical bounce when
                    // extremes scroll out of the visible window).
                    // Because they are monotone for the take, only the
                    // visible slice needs scanning per frame - every
                    // sample is on screen the frame it arrives, so it
                    // has already been folded in. A full scan happens
                    // once, to seed an empty held range.
                    const scan = heldMinMidi === null ? rawHistory : visibleHistory;
                    for (const point of scan) {
                        if (point.midi < minMidi) minMidi = point.midi;
                        if (point.midi > maxMidi) maxMidi = point.midi;
                    }
                    if (heldMinMidi === null || minMidi < heldMinMidi) heldMinMidi = minMidi;
                    if (heldMaxMidi === null || maxMidi > heldMaxMidi) heldMaxMidi = maxMidi;
                    minMidi = /** @type {number} */ (heldMinMidi);
                    maxMidi = /** @type {number} */ (heldMaxMidi);
                } else if (!options.frameFollowsVoice) {
                    minMidi -= FRAME_PAD_BELOW;
                    maxMidi += FRAME_PAD_ABOVE;
                }
            }
            const midiRange = Math.max(maxMidi - minMidi, 1);

            // Gutters fit the actual rail labels; with labels mirrored
            // on both sides the right gutter matches the left.
            ctx.font = width < 520 ? '11px system-ui' : '12px system-ui';
            let labelWidth = 0;
            for (const rail of rails) {
                labelWidth = Math.max(labelWidth, ctx.measureText(rail.label).width);
            }
            const gutter = Math.ceil(labelWidth) + 16;
            const left = gutter;
            const right = options.railLabelsBothSides ? gutter : 16;
            const top = 18;
            const bottom = 28;
            const graphWidth = Math.max(width - left - right, 1);
            const graphHeight = Math.max(height - top - bottom, 1);

            /** @param {number} midi */
            const midiToY = (midi) => top + (maxMidi - midi) / midiRange * graphHeight;
            /** @param {number} ms */
            const timeToX = (ms) => left + Math.max(0, Math.min(timeWindow, ms - windowStart)) / timeWindow * graphWidth;

            ctx.textBaseline = 'middle';
            rails.forEach(rail => {
                const y = midiToY(rail.midi);
                const railColor = rail.context ? RAIL_CONTEXT
                    : rail.emphasized ? RAIL_EMPHASIZED : RAIL_DIMMED;
                const labelColor = rail.context ? RAIL_LABEL_CONTEXT
                    : rail.emphasized ? RAIL_LABEL_EMPHASIZED : RAIL_LABEL_DIMMED;
                ctx.strokeStyle = railColor;
                ctx.lineWidth = rail.emphasized ? 1.3 : 1;
                ctx.setLineDash(rail.emphasized || rail.context ? [] : [4, 6]);
                ctx.beginPath();
                ctx.moveTo(left, y);
                ctx.lineTo(width - right, y);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = labelColor;
                ctx.textAlign = 'right';
                ctx.fillText(rail.label, left - 8, y);
                if (options.railLabelsBothSides) {
                    ctx.textAlign = 'left';
                    ctx.fillText(rail.label, width - right + 8, y);
                }
            });

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(left, top);
            ctx.lineTo(left, height - bottom);
            ctx.lineTo(width - right, height - bottom);
            ctx.stroke();

            // Chart content is clipped to the selected frame. In a fixed
            // vertical range, out-of-range singing remains recorded but
            // cannot spill into the axis gutters.
            ctx.save();
            ctx.beginPath();
            ctx.rect(left, top, graphWidth, graphHeight);
            ctx.clip();

            // Labels have no layout engine: keep a per-row cursor so a
            // wide label on a narrow span is skipped instead of colliding.
            ctx.font = width < 520 ? '10px system-ui' : '11px system-ui';
            ctx.textAlign = 'left';
            /** @type {Map<number, number>} label row y -> right edge of last label */
            const labelCursor = new Map();
            const pxPerMidi = graphHeight / midiRange;
            const bandHalfPx = Math.max(3, (BAND_CENTS / 100) * pxPerMidi);
            targets.forEach(target => {
                if (target.endMs < windowStart || target.startMs > windowStart + timeWindow) return;
                const y = midiToY(target.midi);
                const x1 = timeToX(target.startMs);
                const x2 = timeToX(target.endMs);
                const targetWidth = Math.max(x2 - x1, 5);
                // Ignore any scoring `result` field - outlines only.
                const colors = target.active === false ? TARGET_INACTIVE : TARGET_OUTLINE;
                ctx.fillStyle = colors.fill;
                ctx.strokeStyle = colors.stroke;
                ctx.lineWidth = 1.5;
                ctx.fillRect(x1, y - bandHalfPx, targetWidth, bandHalfPx * 2);
                ctx.strokeRect(x1, y - bandHalfPx, targetWidth, bandHalfPx * 2);

                const labelY = y - bandHalfPx - 8;
                const band = Math.round(labelY / 12);
                const labelWidth = ctx.measureText(target.label).width;
                const cursor = labelCursor.get(band) ?? -Infinity;
                if (x1 + 4 >= cursor) {
                    ctx.fillStyle = colors.label;
                    ctx.fillText(target.label, x1 + 4, labelY);
                    labelCursor.set(band, x1 + 4 + labelWidth + 3);
                }
            });

            if (history.length > 1) {
                ctx.lineWidth = 2.4;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = TRACE_COLOR;
                ctx.beginPath();
                let previous = history[0];
                ctx.moveTo(timeToX(previous.time), midiToY(previous.midi));
                for (let i = 1; i < history.length; i++) {
                    const point = history[i];
                    const fastJump = point.time - previous.time <= PitchDetectCore.GLITCH_WINDOW_MS
                        && Math.abs(point.midi - previous.midi) > PitchDetectCore.GLITCH_JUMP_MIDI;
                    if (point.time - previous.time > PitchDetectCore.TRACE_BREAK_MS || fastJump) {
                        ctx.moveTo(timeToX(point.time), midiToY(point.midi));
                    } else {
                        ctx.lineTo(timeToX(point.time), midiToY(point.midi));
                    }
                    previous = point;
                }
                ctx.stroke();
            }

            if (options.showPlayhead()) {
                const x = timeToX(clock);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 5]);
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x, height - bottom);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
        }

        return { resize, draw };
    }

    return { create, BAND_CENTS };
})();

window.PitchTraceView = PitchTraceView;
