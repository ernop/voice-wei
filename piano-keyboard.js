// @ts-check
//-----------------------------------------------------------------------
// PIANO KEYBOARD
// The keyboard for one pass of a scale pattern: every key the pass plays
// (the span), plus CONTEXT_DEGREES scale notes beyond each end so the
// notes just below and above it stay in view. Where the screen has room
// for more keys at a natural size, plain piano continues on both sides
// instead of the keys stretching. buildModel() is pure and decides every
// musical fact - which keys exist, each key's degree and spelling, where
// microtonal pitches sit. create() measures its width, renders the model
// for it, and owns the sounding state; it decides nothing musical.
// Requires music-constants.js.
//
// Every pitch is drawn exactly where it is: whole MIDI notes are keys,
// fractional ones are markers between keys. Highlighting is exact - a
// sounding note lights its own key or marker, never a neighbor and never
// the same letter in another octave.
//-----------------------------------------------------------------------

const PianoKeyboard = (function () {
    'use strict';

    // Scale notes kept in view beyond each end of the played span; Trace
    // draws the same three around its octave.
    const CONTEXT_DEGREES = 3;

    // Key centers in white-key widths from the left edge of C. Black keys
    // sit in equal slots across the top of their group, as on a real
    // keyboard: C-E holds five slots over three white keys, F-B seven
    // slots over four.
    const KEY_CENTERS = [0.5, 0.9, 1.5, 2.1, 2.5, 3.5, 3 + 6 / 7, 4.5, 5, 5.5, 3 + 22 / 7, 6.5];
    const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
    const BLACK_KEY_WIDTH = 0.58;

    // Microtonal intervals are sums of decimals (2.04 + 12 is not exactly
    // 14.04), so pitch comparisons allow float noise.
    const EPSILON = 1e-6;

    // Marker labels need this much room (in white-key widths) between
    // neighbors; closer markers (quarter tones) show bare ticks.
    const MARKER_LABEL_SPACING = 0.75;

    // A black key's pitch name ("F#") fits once white keys are this many
    // CSS pixels wide; narrower boards (two octaves on a phone) show black
    // keys' degrees only, and the readout names what sounds.
    const BLACK_NAME_MIN_WHITE_PX = 24;

    // White keys this many CSS pixels wide look like a piano's; a board
    // with room for more shows more piano rather than wider keys.
    const NATURAL_WHITE_PX = 48;

    // A full piano's end keys, A0 and C8: plain piano stops there.
    const PIANO_LOWEST = 21;
    const PIANO_HIGHEST = 108;

    /** @param {number} midi */
    function isWholeNote(midi) {
        return Math.abs(midi - Math.round(midi)) < EPSILON;
    }

    /** @param {number} midi a whole MIDI note */
    function isBlack(midi) {
        return BLACK_PITCH_CLASSES.has(midiPitchClass(midi));
    }

    /**
     * Center of a whole MIDI note's key, in white-key widths from C-1.
     * @param {number} midi
     */
    function keyCenter(midi) {
        return Math.floor(midi / 12) * 7 + KEY_CENTERS[midiPitchClass(midi)];
    }

    /**
     * Where a pitch sits: its key's center, or for a fractional pitch the
     * matching share of the way between the two keys around it.
     * @param {number} midi
     */
    function pitchCenter(midi) {
        if (isWholeNote(midi)) return keyCenter(Math.round(midi));
        const below = Math.floor(midi);
        return keyCenter(below) + (midi - below) * (keyCenter(below + 1) - keyCenter(below));
    }

    /**
     * Half the drawn width at a pitch: the span bar covers a whole key at
     * either end, and ends on a marker's center line.
     * @param {number} midi
     */
    function halfWidthAt(midi) {
        if (!isWholeNote(midi)) return 0;
        return isBlack(Math.round(midi)) ? BLACK_KEY_WIDTH / 2 : 0.5;
    }

    /**
     * Sharps or flats for the notes outside the scale, following the key:
     * a flat key (Eb, or any scale spelled with flats) names its other
     * notes with flats too.
     * @param {string} root @param {number} octave @param {string} scaleType
     * @returns {'#' | 'b'}
     */
    function accidentalPreference(root, octave, scaleType) {
        if (preferredScaleRootName(root)?.includes('b')) return 'b';
        return scaleDegreeNotesInRange(root, octave, scaleType, 0, 12)
            .some(note => /^[A-G]b/.test(note.noteName)) ? 'b' : '#';
    }

    /**
     * @param {PianoKeyboardSpec} spec
     * @returns {PianoKeyboardModel}
     */
    function buildModel({ root, octave, scaleType, notes, whiteKeys = 0 }) {
        const rootMidi = noteNameToMidi(root, octave);
        if (rootMidi === null) throw new Error(`PianoKeyboard.buildModel: unknown root ${root}`);
        if (!notes.length) throw new Error('PianoKeyboard.buildModel: a keyboard spans at least one note');

        const spanLow = Math.min(...notes);
        const spanHigh = Math.max(...notes);
        const below = scaleIntervalsInRange(scaleType, spanLow - rootMidi - 24, spanLow - rootMidi - EPSILON);
        const above = scaleIntervalsInRange(scaleType, spanHigh - rootMidi + EPSILON, spanHigh - rootMidi + 24);
        const contextLow = rootMidi + below[below.length - CONTEXT_DEGREES];
        const contextHigh = rootMidi + above[CONTEXT_DEGREES - 1];

        // The labeled board (span and context) starts and ends on white
        // keys, so the context's outer notes are never half-cut black keys.
        let labeledLow = Math.floor(contextLow + EPSILON);
        if (isBlack(labeledLow)) labeledLow -= 1;
        let labeledHigh = Math.ceil(contextHigh - EPSILON);
        if (isBlack(labeledHigh)) labeledHigh += 1;

        // Plain piano fills the board out to whiteKeys, a white key at a
        // time on alternate sides so the labeled board stays centered.
        let lowMidi = labeledLow;
        let highMidi = labeledHigh;
        let whiteCount = 0;
        for (let midi = lowMidi; midi <= highMidi; midi++) if (!isBlack(midi)) whiteCount++;
        for (let up = true; whiteCount < whiteKeys && (lowMidi > PIANO_LOWEST || highMidi < PIANO_HIGHEST); up = !up) {
            if (highMidi < PIANO_HIGHEST && (up || lowMidi <= PIANO_LOWEST)) {
                highMidi += isBlack(highMidi + 1) ? 2 : 1;
            } else {
                lowMidi -= isBlack(lowMidi - 1) ? 2 : 1;
            }
            whiteCount++;
        }

        const origin = keyCenter(lowMidi) - 0.5;
        const preference = accidentalPreference(root, octave, scaleType);
        const members = scaleDegreeNotesInRange(root, octave, scaleType, labeledLow - rootMidi, labeledHigh - rootMidi);
        /** @param {number} midi */
        const memberAt = midi => members.find(note => Math.abs(note.midi - midi) < EPSILON) || null;
        /** @param {number} midi */
        const inSpan = midi => midi > spanLow - EPSILON && midi < spanHigh + EPSILON;
        /** @param {ScaleDegreeNote | null} member */
        const isTonic = member => member !== null && positiveModulo(member.interval, 12) < EPSILON;

        /** @type {PianoKeyboardKey[]} */
        const keys = [];
        for (let midi = lowMidi; midi <= highMidi; midi++) {
            const black = isBlack(midi);
            const center = keyCenter(midi) - origin;
            const width = black ? BLACK_KEY_WIDTH : 1;
            const shape = { midi, black, center, left: center - width / 2, width };
            if (midi < labeledLow || midi > labeledHigh) {
                // Plain piano: no degrees, and only C keys named, for place
                const pitch = midiToPitchStringWithPreference(midi, preference);
                keys.push({ ...shape, pitch, label: midiPitchClass(midi) === 0 ? pitch : '', degree: null, tonic: false, inSpan: false });
                continue;
            }
            const member = memberAt(midi);
            const pitch = member ? member.name : scaleMidiToPitchString(root, octave, scaleType, midi, preference);
            keys.push({
                ...shape,
                pitch,
                // C keys carry the octave so the board reads as a place
                label: midiPitchClass(midi) === 0 ? pitch : pitch.replace(/-?\d+$/, ''),
                degree: member ? member.degree : null,
                tonic: isTonic(member),
                inSpan: inSpan(midi)
            });
        }

        // Markers: every fractional pitch on the board - the scale's
        // microtonal degrees, and any off-scale microtone the pass plays.
        const fractional = [
            ...members.filter(note => !isWholeNote(note.midi)).map(note => note.midi),
            ...notes.filter(midi => !isWholeNote(midi))
        ].sort((a, b) => a - b)
            .filter((midi, index, sorted) => index === 0 || midi - sorted[index - 1] > EPSILON);
        /** @type {PianoKeyboardNote[]} */
        const markers = fractional.map(midi => {
            const member = memberAt(midi);
            return {
                midi,
                center: pitchCenter(midi) - origin,
                pitch: member ? member.name : midiToMicrotonalPitchString(midi),
                degree: member ? member.degree : null,
                tonic: false,
                inSpan: inSpan(midi)
            };
        });
        const markerLabels = markers.every((marker, index) =>
            index === 0 || marker.center - markers[index - 1].center >= MARKER_LABEL_SPACING);

        return {
            lowMidi,
            highMidi,
            whiteCount,
            spanLow,
            spanHigh,
            spanLeft: pitchCenter(spanLow) - halfWidthAt(spanLow) - origin,
            spanRight: pitchCenter(spanHigh) + halfWidthAt(spanHigh) - origin,
            keys,
            markers,
            markerLabels
        };
    }

    /**
     * The key or marker drawn for an exact pitch, or null when the model
     * does not show it.
     * @param {PianoKeyboardModel} model
     * @param {number} midi
     * @returns {PianoKeyboardNote | null}
     */
    function noteAt(model, midi) {
        const notes = isWholeNote(midi) ? model.keys : model.markers;
        return notes.find(note => Math.abs(note.midi - midi) < EPSILON) || null;
    }

    /** @param {number} midi */
    function pitchId(midi) {
        return midi.toFixed(3);
    }

    /**
     * @param {PianoKeyboardNote} note
     */
    function ariaLabel(note) {
        return note.degree === null ? note.pitch : `${note.pitch}, degree ${note.degree}`;
    }

    /**
     * @param {PianoKeyboardNote} note
     * @param {string} kind
     */
    function stateClasses(note, kind) {
        return [
            kind,
            note.degree !== null ? 'kb-member' : '',
            note.tonic ? 'kb-tonic' : '',
            note.inSpan ? '' : 'kb-context'
        ].filter(Boolean).join(' ');
    }

    /**
     * @param {PianoKeyboardConfig} config
     */
    function create(config) {
        const missing = /** @type {(keyof PianoKeyboardConfig)[]} */ (['hostId', 'onKeyPress'])
            .filter(name => !config[name]);
        if (missing.length) {
            throw new Error(`PianoKeyboard.create: missing required config: ${missing.join(', ')}`);
        }
        const host = document.getElementById(config.hostId);
        if (!host) throw new Error(`PianoKeyboard.create: no element #${config.hostId}`);

        /** @type {PianoKeyboardSpec | null} */
        let spec = null;
        let fittedWhiteKeys = 0;
        /** @type {PianoKeyboardModel | null} */
        let model = null;
        let modelSignature = '';
        /** @type {Map<string, HTMLElement>} */
        let elements = new Map();
        /** @type {number[]} */
        let sounding = [];

        host.classList.add('kb');
        host.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target.closest('[data-midi]') : null;
            if (target instanceof HTMLElement && host.contains(target)) {
                config.onKeyPress(Number(target.dataset.midi));
            }
        });

        function naturalWhiteKeys() {
            return Math.floor(host.clientWidth / NATURAL_WHITE_PX);
        }

        function fitLabels() {
            if (model) host.classList.toggle('kb-narrow', host.clientWidth / model.whiteCount < BLACK_NAME_MIN_WHITE_PX);
        }

        function refit() {
            if (spec && naturalWhiteKeys() !== fittedWhiteKeys) show(spec);
            fitLabels();
        }
        // A refit changes the board's height, and resizing the observed
        // host inside the observer's callback is a resize loop; so the
        // refit runs on the next frame.
        new ResizeObserver(() => requestAnimationFrame(refit)).observe(host);

        /**
         * @param {PianoKeyboardModel} next
         * @param {number} units
         */
        function percent(next, units) {
            return `${(units / next.whiteCount) * 100}%`;
        }

        /**
         * @param {string} className
         * @param {string} [text]
         */
        function span(className, text = '') {
            const el = document.createElement('span');
            el.className = className;
            el.textContent = text;
            return el;
        }

        /**
         * @param {PianoKeyboardModel} next
         * @param {PianoKeyboardKey} key
         */
        function keyElement(next, key) {
            const el = document.createElement('button');
            el.type = 'button';
            // The board is a pointer surface; tabbing through 30 keys would
            // stand between the transport and the settings.
            el.tabIndex = -1;
            el.className = stateClasses(key, `kb-key ${key.black ? 'kb-black' : 'kb-white'}`);
            el.dataset.midi = String(key.midi);
            el.style.left = percent(next, key.left);
            el.style.width = percent(next, key.width);
            el.setAttribute('aria-label', ariaLabel(key));
            if (key.degree !== null) el.appendChild(span('kb-degree', String(key.degree)));
            if (key.label) el.appendChild(span('kb-name', key.label));
            return el;
        }

        /**
         * @param {PianoKeyboardModel} next
         * @param {PianoKeyboardNote} marker
         */
        function markerElement(next, marker) {
            const el = document.createElement('button');
            el.type = 'button';
            el.tabIndex = -1;
            el.className = stateClasses(marker, 'kb-marker');
            el.dataset.midi = String(marker.midi);
            el.style.left = percent(next, marker.center);
            el.setAttribute('aria-label', ariaLabel(marker));
            if (marker.degree !== null) el.appendChild(span('kb-degree', String(marker.degree)));
            return el;
        }

        function applySounding() {
            elements.forEach(el => el.classList.remove('kb-sounding'));
            sounding.forEach(midi => elements.get(pitchId(midi))?.classList.add('kb-sounding'));
        }

        /**
         * Draw a model. An identical model leaves the board (and what is
         * sounding on it) untouched, so the page may show every pass freely.
         * @param {PianoKeyboardModel} next
         */
        function render(next) {
            const signature = JSON.stringify(next);
            if (signature === modelSignature) return;
            model = next;
            modelSignature = signature;

            host.style.setProperty('--kb-white-count', String(next.whiteCount));
            host.classList.toggle('kb-has-markers', next.markers.length > 0);
            host.classList.toggle('kb-marker-labels', next.markerLabels);
            fitLabels();

            const lane = document.createElement('div');
            lane.className = 'kb-lane';
            const bar = span('kb-span');
            bar.style.left = percent(next, next.spanLeft);
            bar.style.width = percent(next, next.spanRight - next.spanLeft);
            lane.appendChild(bar);
            const keys = document.createElement('div');
            keys.className = 'kb-keys';

            elements = new Map();
            for (const key of next.keys) {
                const el = keyElement(next, key);
                elements.set(pitchId(key.midi), el);
                keys.appendChild(el);
            }
            for (const marker of next.markers) {
                const el = markerElement(next, marker);
                elements.set(pitchId(marker.midi), el);
                lane.appendChild(el);
            }
            host.replaceChildren(lane, keys);
            applySounding();
        }

        /**
         * Show a pass, with as much plain piano around it as the board's
         * width holds at natural key size; a resize refits it.
         * @param {PianoKeyboardSpec} next
         */
        function show(next) {
            spec = next;
            fittedWhiteKeys = naturalWhiteKeys();
            render(buildModel({ ...next, whiteKeys: fittedWhiteKeys }));
        }

        /**
         * Light exactly these pitches (replacing the previous set).
         * @param {number[]} midis
         * @returns {number[]} the pitches the current model does not draw
         */
        function setSounding(midis) {
            sounding = midis.slice();
            applySounding();
            return sounding.filter(midi => !elements.has(pitchId(midi)));
        }

        return {
            show,
            setSounding,
            /** The model on screen. */
            get model() { return model; },
            /** The pitches lit now. */
            get sounding() { return sounding.slice(); }
        };
    }

    return { CONTEXT_DEGREES, buildModel, noteAt, create };
})();

window.PianoKeyboard = PianoKeyboard;
