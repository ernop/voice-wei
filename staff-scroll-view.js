// @ts-check
//-----------------------------------------------------------------------
// STAFF SCROLL VIEW
// The Staff page's continuously scrolling grand staff: a fixed header
// (brace, clefs, key signature, meter) with a long note strip sliding
// beneath it, a now-line marking the active moment, and a sung-pitch
// trace overlay. Requires VexFlow 3 (CDN), music-constants.js,
// notation-spelling.js.
//
// Geometry: the two staves are placed so DIATONIC SPACING IS CONTINUOUS
// through the gap - from the treble's bottom line (E4) down to the
// bass's top line (A3) is exactly four staff steps. Middle C therefore
// has ONE position shared by both staves: a note never appears twice,
// and the sung trace crosses between staves without a jump.
//-----------------------------------------------------------------------

const StaffScrollView = (function () {
    'use strict';

    const BEATS_PER_MEASURE = 4;
    const CHUNK_MEASURES = 8;
    const CHUNK_BEATS = BEATS_PER_MEASURE * CHUNK_MEASURES;
    // How far outside the visible window chunks are kept alive (beats).
    const CHUNK_KEEP_BEATS = 24;
    const HALF_SPACE = 5; // VexFlow line spacing 10px / 2
    // Diatonic index of E4 (the treble staff's bottom line): octave*7 + letter.
    const DIATONIC_E4 = 4 * 7 + 2;
    // Ledger headroom above the treble staff / below the bass staff.
    const TOP_PAD = 34;
    const SVG_HEIGHT = 190;
    // Treble bottom line (E4) to bass top line (A3) = 4 diatonic steps.
    const STAVE_GAP_STEPS = 4;
    const FIRST_NOTE_PAD = 14;
    // Tick-context x names the note's left edge; the head center sits
    // about half a notehead to the right. The trace shares this so sung
    // pitch aligns with the notation.
    const NOTE_CENTER_OFFSET = 7;
    const BRACE_PAD = 28;
    const DURATION_NAMES = Object.freeze({ 0.5: '8', 1: 'q', 2: 'h', 4: 'w' });
    // Scale-degree labels sit under the bass staff, clear of low ledgers.
    const DEGREE_LABEL_Y = 184;

    /** @param {StaffScrollViewConfig} config */
    function create(config) {
        /** @type {HTMLElement | null} */
        let host = null;
        /** @type {HTMLElement | null} */
        let shell = null;
        /** @type {HTMLElement | null} */
        let viewport = null;
        /** @type {HTMLElement | null} */
        let strip = null;
        /** @type {HTMLElement | null} */
        let headerBox = null;
        /** @type {HTMLCanvasElement | null} */
        let overlay = null;

        let headerWidth = 96;
        let trebleY = 0;
        let bassY = 0;
        let trebleBottomLineY = 0;
        let headerSignature = '';
        /** @type {Map<number, { el: HTMLElement, signature: string }>} */
        const chunkCache = new Map();
        /** @type {Array<{ beat: number, midi: number, clef: 'treble' | 'bass', x: number, y: number }>} */
        let notePositions = [];
        /** @type {Array<'treble' | 'bass'>} clef per event index (rests follow the melodic line) */
        let eventClefs = [];
        let renderSignature = '';

        function ensureDom() {
            host = document.getElementById(config.hostId);
            if (!host) return false;
            if (shell && !host.contains(shell)) {
                shell = null;
            }
            if (!shell) {
                host.textContent = '';
                shell = document.createElement('div');
                shell.className = 'staff-scroll-shell';
                viewport = document.createElement('div');
                viewport.className = 'staff-scroll-viewport';
                strip = document.createElement('div');
                strip.className = 'staff-scroll-strip';
                viewport.appendChild(strip);
                headerBox = document.createElement('div');
                headerBox.className = 'staff-scroll-header';
                overlay = document.createElement('canvas');
                overlay.className = 'staff-scroll-overlay';
                shell.appendChild(viewport);
                shell.appendChild(headerBox);
                shell.appendChild(overlay);
                host.appendChild(shell);
                viewport.addEventListener('scroll', () => {
                    if (config.mode() === 'page') drawOverlay();
                });
                chunkCache.clear();
                headerSignature = '';
                renderSignature = '';
            }
            return true;
        }

        /** Continuous diatonic staff position for a spelled note. @param {number} midi */
        function diatonicIndex(midi) {
            const keyContext = config.key();
            const key = NotationSpelling.midiToVexKeyForScale(
                Math.round(midi), keyContext.rootMidi, keyContext.scaleType);
            const letter = key[0];
            const octave = Number(key.split('/')[1]);
            const steps = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 }[letter] ?? 0;
            return octave * 7 + steps;
        }

        /**
         * Y for a continuous MIDI value (cents in the fraction), on the
         * shared diatonic grid. Interpolates between the spelled
         * positions of the neighboring semitones.
         * @param {number} midiFloat
         */
        function yForMidi(midiFloat) {
            const lower = Math.floor(midiFloat);
            const frac = midiFloat - lower;
            const dLow = diatonicIndex(lower);
            const d = frac > 0 ? dLow + (diatonicIndex(lower + 1) - dLow) * frac : dLow;
            return trebleBottomLineY - (d - DIATONIC_E4) * HALF_SPACE;
        }

        /**
         * The staves are placed so getYForLine matches the shared
         * diatonic grid: treble bottom line at E4's grid position.
         * @param {any} VF
         */
        function computeStaveYs(VF) {
            const probe = new VF.Stave(0, 0, 100);
            const lineOffset = probe.getYForLine(0);
            trebleY = TOP_PAD - lineOffset;
            bassY = trebleY + 8 * HALF_SPACE + STAVE_GAP_STEPS * HALF_SPACE;
            trebleBottomLineY = TOP_PAD + 8 * HALF_SPACE;
        }

        function keySignatureName() {
            const keyContext = config.key();
            const rootName = /** @type {string} */ (midiToNoteName(keyContext.rootMidi).name);
            return NotationSpelling.vexKeySignature(rootName, keyContext.scaleType);
        }

        /** Fixed header: brace, staff-line stubs, clefs, key signature, meter. */
        function renderHeader() {
            if (!headerBox) return;
            const VF = Vex.Flow;
            computeStaveYs(VF);
            const keySig = keySignatureName();
            const signature = keySig;
            if (signature === headerSignature && headerBox.firstChild) return;
            headerSignature = signature;
            headerBox.textContent = '';

            // Probe pass: how wide the clef + key signature + meter run is.
            const probeHost = document.createElement('div');
            const probeRenderer = new VF.Renderer(probeHost, VF.Renderer.Backends.SVG);
            probeRenderer.resize(300, SVG_HEIGHT);
            const probeStave = new VF.Stave(BRACE_PAD, trebleY, 260);
            probeStave.addClef('treble').addKeySignature(keySig).addTimeSignature(`${BEATS_PER_MEASURE}/4`);
            headerWidth = Math.ceil(probeStave.getNoteStartX()) + 2;

            const renderer = new VF.Renderer(headerBox, VF.Renderer.Backends.SVG);
            renderer.resize(headerWidth, SVG_HEIGHT);
            const context = renderer.getContext();
            const staves = [
                { clef: 'treble', y: trebleY },
                { clef: 'bass', y: bassY }
            ].map(({ clef, y }) => {
                const stave = new VF.Stave(BRACE_PAD, y, headerWidth - BRACE_PAD);
                stave.setEndBarType(VF.Barline.type.NONE);
                stave.addClef(clef).addKeySignature(keySig).addTimeSignature(`${BEATS_PER_MEASURE}/4`);
                stave.setContext(context).draw();
                return stave;
            });
            new VF.StaveConnector(staves[0], staves[1])
                .setType(VF.StaveConnector.type.BRACE).setContext(context).draw();
            new VF.StaveConnector(staves[0], staves[1])
                .setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(context).draw();
        }

        /**
         * Clef per event: notes split at middle C (one staff each, never
         * both); rests sit on the staff the melodic line last used.
         * @param {StaffStreamEvent[]} events
         */
        function computeEventClefs(events) {
            /** @type {'treble' | 'bass'} */
            let current = 'treble';
            return events.map(event => {
                if (event.type === 'note' && typeof event.midi === 'number') {
                    current = NotationSpelling.clefForNote(event.midi);
                }
                return current;
            });
        }

        /** X of a beat inside the full strip (transform-independent). */
        function stripX(beat) {
            return headerWidth + FIRST_NOTE_PAD + beat * config.pxPerBeat();
        }

        function totalBeats() {
            const events = config.events();
            if (!events.length) return 0;
            const last = events[events.length - 1];
            return last.startBeat + last.beats;
        }

        function nowScreenX() {
            if (!viewport) return headerWidth;
            const width = viewport.clientWidth;
            // Never tighter than a couple of beats of look-back room.
            return headerWidth + Math.max(24, (width - headerWidth) * config.nowFraction());
        }

        /** Strip-pixels currently shifted out of view to the left. */
        function scrollOffset() {
            if (config.mode() === 'scroll') {
                return stripX(config.clockBeat()) + NOTE_CENTER_OFFSET - nowScreenX();
            }
            return viewport ? viewport.scrollLeft : 0;
        }

        /**
         * Build one chunk SVG covering beats [startBeat, startBeat + CHUNK_BEATS).
         * Staff lines + barlines + manually positioned notes and rests -
         * x comes from the beat grid so time-to-pixels is exact.
         * @param {number} chunkIndex
         * @param {StaffStreamEvent[]} events
         */
        function buildChunk(chunkIndex, events) {
            const VF = Vex.Flow;
            const pxPerBeat = config.pxPerBeat();
            const startBeat = chunkIndex * CHUNK_BEATS;
            const chunkWidth = CHUNK_BEATS * pxPerBeat;
            const keyContext = config.key();
            const keySig = keySignatureName();

            const el = document.createElement('div');
            el.className = 'staff-scroll-chunk';
            el.style.left = `${headerWidth + startBeat * pxPerBeat}px`;
            el.style.width = `${chunkWidth}px`;

            const renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
            renderer.resize(chunkWidth, SVG_HEIGHT);
            const context = renderer.getContext();
            const staves = [trebleY, bassY].map(y => {
                const stave = new VF.Stave(0, y, chunkWidth);
                stave.setBegBarType(VF.Barline.type.NONE);
                stave.setEndBarType(VF.Barline.type.NONE);
                stave.setContext(context).draw();
                return stave;
            });
            for (let measure = 1; measure <= CHUNK_MEASURES; measure++) {
                const x = measure * BEATS_PER_MEASURE * pxPerBeat - 1;
                staves.forEach(stave => stave.drawVerticalBarFixed(x, false));
            }

            const chunkEvents = [];
            events.forEach((event, index) => {
                if (event.startBeat >= startBeat && event.startBeat < startBeat + CHUNK_BEATS) {
                    chunkEvents.push({ event, clef: eventClefs[index] });
                }
            });
            if (!chunkEvents.length) return el;

            const noteEvents = events.filter(event => event.type === 'note');
            const allOffsets = noteEvents.map(event => /** @type {number} */(event.offset));
            const noteIndexByEvent = new Map(noteEvents.map((event, index) => [event, index]));

            /** @type {Array<{ tickable: any, event: StaffStreamEvent, clef: 'treble' | 'bass' }>} */
            const drawn = chunkEvents.map(({ event, clef }) => {
                const durationName = DURATION_NAMES[event.beats] || 'q';
                if (event.type === 'rest') {
                    const rest = new VF.StaveNote({
                        keys: [clef === 'bass' ? 'd/3' : 'b/4'],
                        duration: `${durationName}r`,
                        clef
                    });
                    return { tickable: rest, event, clef };
                }
                const midi = /** @type {number} */ (event.midi);
                const offset = /** @type {number} */ (event.offset);
                const noteIndex = noteIndexByEvent.get(event) ?? 0;
                const accidental = NotationSpelling.passingAccidental(
                    offset,
                    PatternPracticeCore.degreesPerOctave(keyContext.scaleType),
                    noteIndex,
                    allOffsets
                );
                const staveNote = new VF.StaveNote({
                    keys: [NotationSpelling.midiToVexKeyForScale(
                        midi, keyContext.rootMidi, keyContext.scaleType, accidental)],
                    duration: durationName,
                    clef
                });
                return { tickable: staveNote, event, clef };
            });

            // Accidental state resets at every barline, per standard
            // notation: apply per measure, jointly across the two staves
            // (the melody is one line even when it changes staff).
            for (let measure = 0; measure < CHUNK_MEASURES; measure++) {
                const measureStart = startBeat + measure * BEATS_PER_MEASURE;
                const inMeasure = drawn.filter(({ event }) =>
                    event.startBeat >= measureStart && event.startBeat < measureStart + BEATS_PER_MEASURE);
                if (!inMeasure.length) continue;
                const voices = ['treble', 'bass'].map(clef => {
                    const voice = new VF.Voice({ num_beats: BEATS_PER_MEASURE, beat_value: 4 });
                    voice.setStrict(false);
                    voice.addTickables(inMeasure.filter(item => item.clef === clef).map(item => item.tickable));
                    return voice;
                }).filter(voice => voice.getTickables().length);
                if (voices.length) VF.Accidental.applyAccidentals(voices, keySig);
            }

            /** @type {Array<{ label: string, x: number }>} */
            const degreeLabels = [];
            drawn.forEach(({ tickable, event, clef }) => {
                const stave = staves[clef === 'treble' ? 0 : 1];
                tickable.setStave(stave);
                const modifierContext = new VF.ModifierContext();
                tickable.addToModifierContext(modifierContext);
                const tickContext = new VF.TickContext();
                tickContext.addTickable(tickable);
                tickContext.preFormat();
                const x = (event.startBeat - startBeat) * pxPerBeat + FIRST_NOTE_PAD;
                tickContext.setX(x);
                tickable.setContext(context).draw();
                if (event.type === 'note') {
                    if (event.degree) degreeLabels.push({ label: String(event.degree), x });
                    notePositions.push({
                        beat: event.startBeat,
                        midi: /** @type {number} */ (event.midi),
                        clef,
                        x: stripX(event.startBeat) + NOTE_CENTER_OFFSET,
                        y: yForMidi(/** @type {number} */(event.midi))
                    });
                }
            });
            // One text pass after all glyph drawing, so note styling can
            // never bleed into (or restyle) the degree row.
            if (config.showDegrees() && degreeLabels.length) {
                context.setFont('Arial', 11);
                context.setFillStyle('#166534');
                degreeLabels.forEach(({ label, x }) => {
                    context.fillText(label, x + NOTE_CENTER_OFFSET - label.length * 3, DEGREE_LABEL_Y);
                });
            }
            return el;
        }

        /** Which chunk indexes should exist right now. */
        function neededChunkRange() {
            const beats = totalBeats();
            if (beats <= 0) return { first: 0, last: -1 };
            const lastChunk = Math.floor((beats - 0.001) / CHUNK_BEATS);
            if (config.mode() === 'page' || !viewport) {
                return { first: 0, last: lastChunk };
            }
            const pxPerBeat = config.pxPerBeat();
            const viewBeats = viewport.clientWidth / pxPerBeat;
            const first = Math.max(0, Math.floor((config.clockBeat() - CHUNK_KEEP_BEATS) / CHUNK_BEATS));
            const last = Math.min(lastChunk,
                Math.floor((config.clockBeat() + viewBeats + CHUNK_KEEP_BEATS) / CHUNK_BEATS));
            return { first, last };
        }

        function ensureChunks() {
            if (!strip) return;
            const events = config.events();
            const { first, last } = neededChunkRange();
            const baseSignature = [
                config.pxPerBeat(), config.key().rootMidi, config.key().scaleType,
                headerWidth, config.showDegrees() ? 'deg' : ''
            ].join('|');

            for (const [index, cached] of [...chunkCache.entries()]) {
                if (index < first || index > last) {
                    cached.el.remove();
                    chunkCache.delete(index);
                }
            }
            let positionsDirty = false;
            for (let index = first; index <= last; index++) {
                const count = countEventsInChunk(events, index);
                const signature = `${baseSignature}|${count}`;
                const cached = chunkCache.get(index);
                if (cached && cached.signature === signature) continue;
                if (cached) cached.el.remove();
                positionsDirty = true;
                const el = buildChunk(index, events);
                chunkCache.set(index, { el, signature });
                strip.appendChild(el);
            }
            if (positionsDirty) {
                notePositions.sort((a, b) => a.beat - b.beat);
            }
        }

        /** @param {StaffStreamEvent[]} events @param {number} chunkIndex */
        function countEventsInChunk(events, chunkIndex) {
            const startBeat = chunkIndex * CHUNK_BEATS;
            let count = 0;
            for (const event of events) {
                if (event.startBeat >= startBeat && event.startBeat < startBeat + CHUNK_BEATS) count++;
            }
            return count;
        }

        function syncStripLayout() {
            if (!strip || !viewport) return;
            const isScroll = config.mode() === 'scroll';
            viewport.classList.toggle('staff-scroll-viewport-page', !isScroll);
            strip.style.width = `${stripX(totalBeats()) + 160}px`;
            strip.style.height = `${SVG_HEIGHT}px`;
            if (isScroll) {
                viewport.scrollLeft = 0;
                strip.style.transform = `translateX(${-scrollOffset()}px)`;
            } else {
                strip.style.transform = 'none';
            }
        }

        function syncOverlaySize() {
            if (!overlay || !viewport) return;
            const width = viewport.clientWidth;
            const ratio = window.devicePixelRatio || 1;
            if (overlay.width !== Math.round(width * ratio) || overlay.height !== Math.round(SVG_HEIGHT * ratio)) {
                overlay.width = Math.round(width * ratio);
                overlay.height = Math.round(SVG_HEIGHT * ratio);
                overlay.style.width = `${width}px`;
                overlay.style.height = `${SVG_HEIGHT}px`;
            }
        }

        function drawOverlay() {
            if (!overlay || !viewport) return;
            syncOverlaySize();
            const context = overlay.getContext('2d');
            if (!context) return;
            const ratio = window.devicePixelRatio || 1;
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            const width = viewport.clientWidth;
            context.clearRect(0, 0, width, SVG_HEIGHT);
            const isScroll = config.mode() === 'scroll';
            const offset = scrollOffset();

            if (isScroll) {
                const nowX = nowScreenX();
                context.strokeStyle = 'rgba(220, 38, 38, 0.85)';
                context.lineWidth = 2;
                context.beginPath();
                context.moveTo(nowX, 6);
                context.lineTo(nowX, SVG_HEIGHT - 6);
                context.stroke();
                context.fillStyle = 'rgba(220, 38, 38, 0.85)';
                context.beginPath();
                context.moveTo(nowX - 5, 0);
                context.lineTo(nowX + 5, 0);
                context.lineTo(nowX, 8);
                context.closePath();
                context.fill();
            }

            const trace = config.trace();
            if (trace.length) {
                const gapBeats = config.traceGapBeats();
                context.strokeStyle = 'rgba(37, 99, 235, 0.9)';
                context.fillStyle = 'rgba(37, 99, 235, 0.9)';
                context.lineWidth = 2.4;
                context.lineJoin = 'round';
                context.lineCap = 'round';
                /** @type {Array<{ x: number, y: number }>} */
                let segment = [];
                const flushSegment = () => {
                    if (segment.length === 1) {
                        // A lone detection still happened; a path with one
                        // point strokes nothing, so it draws as a dot.
                        context.beginPath();
                        context.arc(segment[0].x, segment[0].y, 2.4, 0, Math.PI * 2);
                        context.fill();
                    } else if (segment.length > 1) {
                        context.beginPath();
                        context.moveTo(segment[0].x, segment[0].y);
                        for (let i = 1; i < segment.length; i++) context.lineTo(segment[i].x, segment[i].y);
                        context.stroke();
                    }
                    segment = [];
                };
                let previousBeat = null;
                for (const sample of trace) {
                    const x = stripX(sample.beat) + NOTE_CENTER_OFFSET - offset;
                    if (x < headerWidth + 2 || x > width + 20) {
                        flushSegment();
                        previousBeat = null;
                        continue;
                    }
                    if (previousBeat !== null && sample.beat - previousBeat > gapBeats) flushSegment();
                    segment.push({ x, y: yForMidi(sample.midi) });
                    previousBeat = sample.beat;
                }
                flushSegment();
            }

            const liveMidi = config.liveMidi();
            if (!isScroll && liveMidi !== null) {
                const y = yForMidi(liveMidi);
                const x = headerWidth + 16;
                context.fillStyle = 'rgba(37, 99, 235, 0.9)';
                context.beginPath();
                context.arc(x, y, 5, 0, Math.PI * 2);
                context.fill();
                context.strokeStyle = 'rgba(37, 99, 235, 0.35)';
                context.lineWidth = 1.5;
                context.beginPath();
                context.moveTo(headerWidth + 2, y);
                context.lineTo(width - 4, y);
                context.stroke();
            }
        }

        return {
            /** Full data pass: header, clef assignment, chunk sync, overlay. */
            render() {
                if (!ensureDom() || typeof Vex === 'undefined') return;
                const events = config.events();
                if (!events.length) {
                    this.clear();
                    return;
                }
                if (host) host.classList.remove('staff-scroll-empty');
                renderHeader();
                const signature = [
                    events.length, config.pxPerBeat(),
                    config.key().rootMidi, config.key().scaleType, config.mode(),
                    config.showDegrees() ? 'deg' : ''
                ].join('|');
                if (signature !== renderSignature) {
                    renderSignature = signature;
                    eventClefs = computeEventClefs(events);
                    notePositions = [];
                    chunkCache.forEach(cached => cached.el.remove());
                    chunkCache.clear();
                }
                ensureChunks();
                syncStripLayout();
                drawOverlay();
            },

            /** Per-frame pass: transform, lazily materialized chunks, overlay. */
            frame() {
                if (!shell) return;
                ensureChunks();
                syncStripLayout();
                drawOverlay();
            },

            clear() {
                if (!ensureDom()) return;
                if (strip) strip.textContent = '';
                if (headerBox) headerBox.textContent = '';
                chunkCache.clear();
                notePositions = [];
                headerSignature = '';
                renderSignature = '';
                if (overlay) {
                    const context = overlay.getContext('2d');
                    if (context) context.clearRect(0, 0, overlay.width, overlay.height);
                }
                if (host) host.classList.add('staff-scroll-empty');
            },

            resize() {
                if (!shell) return;
                syncStripLayout();
                drawOverlay();
            },

            yForMidi,

            /** Named state inspection for the test suite. */
            geometry() {
                return {
                    headerWidth,
                    nowScreenX: nowScreenX(),
                    scrollOffset: scrollOffset(),
                    chunkCount: chunkCache.size,
                    notePositions: notePositions.slice()
                };
            }
        };
    }

    return { create };
})();

window.StaffScrollView = StaffScrollView;
