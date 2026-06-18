// @ts-check
//-----------------------------------------------------------------------
// SCALES PLAYBACK
// Sequence playback coordinator for the Scales page (token-cancelled loops).
// Requires piano-core.js.
//-----------------------------------------------------------------------

/**
 * @typedef {Object} PlaySequenceOptions
 * @property {(() => NoteTiming)} [getDuration]
 * @property {((midi: number, index: number, repeatIndex: number) => void)} [onNote]
 * @property {((message: string) => void)} [onStatus]
 * @property {((nextRepeatIndex: number) => void)} [onRepeatEnd]
 * @property {number} [repeatCount]
 * @property {number} [repeatGapMs]
 * @property {((repeatIndex: number) => number[])} [getNotesForRepeat]
 */

/**
 * @typedef {Object} SequencePlaybackStep
 * @property {number} midi
 * @property {number} sourceIndex
 * @property {boolean} isSection
 * @property {number} repeatIndex
 */

/**
 * @typedef {Object} PlayRenderedSequenceOptions
 * @property {(() => NoteTiming)} [getDuration]
 * @property {((step: SequencePlaybackStep) => void)} [onStep]
 * @property {((message: string) => void)} [onStatus]
 * @property {((nextRepeatIndex: number) => void)} [onRepeatEnd]
 * @property {number} [repeatCount]
 * @property {number} [repeatGapMs]
 * @property {((repeatIndex: number) => SequencePlaybackStep[])} getStepsForRepeat
 */

/**
 * @typedef {Object} PlayChordSequenceOptions
 * @property {number} [repeatCount]
 * @property {((message: string) => void)} [onStatus]
 * @property {number} [gapMs]
 */

class ScalesAudioCoordinator {
    constructor() {
        /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
        this.piano = null;
        /** @type {boolean} */
        this.isPlaying = false;
        /** @type {number} */
        this.playbackId = 0;
        /** @type {((note: string, index: number) => void) | null} */
        this.onNoteCallback = null;
        /** @type {((message: string) => void) | null} */
        this.onStatusCallback = null;
        /** @type {(() => void) | null} */
        this.onCompleteCallback = null;
    }

    async init() {
        this.piano = await PianoCore.createPiano();
    }

    async ensureStarted() {
        await PianoCore.ensureStarted();
    }

    /** @param {number} midi @param {ToneDuration} [duration] */
    playNote(midi, duration = '8n') {
        this.piano.playMidi(midi, duration);
    }

    /** @param {number[]} midiNotes @param {ToneDuration} [duration] */
    playChord(midiNotes, duration = '2n') {
        this.piano.playMidiChord(midiNotes, duration);
    }

    requestSequencePlayback() {
        this.stop();
        this.playbackId++;
        this.isPlaying = true;
        return this.playbackId;
    }

    /** @param {number} id */
    isPlaybackValid(id) {
        return this.isPlaying && id === this.playbackId;
    }

    /** @param {number[]} notes @param {PlaySequenceOptions} [options] */
    async playSequence(notes, options = {}) {
        const {
            getDuration,
            onNote,
            onStatus,
            onRepeatEnd,
            repeatCount = 1,
            repeatGapMs = 1500,
            getNotesForRepeat = null
        } = options;

        const playId = this.requestSequencePlayback();
        const isInfinite = repeatCount === Infinity;
        const playTimes = repeatCount === 0 ? 1 : (isInfinite ? Infinity : repeatCount);
        let r = 0;

        try {
            while (this.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                const notesForRepeat = getNotesForRepeat ? getNotesForRepeat(r) : notes;

                for (let i = 0; i < notesForRepeat.length; i++) {
                    if (!this.isPlaybackValid(playId)) break;

                    const duration = getDuration ? getDuration() : { ms: 500, tone: 0.5, gap: 0 };

                    if (onNote) onNote(notesForRepeat[i], i, r);
                    this.piano.playMidi(notesForRepeat[i], duration.tone);

                    await this.sleep(duration.ms + duration.gap);
                }

                r++;

                const hasMore = isInfinite || r < playTimes;
                if (hasMore && this.isPlaybackValid(playId)) {
                    if (onRepeatEnd) onRepeatEnd(r);

                    if (repeatGapMs > 0) {
                        if (onStatus) {
                            if (isInfinite) {
                                onStatus(`Loop ${r + 1}... (say "stop" to end)`);
                            } else {
                                onStatus(`Repeat ${r + 1} of ${playTimes}...`);
                            }
                        }
                        await this.sleep(repeatGapMs);
                    }
                }
            }
        } finally {
            if (this.playbackId === playId) {
                this.isPlaying = false;
            }
        }
    }

    /** @param {PlayRenderedSequenceOptions} options */
    async playRenderedSequence(options) {
        const {
            getDuration,
            onStep,
            onStatus,
            onRepeatEnd,
            repeatCount = 1,
            repeatGapMs = 1500,
            getStepsForRepeat
        } = options;

        const playId = this.requestSequencePlayback();
        const isInfinite = repeatCount === Infinity;
        const playTimes = repeatCount === 0 ? 1 : (isInfinite ? Infinity : repeatCount);
        let r = 0;

        try {
            while (this.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                const steps = getStepsForRepeat(r);
                for (const step of steps) {
                    if (!this.isPlaybackValid(playId)) break;
                    const duration = getDuration ? getDuration() : { ms: 500, tone: 0.5, gap: 0 };
                    if (onStep) onStep(step);
                    this.piano.playMidi(step.midi, duration.tone);
                    await this.sleep(duration.ms + duration.gap);
                }

                r++;

                const hasMore = isInfinite || r < playTimes;
                if (hasMore && this.isPlaybackValid(playId)) {
                    if (onRepeatEnd) onRepeatEnd(r);

                    if (repeatGapMs > 0) {
                        if (onStatus) {
                            if (isInfinite) {
                                onStatus(`Loop ${r + 1}... (say "stop" to end)`);
                            } else {
                                onStatus(`Repeat ${r + 1} of ${playTimes}...`);
                            }
                        }
                        await this.sleep(repeatGapMs);
                    }
                }
            }
        } finally {
            if (this.playbackId === playId) {
                this.isPlaying = false;
            }
        }
    }

    /** @param {number[]} midiNotes @param {PlayChordSequenceOptions} [options] */
    async playChordRepeated(midiNotes, options = {}) {
        const {
            repeatCount = 1,
            onStatus,
            gapMs = 2000
        } = options;

        const playId = this.requestSequencePlayback();
        const isInfinite = repeatCount === Infinity;
        let r = 0;

        try {
            while (this.isPlaybackValid(playId) && (isInfinite || r < repeatCount)) {
                this.piano.playMidiChord(midiNotes, '2n');
                r++;

                const hasMore = isInfinite || r < repeatCount;
                if (hasMore && this.isPlaybackValid(playId)) {
                    if (onStatus && isInfinite) {
                        onStatus(`Chord loop ${r + 1}... (say "stop")`);
                    }
                    await this.sleep(gapMs);
                }
            }
        } finally {
            if (this.playbackId === playId) {
                this.isPlaying = false;
            }
        }
    }

    stop() {
        this.isPlaying = false;
        this.playbackId++;
        if (this.piano) this.piano.stopAll();
    }

    /** @param {number} ms */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

window.ScalesPlayback = { AudioCoordinator: ScalesAudioCoordinator };
