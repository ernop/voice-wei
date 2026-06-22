/**
 * Shared musical domain types - the single vocabulary every module uses.
 *
 * These are ambient (global) so plain JSDoc in any file can reference them:
 *     @type {TargetSpan[]}
 *     @param {PitchTestPanelConfig} config
 *
 * The point is to make invalid states unrepresentable at the contract
 * level: a component that needs the key cannot be constructed without a
 * KeyContext provider, and tsc reports the missing property at the call
 * site - statically, before anything runs.
 */

/**
 * The tonal frame everything happens in. Whoever owns a musical surface
 * (test panel, trace, playback engine) must know its key as data, never
 * implicitly through closures.
 */
interface KeyContext {
    /** MIDI note number of the root (e.g. 51 = D#3) */
    rootMidi: number;
    /** Display name of the root pitch, e.g. "D#3" */
    rootLabel: string;
    /** Scale type id, e.g. "major", "harmonic_minor" */
    scaleType: string;
}

/**
 * One note the user is asked to sing: what pitch, when, for how long,
 * and whether it is currently enabled (mask state at initialization is
 * explicit, not implied).
 */
interface TargetSpan {
    /** MIDI note number of the target pitch */
    midi: number;
    /** Start of the window, ms from take start */
    startMs: number;
    /** End of the window, ms from take start */
    endMs: number;
    /** Short label drawn above the span (e.g. the scale degree) */
    label: string;
    /** Whether this target is active (sung and scored) right now */
    active: boolean;
    /** Scoring verdict, filled in by the panel once the window passes */
    result?: 'good' | 'ok' | 'missed' | null;
    /** Average absolute cents deviation (drives the verdict thresholds) */
    avgCents?: number;
    /**
     * Average SIGNED cents deviation: positive = sung sharp, negative =
     * sung flat. This is what makes "you overshoot the 6th" measurable.
     */
    biasCents?: number | null;
}

/**
 * One note's outcome inside a recorded take - the per-degree record
 * that degree-level analysis (weak spots) aggregates over.
 */
interface ProgressNoteResult {
    /** Target label as displayed (degree or note name) */
    label: string;
    /** Target MIDI note */
    midi: number;
    result: 'good' | 'ok' | 'missed';
    /** Average absolute cents deviation; null when nothing was sung close */
    avgCents: number | null;
    /** Average signed cents deviation (positive = sharp); null when unknown */
    biasCents: number | null;
}

/**
 * A duration at the piano boundary: seconds as a number, or Tone.js
 * notation as a string ('2n', '8n'). Everywhere else in the system,
 * timing is milliseconds and variable names carry the unit (noteLengthMs,
 * gapMs, durationSec).
 */
type ToneDuration = number | string;

/**
 * Scales' per-note timing triple: wall-clock step in ms, sounding
 * duration for the piano, and extra gap in ms (negative gap semantics
 * are resolved before this is built).
 */
interface NoteTiming {
    ms: number;
    tone: ToneDuration;
    gap: number;
}

/**
 * One scale degree in a concrete key. This is the standard data shape for
 * scale rails, scale previews, and scale-note displays: pages should not
 * reconstruct degree numbers or note spellings from raw pitch classes.
 */
interface ScaleDegreeNote {
    /** Semitone interval from the root, e.g. 12 = octave */
    interval: number;
    /** 1-based degree inside the scale pattern, e.g. 8 for the octave in major */
    degree: number;
    /** 0-based degree index inside the scale pattern */
    degreeIndex: number;
    /** Octave displacement of this degree occurrence relative to the root frame */
    octaveShift: number;
    /** MIDI note number */
    midi: number;
    /** Spelled pitch with octave, e.g. "Bb4" */
    name: string;
    /** Spelled pitch class, e.g. "Bb" */
    noteName: string;
    /** Scientific pitch octave */
    octave: number;
}

