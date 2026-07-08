// @ts-check
//-----------------------------------------------------------------------
// PITCH TRACE VIEW
// Canvas renderer for sung-pitch traces: scale-degree rails, target
// bars, the yellow voice line with glitch-aware breaks, accuracy dots,
// and the playhead. Pages supply data through provider callbacks.
//
// Instrument law: the voice line and its dots derive ONLY from the sung
// history. Targets and rails are chart furniture - they set the frame
// (grid, zoom) and are drawn alongside, but no target or exercise datum
// may move, hide, or recolor the voice line.
//
// Target bars are drawn at the REAL scoring tolerance (+/- PitchScore
// OK_CENTS in pitch space), so "the trace is inside the box" and "this
// note counts as a hit" are the same statement by construction.
// Requires pitch-detect-core.js (glitch/break constants) and
// pitch-score.js (the drawn tolerance).
//-----------------------------------------------------------------------

const PitchTraceView = (function () {
    'use strict';

    const BACKGROUND = 'rgba(0, 0, 0, 0.5)';
    const RAIL_EMPHASIZED = 'rgba(134, 239, 172, 0.46)';
    const RAIL_DIMMED = 'rgba(134, 239, 172, 0.22)';
    const RAIL_LABEL_EMPHASIZED = 'rgba(216, 252, 225, 0.92)';
    const RAIL_LABEL_DIMMED = 'rgba(216, 252, 225, 0.55)';
    const TRACE_COLOR = '#facc15';
    const CENTS_GOOD = 12;
    const CENTS_OK = 30;
    const MAX_TRACE_POINTS = 1200;

    // Target band colors by scoring verdict (pending = not yet sung)
    const TARGET_COLORS = {
        pending: { fill: 'rgba(96, 165, 250, 0.3)', stroke: 'rgba(147, 197, 253, 0.9)', label: '#dbeafe' },
        good: { fill: 'rgba(74, 222, 128, 0.32)', stroke: '#4ade80', label: '#bbf7d0' },
        ok: { fill: 'rgba(250, 204, 21, 0.3)', stroke: '#facc15', label: '#fef08a' },
        missed: { fill: 'rgba(251, 113, 133, 0.22)', stroke: '#fb7185', label: '#fecdd3' }
    };

    /**
     * @typedef {{ midi: number, label: string, emphasized: boolean }} Rail
     * @typedef {{ midi: number, startMs: number, endMs: number, label: string, active: boolean, result?: 'good' | 'ok' | 'missed' | null }} Target
     *
     * @param {{
     *   canvasId: string,
     *   defaultHeightPx: number,
     *   isVisible?: () => boolean,
     *   emptyMessage?: () => string | null,
     *   rails: () => Rail[],
     *   targets: () => Target[],
     *   history: () => Array<{ time: number, midi: number, cents: number }>,
     *   clockMs: () => number,
     *   windowMs: () => number,
     *   fixedWindow: () => boolean,
     *   showPlayhead: () => boolean
     * }} options
     */
    function create(options) {
        function canvasEl() {
            return /** @type {HTMLCanvasElement | null} */ (document.getElementById(options.canvasId));
        }

        function visible() {
            return options.isVisible ? options.isVisible() : true;
        }

        function resize() {
            const canvas = canvasEl();
            if (!canvas || !visible()) return;
            const container = canvas.parentElement;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0) return;

            const dpr = window.devicePixelRatio || 1;
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

            const dpr = window.devicePixelRatio || 1;
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
            if (!rails.length) return;

            const timeWindow = options.windowMs();
            const windowStart = options.fixedWindow() ? Math.max(0, options.clockMs() - timeWindow) : 0;

            // History is time-ordered, so the visible slice of a fixed
            // window is found by scanning back from the end - no
            // per-point predicate over the whole take every frame.
            const rawHistory = options.history();
            let visibleHistory = rawHistory;
            if (options.fixedWindow()) {
                const earliest = windowStart - PitchDetectCore.TRACE_BREAK_MS;
                let startIndex = rawHistory.length;
                while (startIndex > 0 && rawHistory[startIndex - 1].time >= earliest) startIndex--;
                visibleHistory = startIndex === 0 ? rawHistory : rawHistory.slice(startIndex);
            }
            const stride = Math.max(1, Math.ceil(visibleHistory.length / MAX_TRACE_POINTS));
            const history = stride === 1 ? visibleHistory : visibleHistory.filter((_, index) => index % stride === 0);

            // The chart is an instrument for showing what was actually
            // sung: the vertical range covers the sung trace as well as
            // the rails, so an off-rails note (wrong octave, overshoot)
            // draws at its true pitch instead of pinning to a chart edge
            // or vanishing.
            let minMidi = Math.min(...rails.map(rail => rail.midi));
            let maxMidi = Math.max(...rails.map(rail => rail.midi));
            for (const point of history) {
                if (point.midi < minMidi) minMidi = point.midi;
                if (point.midi > maxMidi) maxMidi = point.midi;
            }
            const midiRange = Math.max(maxMidi - minMidi, 1);
            const left = width < 520 ? 96 : 132;
            const right = 16;
            const top = 18;
            const bottom = 28;
            const graphWidth = Math.max(width - left - right, 1);
            const graphHeight = Math.max(height - top - bottom, 1);

            /** @param {number} midi */
            const midiToY = (midi) => top + (maxMidi - midi) / midiRange * graphHeight;
            /** @param {number} ms */
            const timeToX = (ms) => left + Math.max(0, Math.min(timeWindow, ms - windowStart)) / timeWindow * graphWidth;

            ctx.font = width < 520 ? '11px system-ui' : '12px system-ui';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            rails.forEach(rail => {
                const y = midiToY(rail.midi);
                ctx.strokeStyle = rail.emphasized ? RAIL_EMPHASIZED : RAIL_DIMMED;
                ctx.lineWidth = rail.emphasized ? 1.3 : 1;
                ctx.setLineDash(rail.emphasized ? [] : [4, 6]);
                ctx.beginPath();
                ctx.moveTo(left, y);
                ctx.lineTo(width - right, y);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = rail.emphasized ? RAIL_LABEL_EMPHASIZED : RAIL_LABEL_DIMMED;
                ctx.fillText(rail.label, left - 8, y);
            });

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(left, top);
            ctx.lineTo(left, height - bottom);
            ctx.lineTo(width - right, height - bottom);
            ctx.stroke();

            // Labels have no layout engine: keep a per-row cursor so a
            // wide label ("7d") on a narrow span never collides with its
            // neighbors - it is skipped instead (the box still shows).
            ctx.font = width < 520 ? '10px system-ui' : '11px system-ui';
            ctx.textAlign = 'left';
            /** @type {Map<number, number>} label row y -> right edge of last label */
            const labelCursor = new Map();
            // The bar's height IS the hit tolerance (PitchScore.OK_CENTS)
            // mapped through the same pitch scale as the voice line, so
            // the picture cannot disagree with the verdict. Only a small
            // minimum keeps bars visible on very tall pitch ranges.
            const pxPerMidi = graphHeight / midiRange;
            const bandHalfPx = Math.max(3, (PitchScore.OK_CENTS / 100) * pxPerMidi);
            options.targets().forEach(target => {
                const y = midiToY(target.midi);
                const x1 = timeToX(target.startMs);
                const x2 = timeToX(target.endMs);
                const targetWidth = Math.max(x2 - x1, 5);
                const colors = target.active
                    ? TARGET_COLORS[target.result || 'pending'] || TARGET_COLORS.pending
                    : { fill: 'rgba(148, 163, 184, 0.15)', stroke: 'rgba(148, 163, 184, 0.38)', label: 'rgba(226, 232, 240, 0.45)' };
                ctx.fillStyle = colors.fill;
                ctx.strokeStyle = colors.stroke;
                ctx.lineWidth = target.active ? 2 : 1;
                ctx.fillRect(x1, y - bandHalfPx, targetWidth, bandHalfPx * 2);
                ctx.strokeRect(x1, y - bandHalfPx, targetWidth, bandHalfPx * 2);

                // Band the cursor by ~one text height so labels on the
                // same or neighboring rails share collision space.
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

                for (let i = 0; i < history.length; i += 3) {
                    const point = history[i];
                    const absCents = Math.abs(point.cents);
                    ctx.fillStyle = absCents < CENTS_GOOD ? '#4ade80' : absCents < CENTS_OK ? '#facc15' : '#fb7185';
                    ctx.beginPath();
                    ctx.arc(timeToX(point.time), midiToY(point.midi), 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            if (options.showPlayhead()) {
                const x = timeToX(options.clockMs());
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 5]);
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x, height - bottom);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        return { resize, draw };
    }

    return { create };
})();

window.PitchTraceView = PitchTraceView;
