// @ts-check
//-----------------------------------------------------------------------
// SCALES PLAYBACK
// Sequence playback coordinator for the Scales page (token-cancelled loops).
// Requires piano-core.js.
//-----------------------------------------------------------------------

/**
 * @typedef {Object} PlayRenderedSequenceOptions
 * @property {() => NoteTiming} getDuration
 * @property {(midi: number) => void} onNote - as each note starts
 * @property {(nextRepeatIndex: number) => void} onRepeatEnd - before the gap that precedes the next repeat
 * @property {number} repeatCount
 * @property {number} repeatGapMs
 * @property {(repeatIndex: number) => number[]} getNotesForRepeat
 */

/**
 * @typedef {Object} PlayChordSequenceOptions
 * @property {number} repeatCount
 * @property {number} gapMs - from one chord's start to the next
 * @property {ToneDuration} duration
 */

class ScalesAudioCoordinator {
    /**
     * @param {(playing: boolean) => void} onPlayingChange - as sequence
     *   playback starts and as it ends, so the page can report its transport
     */
    constructor(onPlayingChange) {
        this.onPlayingChange = onPlayingChange;
        /** @type {Awaited<ReturnType<typeof PianoCore.createPiano>> | null} */
        this.piano = null;
        this.playing = false;
        /** @type {number} */
        this.playbackId = 0;
    }

    /** Whether a sequence is playing. */
    get isPlaying() {
        return this.playing;
    }

    set isPlaying(playing) {
        if (playing === this.playing) return;
        this.playing = playing;
        this.onPlayingChange(playing);
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
        this.silence();
        this.isPlaying = true;
        return this.playbackId;
    }

    /** @param {number} id */
    isPlaybackValid(id) {
        return this.isPlaying && id === this.playbackId;
    }

    /**
     * @param {PlayRenderedSequenceOptions} options
     * @returns {Promise<boolean>} whether it ran to its end (not stopped or replaced)
     */
    async playRenderedSequence(options) {
        const { getDuration, onNote, onRepeatEnd, repeatCount, repeatGapMs, getNotesForRepeat } = options;

        const playId = this.requestSequencePlayback();
        const isInfinite = repeatCount === Infinity;
        const playTimes = repeatCount === 0 ? 1 : (isInfinite ? Infinity : repeatCount);
        let r = 0;

        try {
            while (this.isPlaybackValid(playId) && (isInfinite || r < playTimes)) {
                for (const midi of getNotesForRepeat(r)) {
                    if (!this.isPlaybackValid(playId)) break;
                    const duration = getDuration();
                    onNote(midi);
                    this.piano.playMidi(midi, duration.tone);
                    await this.sleep(duration.ms + duration.gap);
                }

                r++;

                const hasMore = isInfinite || r < playTimes;
                if (hasMore && this.isPlaybackValid(playId)) {
                    onRepeatEnd(r);
                    if (repeatGapMs > 0) await this.sleep(repeatGapMs);
                }
            }
        } finally {
            if (this.playbackId === playId) {
                this.isPlaying = false;
            }
        }
        return this.playbackId === playId;
    }

    /**
     * Strike a chord repeatedly. It returns as the last strike sounds; the
     * chord then rings for `duration`.
     * @param {number[]} midiNotes
     * @param {PlayChordSequenceOptions} options
     * @returns {Promise<boolean>} whether it ran to its end (not stopped or replaced)
     */
    async playChordRepeated(midiNotes, options) {
        const { repeatCount, gapMs, duration } = options;

        const playId = this.requestSequencePlayback();
        const isInfinite = repeatCount === Infinity;
        let r = 0;

        try {
            while (this.isPlaybackValid(playId) && (isInfinite || r < repeatCount)) {
                this.piano.playMidiChord(midiNotes, duration);
                r++;

                const hasMore = isInfinite || r < repeatCount;
                if (hasMore && this.isPlaybackValid(playId)) {
                    await this.sleep(gapMs);
                }
            }
        } finally {
            if (this.playbackId === playId) {
                this.isPlaying = false;
            }
        }
        return this.playbackId === playId;
    }

    stop() {
        this.silence();
        this.isPlaying = false;
    }

    /** Cut what is sounding and end the loop that played it. */
    silence() {
        this.playbackId++;
        if (this.piano) this.piano.stopAll();
    }

    /** @param {number} ms */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

window.ScalesPlayback = { AudioCoordinator: ScalesAudioCoordinator };