/**
 * One note of a generated sequence, fully zipped at construction.
 * Sequences of notes are ALWAYS lists of these objects - parallel
 * arrays over note positions are forbidden at module boundaries
 * (every consumer-side re-zip by index is a chance to misalign,
 * which is exactly how the masked-test scoring bug happened).
 */
interface SequenceNote {
    /** Scale-degree offset (0 = degree 1; half-integer = passing tone) */
    offset: number;
    /** MIDI note number in the sequence's key */
    midi: number;
    /** Display degree label (e.g. "4", "7d", "4#") */
    degree: string;
    /** Spoken label (e.g. "sharp 4") */
    spoken: string;
    /** Pitch string (e.g. "F#3") */
    noteName: string;
}

/**
 * A generated phrase (pattern-practice-core.generatePhrase) - the one
 * shape for phrase data everywhere: generation, reprojection, playback,
 * history.
 */
interface Phrase {
    notes: SequenceNote[];
    root: string;
    scaleType: string;
    octave: number;
    createdAt: string;
}

/**
 * One note of the current take, fully explicit - every consumer
 * (display, playback, test panel) reads these named fields; nothing is
 * positional or implied. Disabled notes own no time: startMs/endMs are
 * null and the enabled notes share one compressed timeline that starts
 * at 0 with the first enabled note.
 */
interface PhrasePlanNote extends SequenceNote {
    /** Position in the phrase (display order, toggle identity) */
    index: number;
    /** Whether this note is currently enabled */
    enabled: boolean;
    /** Window start on the take timeline; null when disabled */
    startMs: number | null;
    /** Window end on the take timeline; null when disabled */
    endMs: number | null;
}

/**
 * The authoritative state of one take note on the phrases page: which
 * source offset it is, and whether it is enabled. Everything else
 * (midi, labels, timing) is derived from this plus the page key/timing
 * settings, in one place.
 */
interface TakeNote {
    /** Scale-degree offset as generated (before reflection/projection) */
    offset: number;
    /** Enabled = displayed bright, played, sung, scored */
    enabled: boolean;
}

/** One horizontal reference line on a pitch trace. */
interface RailLine {
    /** MIDI note number the rail sits on */
    midi: number;
    /** Label drawn at the left edge, e.g. "1 first D#3" */
    label: string;
    /** Emphasized rails are brighter (in-octave scale degrees) */
    emphasized: boolean;
}

/**
 * Contract for PitchTestPanel.create(). Required fields are the data the
 * panel cannot function without; the panel throws at create() if any are
 * missing, and tsc flags the call site before that.
 */
interface PitchTestPanelConfig {
    /** Host element id the panel renders into */
    hostId: string;
    /** Unique id prefix for the panel's internal elements */
    idPrefix: string;
    title: string;
    subtitle: string;
    /** localStorage key for the panel's option toggles */
    storageKey: string;

    /**
     * The key being tested, as data. The panel displays it in the
     * readout and stamps progress entries with it, so the key on screen
     * is always the key of the rails, targets, and guide.
     */
    key: () => KeyContext;

    /** Reference lines for the trace, in the current key */
    rails: (panelOptions: { expandRange: boolean }) => RailLine[];

    /** The spans the user must sing, in the current key */
    targets: () => TargetSpan[];

    /** Natural length of one take in ms (sizes the time window) */
    contentDurationMs: () => number;

    /**
     * Plays one tone. The panel sequences the guide itself from the
     * active targets, so the guide is by construction the same notes,
     * key, and timing as the drawn notation - a page cannot supply a
     * guide that disagrees with the targets.
     */
    playNote: (midi: number, durationSec: number) => void;

    /** Optional cosmetic / wiring extras */
    defaultHeightPx?: number;
    legendTargetLabel?: string;
    emptyMessage?: () => string | null;
    /** Notified when the panel opens/closes (latching launch buttons) */
    onOpenChange?: (open: boolean) => void;
    /** ProgressStore tool id; takes are recorded when set */
    progressTool?: string;
}
