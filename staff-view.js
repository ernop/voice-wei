// @ts-check
//-----------------------------------------------------------------------
// STAFF VIEW
// Renders a monophonic pitch staff from a take plan + key context.
// Requires VexFlow 3 (CDN), music-constants.js, notation-spelling.js.
//-----------------------------------------------------------------------

const StaffView = (function () {
    'use strict';

    const NOTE_WIDTH = 21;
    const MIN_NOTE_STEP = 21;
    const STAVE_X = 8;
    const STAVE_Y = 8;
    const MIN_WIDTH = 220;
    const SVG_PAD_X = 6;
    const SVG_PAD_Y = 2;
    const LEDGER_PAD = 5;

    /**
     * @typedef {Object} StaffViewConfig
     * @property {string} hostId
     * @property {() => KeyContext} key
     * @property {() => PhrasePlanNote[]} notes
     */

    /** @param {StaffViewConfig} config */
    function create(config) {
        /** @type {HTMLElement | null} */
        let host = null;
        /** @type {HTMLElement | null} */
        let scroll = null;
        /** @type {HTMLElement | null} */
        let surface = null;

        function ensureDom() {
            host = document.getElementById(config.hostId);
            if (!host) return false;
            if (scroll && !host.contains(scroll)) {
                scroll = null;
                surface = null;
            }
            if (!scroll) {
                host.textContent = '';
                scroll = document.createElement('div');
                scroll.className = 'phrase-staff-scroll';
                surface = document.createElement('div');
                surface.className = 'phrase-staff-surface';
                scroll.appendChild(surface);
                host.appendChild(scroll);
            }
            return true;
        }

        function clearSurface() {
            if (surface) surface.textContent = '';
            if (host) host.classList.toggle('phrase-staff-empty', true);
        }

        /** @param {PhrasePlanNote[]} plan @param {KeyContext} keyContext */
        function render(plan, keyContext) {
            if (!surface || !scroll || !host) return;
            if (!plan.length || typeof Vex === 'undefined') {
                clearSurface();
                return;
            }

            const VF = Vex.Flow;
            const midis = plan.map(note => note.midi);
            const clef = NotationSpelling.clefForPhrase(keyContext.rootMidi, midis);
            const rootName = /** @type {string} */ (midiToNoteName(keyContext.rootMidi).name);
            const keySig = NotationSpelling.vexKeySignature(rootName, keyContext.scaleType);
            // The staff is metered 4/4 (one quarter per phrase note) and
            // always spans whole measures: the final measure is completed
            // with quarter rests after the last phrase note.
            const totalBeats = Math.max(4, Math.ceil(plan.length / 4) * 4);
            const height = 72;

            /** @type {any[]} */
            const noteTickables = buildNoteTickables(plan, keyContext, clef);
            const restKey = clef === 'bass' ? 'd/3' : 'b/4';
            const rests = [];
            for (let beat = plan.length; beat < totalBeats; beat++) {
                rests.push(new VF.StaveNote({ keys: [restKey], duration: 'qr', clef }));
            }
            const tickables = noteTickables.concat(rests);

            const voice = new VF.Voice({ num_beats: totalBeats, beat_value: 4 });
            voice.setStrict(false);
            voice.addTickables(tickables);
            VF.Accidental.applyAccidentals([voice], keySig);

            // Width comes from the content: accidental-heavy phrases (a
            // chromatic typed series, passing tones) need real glyph room,
            // which a fixed per-beat width cannot know. The formatter's
            // minimum already includes the accidental modifiers.
            const formatter = new VF.Formatter().joinVoices([voice]);
            const minNotesWidth = Math.ceil(formatter.preCalculateMinTotalWidth([voice]) * 1.2);
            const notesWidth = Math.max(totalBeats * NOTE_WIDTH, minNotesWidth);
            const width = Math.max(MIN_WIDTH, STAVE_X * 2 + notesWidth + 110);

            surface.textContent = '';
            host.classList.remove('phrase-staff-empty');

            const renderer = new VF.Renderer(surface, VF.Renderer.Backends.SVG);
            renderer.resize(width, height);
            const context = renderer.getContext();
            context.setFont('Arial', 10);

            const stave = new VF.Stave(STAVE_X, STAVE_Y, width - STAVE_X * 2);
            stave.addClef(clef).addKeySignature(keySig).addTimeSignature('4/4');
            stave.setContext(context).draw();

            formatter.format([voice], width - STAVE_X * 2 - 70);
            voice.draw(context, stave);
            drawMeasureBars(stave, tickables);
            trimSvgSurface(surface, stave, noteTickables, tickables, SVG_PAD_X, SVG_PAD_Y);
        }

        /**
         * @param {PhrasePlanNote[]} plan
         * @param {KeyContext} keyContext
         * @param {'treble' | 'bass'} clef
         * @returns {any[]}
         */
        function buildNoteTickables(plan, keyContext, clef) {
            const VF = Vex.Flow;
            return plan.map((note, index) => {
                const accidental = NotationSpelling.passingAccidental(
                    note.offset,
                    PatternPracticeCore.degreesPerOctave(keyContext.scaleType),
                    index,
                    plan.map(entry => entry.offset)
                );
                const staveNote = new VF.StaveNote({
                    keys: [NotationSpelling.midiToVexKeyForScale(
                        note.midi,
                        keyContext.rootMidi,
                        keyContext.scaleType,
                        accidental
                    )],
                    duration: 'q',
                    clef,
                    stem_direction: VF.Stem.UP
                });
                staveNote.setStemDirection(VF.Stem.UP);
                if (!note.enabled) {
                    staveNote.setStyle({
                        fillStyle: 'rgba(148, 163, 184, 0.55)',
                        strokeStyle: 'rgba(148, 163, 184, 0.8)'
                    });
                }
                return staveNote;
            });
        }

        /**
         * Barlines every four quarters, drawn as plain verticals midway
         * between the flanking beats. Drawing them directly (instead of
         * inserting VF.BarNote tickables) keeps note spacing uniform, so
         * the degree-number grid above the staff stays aligned.
         * @param {any} stave
         * @param {any[]} tickables
         */
        function drawMeasureBars(stave, tickables) {
            for (let beat = 4; beat < tickables.length; beat += 4) {
                const left = tickables[beat - 1].getBoundingBox();
                const right = tickables[beat].getBoundingBox();
                if (!left || !right) continue;
                stave.drawVerticalBarFixed((left.getX() + left.getW() + right.getX()) / 2);
            }
        }

        /**
         * Crop to stave lines plus note ink. svg.getBBox() includes VexFlow
         * voice layout padding even when no notes reach those extremes.
         * Only real phrase notes feed the degree-number grid; padding rests
         * count toward the crop box but own no number column.
         * @param {HTMLElement} root
         * @param {any} stave
         * @param {any[]} noteTickables
         * @param {any[]} allTickables
         * @param {number} padX
         * @param {number} padY
         */
        function trimSvgSurface(root, stave, noteTickables, allTickables, padX, padY) {
            const svg = root.querySelector('svg');
            if (!(svg instanceof SVGSVGElement)) return;

            let xMin = stave.getX();
            let xMax = stave.getX() + stave.getWidth();
            const staffTop = stave.getYForLine(0);
            const staffBottom = stave.getYForLine(4);
            let yMin = staffTop - LEDGER_PAD;
            let yMax = staffBottom + LEDGER_PAD;
            /** @type {number[]} */
            const noteCenters = [];

            for (const tickable of allTickables) {
                if (typeof tickable.getBoundingBox !== 'function') continue;
                const box = tickable.getBoundingBox();
                if (!box) continue;
                xMin = Math.min(xMin, box.getX());
                xMax = Math.max(xMax, box.getX() + box.getW());
                if (noteTickables.includes(tickable)) {
                    noteCenters.push(box.getX() + box.getW() / 2);
                }
                const top = box.getY();
                const bottom = box.getY() + box.getH();
                if (top < staffTop) yMin = Math.min(yMin, top - padY);
                if (bottom > staffBottom) yMax = Math.max(yMax, bottom + padY);
            }

            // Clef/key sit slightly left of the first staff line x.
            xMin -= LEDGER_PAD;
            xMax += padX;

            const w = xMax - xMin;
            const h = yMax - yMin;
            if (w <= 0 || h <= 0) return;

            svg.setAttribute('viewBox', `${xMin} ${yMin} ${w} ${h}`);
            svg.setAttribute('width', String(Math.ceil(w)));
            svg.setAttribute('height', String(Math.ceil(h)));
            svg.style.width = `${Math.ceil(w)}px`;
            svg.style.height = `${Math.ceil(h)}px`;
            syncDegreeGridToStaff(root, noteCenters, xMin);
        }

        /**
         * The phrase numbers live outside the SVG, so copy VexFlow's actual
         * notehead centers into CSS variables on the shared stage.
         * @param {HTMLElement} root
         * @param {number[]} noteCenters
         * @param {number} xMin
         */
        function syncDegreeGridToStaff(root, noteCenters, xMin) {
            const stage = root.closest('.phrase-stage');
            if (!(stage instanceof HTMLElement) || !noteCenters.length) return;
            const displayedCenters = noteCenters.map(center => center - xMin);
            const steps = displayedCenters.slice(1).map((center, index) => center - displayedCenters[index]);
            const averageStep = steps.length
                ? steps.reduce((sum, step) => sum + step, 0) / steps.length
                : NOTE_WIDTH;
            const cellWidth = Math.max(MIN_NOTE_STEP, Math.min(70, averageStep || NOTE_WIDTH));
            const pad = Math.max(0, displayedCenters[0] - cellWidth / 2);
            stage.style.setProperty('--phrase-staff-note-step', `${cellWidth}px`);
            stage.style.setProperty('--phrase-staff-grid-pad', `${pad}px`);
        }

        return {
            draw() {
                if (!ensureDom()) return;
                const plan = config.notes();
                const keyContext = config.key();
                if (!plan.length) {
                    clearSurface();
                    return;
                }
                render(plan, keyContext);
            },
            clear() {
                if (!ensureDom()) return;
                clearSurface();
            }
        };
    }

    return { create };
})();

window.StaffView = StaffView;
