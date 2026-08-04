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
    // Glyphs in a chunk's last beat extend past its logical tile width
    // (tick x + notehead + stem reach ~17px over). Each chunk SVG is
    // rendered this much wider so seam notes are never clipped; the
    // neighboring chunk draws the same staff geometry, so the overlap
    // is invisible.
    const RIGHT_BLEED = 48;
    const BRACE_PAD = 28;
    const DURATION_NAMES = Object.freeze({ 0.5: '8', 1: 'q', 2: 'h', 4: 'w' });
    const SHORTEST_DURATION_BEATS = Math.min(...Object.keys(DURATION_NAMES).map(Number));
    // Scale-degree tokens sit under the bass staff, clear of low ledgers.
    const DEGREE_LABEL_Y = 172;

    // The dedicated pitch band under the staff: the sung trace lives
    // here, at its own (taller) pitch scale, so singing detail is
    // readable without drawing over the notation.
    const PITCH_ZONE_TOP = SVG_HEIGHT;
    const PITCH_ZONE_HEIGHT = 108;
    const PITCH_ZONE_PAD = 10;
    const TOTAL_HEIGHT = PITCH_ZONE_TOP + PITCH_ZONE_HEIGHT;

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
        /** @type {Array<{ beat: number, beats: number, midi: number, clef: 'treble' | 'bass', x: number, y: number }>} */
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
         * Y inside the dedicated pitch band. The frame is the page's
         * working pitch range (stable for a run - singing never rescales
         * it); pitch outside the frame is clipped, like every chart.
         * @param {number} midiFloat
         */
        function zoneYForMidi(midiFloat) {
            const range = config.pitchRange();
            const span = Math.max(range.maxMidi - range.minMidi, 1);
            const inner = PITCH_ZONE_HEIGHT - PITCH_ZONE_PAD * 2;
            return PITCH_ZONE_TOP + PITCH_ZONE_PAD + (range.maxMidi - midiFloat) / span * inner;
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

        /** Canonical onset x for a beat in the full strip. */
        function onsetX(beat) {
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
                return onsetX(config.clockBeat()) - nowScreenX();
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

            // The SVG is wider than the chunk's beat span so glyphs of
            // notes near the right edge are drawn whole, never clipped
            // (they used to vanish entirely at chunk seams). The STAVES
            // keep the nominal width: the next chunk draws the seam's
            // staff lines, so nothing is double-drawn.
            const renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
            renderer.resize(chunkWidth + RIGHT_BLEED, SVG_HEIGHT);
            const context = renderer.getContext();
            const staves = [trebleY, bassY].map(y => {
                const stave = new VF.Stave(0, y, chunkWidth);
                stave.setBegBarType(VF.Barline.type.NONE);
                stave.setEndBarType(VF.Barline.type.NONE);
                stave.setContext(context).draw();
                return stave;
            });
            // A barline occupies the midpoint between the latest legal
            // onset before the boundary and the onset on the boundary.
            // Both positions therefore come from the same beat grid.
            for (let measure = 1; measure <= CHUNK_MEASURES; measure++) {
                const boundaryBeat = measure * BEATS_PER_MEASURE;
                const x = boundaryBeat * pxPerBeat + FIRST_NOTE_PAD
                    - SHORTEST_DURATION_BEATS * pxPerBeat / 2;
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
                const x = onsetX(event.startBeat) - headerWidth - startBeat * pxPerBeat;
                // TickContext.setX() does not place the notehead at that x:
                // VexFlow adds stave and glyph offsets. Measure those owned
                // offsets, then place the rendered head on the timeline.
                tickContext.setX(x);
                const renderedHeadCenter = (tickable.getNoteHeadBeginX() + tickable.getNoteHeadEndX()) / 2;
                tickContext.setX(x - (renderedHeadCenter - x));
                tickable.setContext(context).draw();
                if (event.type === 'note') {
                    if (event.degree) degreeLabels.push({ label: String(event.degree), x });
                    notePositions.push({
                        beat: event.startBeat,
                        beats: event.beats,
                        midi: /** @type {number} */ (event.midi),
                        clef,
                        x: onsetX(event.startBeat),
                        y: yForMidi(/** @type {number} */(event.midi))
                    });
                }
            });
            // The number row is the SAME shared token the Phrases degree
            // row uses (.degree-token), positioned on the beat grid so it
            // scrolls with the notes it names.
            if (config.showDegrees() && degreeLabels.length) {
                degreeLabels.forEach(({ label, x }) => {
                    const token = document.createElement('span');
                    token.className = 'degree-token staff-degree-token';
                    token.textContent = label;
                    token.style.left = `${x}px`;
                    token.style.top = `${DEGREE_LABEL_Y}px`;
                    el.appendChild(token);
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
            strip.style.width = `${onsetX(totalBeats()) + 160}px`;
            // The strip reserves the pitch band's height too, so the
            // shell (and its background) covers both bands.
            strip.style.height = `${TOTAL_HEIGHT}px`;
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
            if (overlay.width !== Math.round(width * ratio) || overlay.height !== Math.round(TOTAL_HEIGHT * ratio)) {
                overlay.width = Math.round(width * ratio);
                overlay.height = Math.round(TOTAL_HEIGHT * ratio);
                overlay.style.width = `${width}px`;
                overlay.style.height = `${TOTAL_HEIGHT}px`;
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
            context.clearRect(0, 0, width, TOTAL_HEIGHT);
            const isScroll = config.mode() === 'scroll';
            const offset = scrollOffset();
            const range = config.pitchRange();

            // The pitch band: a quiet tinted lane under the staff with
            // its own (taller) pitch scale. Reference segments mark each
            // sheet note's pitch and span; the sung trace draws against
            // them, never over the notation.
            context.fillStyle = 'rgba(15, 23, 42, 0.045)';
            context.fillRect(0, PITCH_ZONE_TOP, width, PITCH_ZONE_HEIGHT);
            context.strokeStyle = 'rgba(15, 23, 42, 0.16)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(0, PITCH_ZONE_TOP + 0.5);
            context.lineTo(width, PITCH_ZONE_TOP + 0.5);
            context.stroke();
            context.fillStyle = 'rgba(71, 85, 105, 0.75)';
            context.font = '10px system-ui';
            context.textAlign = 'left';
            context.textBaseline = 'top';
            context.fillText('sung pitch', 6, PITCH_ZONE_TOP + 4);

            // Reveal-when-done: guides and the sung line draw only for
            // phrases already finished (before the boundary beat).
            const revealBefore = config.revealBeforeBeat();

            if (config.showPitchGuides()) {
                const pxPerBeat = config.pxPerBeat();
                context.strokeStyle = 'rgba(100, 116, 139, 0.55)';
                context.lineWidth = 3;
                context.lineCap = 'round';
                for (const position of notePositions) {
                    if (revealBefore !== null && position.beat >= revealBefore) continue;
                    const x1 = position.x - offset;
                    const x2 = x1 + Math.max(position.beats * pxPerBeat - 4, 4);
                    if (x2 < headerWidth + 2 || x1 > width) continue;
                    if (position.midi < range.minMidi || position.midi > range.maxMidi) continue;
                    const y = zoneYForMidi(position.midi);
                    context.beginPath();
                    context.moveTo(Math.max(x1, headerWidth + 2), y);
                    context.lineTo(Math.min(x2, width), y);
                    context.stroke();
                }
            }

            if (isScroll) {
                const nowX = nowScreenX();
                context.strokeStyle = 'rgba(220, 38, 38, 0.85)';
                context.lineWidth = 2;
                context.beginPath();
                context.moveTo(nowX, 6);
                context.lineTo(nowX, TOTAL_HEIGHT - 6);
                context.stroke();
                context.fillStyle = 'rgba(220, 38, 38, 0.85)';
                context.beginPath();
                context.moveTo(nowX - 5, 0);
                context.lineTo(nowX + 5, 0);
                context.lineTo(nowX, 8);
                context.closePath();
                context.fill();
            }

            // The recorded line has a placement choice: 'band' (the pitch
            // band's taller scale), 'staff' (the notation's own diatonic
            // grid, right against the noteheads), or 'off' (sing without
            // watching yourself, review later). The page-mode live dot
            // below stays - it is live feedback, not the take's results.
            const sungLinePlacement = config.sungLinePlacement();
            const trace = sungLinePlacement !== 'off' ? config.trace() : [];
            if (trace.length) {
                const onStaff = sungLinePlacement === 'staff';
                const traceY = onStaff ? yForMidi : zoneYForMidi;
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
                    const x = onsetX(sample.beat) - offset;
                    const y = traceY(sample.midi);
                    // Out-of-frame pitch is clipped, never rescales the
                    // band (the frame is stable for the run). On the
                    // staff, pitch outside the notation area clips too -
                    // the line never leaks into the pitch band below.
                    const outOfLane = onStaff
                        ? (y < 4 || y > PITCH_ZONE_TOP - 4)
                        : (sample.midi < range.minMidi || sample.midi > range.maxMidi);
                    const heldBack = revealBefore !== null && sample.beat >= revealBefore;
                    if (x < headerWidth + 2 || x > width + 20 || outOfLane || heldBack) {
                        flushSegment();
                        previousBeat = null;
                        continue;
                    }
                    if (previousBeat !== null && sample.beat - previousBeat > gapBeats) flushSegment();
                    segment.push({ x, y });
                    previousBeat = sample.beat;
                }
                flushSegment();
            }

            const liveMidi = config.liveMidi();
            if (!isScroll && liveMidi !== null
                && liveMidi >= range.minMidi && liveMidi <= range.maxMidi) {
                const y = zoneYForMidi(liveMidi);
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
            zoneYForMidi,

            /** Named state inspection for the test suite. */
            geometry() {
                return {
                    headerWidth,
                    nowScreenX: nowScreenX(),
                    scrollOffset: scrollOffset(),
                    chunkCount: chunkCache.size,
                    notePositions: notePositions.slice(),
                    pitchZoneTop: PITCH_ZONE_TOP,
                    pitchZoneHeight: PITCH_ZONE_HEIGHT
                };
            }
        };
    }

    return { create };
})();

window.StaffScrollView = StaffScrollView;
