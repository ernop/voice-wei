// @ts-check
//-----------------------------------------------------------------------
// STAFF VIEW
// Renders a monophonic whole-note staff from a take plan + key context.
// Requires VexFlow 3 (CDN), music-constants.js, notation-spelling.js.
//-----------------------------------------------------------------------

const StaffView = (function () {
    'use strict';

    const NOTE_WIDTH = 42;
    const STAVE_X = 12;
    const STAVE_Y = 18;
    const STAVE_HEIGHT = 120;
    const MIN_WIDTH = 220;

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
            const width = Math.max(MIN_WIDTH, STAVE_X * 2 + plan.length * NOTE_WIDTH + 80);
            const height = STAVE_HEIGHT + STAVE_Y + 24;

            surface.textContent = '';
            host.classList.remove('phrase-staff-empty');

            const renderer = new VF.Renderer(surface, VF.Renderer.Backends.SVG);
            renderer.resize(width, height);
            const context = renderer.getContext();
            context.setFont('Arial', 10);

            const stave = new VF.Stave(STAVE_X, STAVE_Y, width - STAVE_X * 2);
            stave.addClef(clef).addKeySignature(keySig);
            stave.setContext(context).draw();

            /** @type {any[]} */
            const tickables = plan.map((note, index) => {
                const staveNote = new VF.StaveNote({
                    keys: [NotationSpelling.midiToVexKey(note.midi)],
                    duration: 'w',
                    clef
                });
                const accidental = NotationSpelling.passingAccidental(
                    note.offset,
                    PatternPracticeCore.degreesPerOctave(keyContext.scaleType),
                    index,
                    plan.map(entry => entry.offset)
                );
                if (accidental) {
                    staveNote.addAccidental(0, new VF.Accidental(accidental));
                }
                if (!note.enabled) {
                    staveNote.setStyle({
                        fillStyle: 'rgba(148, 163, 184, 0.55)',
                        strokeStyle: 'rgba(148, 163, 184, 0.8)'
                    });
                }
                return staveNote;
            });

            const beats = Math.max(4, plan.length * 4);
            const voice = new VF.Voice({ num_beats: beats, beat_value: 4 });
            voice.setStrict(false);
            voice.addTickables(tickables);

            VF.Accidental.applyAccidentals([voice], keySig);
            new VF.Formatter().joinVoices([voice]).format([voice], width - STAVE_X * 2 - 40);
            voice.draw(context, stave);
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
            }
        };
    }

    return { create };
})();

window.StaffView = StaffView;
