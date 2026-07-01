/**
 * Global type declarations for voice-music-control project.
 * Only declare things that aren't defined in our JS files.
 */

// -----------------------------------------------------------------------
// Web Speech API extensions (not fully typed in lib.dom.d.ts)
// -----------------------------------------------------------------------

interface Window {
    // SpeechRecognition is prefixed in some browsers
    webkitSpeechRecognition: typeof SpeechRecognition;
    SpeechRecognition: typeof SpeechRecognition;

    // Legacy AudioContext prefix
    webkitAudioContext: typeof AudioContext;

    // Early frontend error monitor
    __voiceWeiErrors?: Array<{ type: string; message: string; source?: string }>;

    // YouTube IFrame API ready callback (invoked by the API once loaded)
    onYouTubeIframeAPIReady?: () => void;

    // Our global instances (defined in JS files, declared here for cross-file access)
    scalesController?: import('../scales.js').ScalesController;
    pitchMeter?: import('../pitch-meter.js').PitchMeterController;
    VoiceCommandCore?: any;
    TranscriptManager?: any;
    VoiceOutput?: any;
    PatternPracticeCore?: any;
    PianoCore?: any;
    PitchDetectCore?: any;
    PitchTraceView?: any;
    PracticeControls?: any;
    RateGate?: typeof RateGate;
    ValueDiff?: typeof ValueDiff;
    PitchScore?: typeof PitchScore;
    SettingsStore?: any;
    StorageKeys?: any;
    LegacyStorageKeys?: any;
    ApiKeysStore?: any;
    PlayerApiKeys?: any;
    AppVersion?: { current: string };
    PracticeAudio?: any;
    ScalesPlayback?: { AudioCoordinator: new () => any };
    ScalesVoiceMaps?: {
        normalizeScaleNoteName: (spoken: string | null | undefined) => string | null;
        normalizeScaleModifier: (spoken: string | null | undefined) => string | null;
        NOTE_PHONETIC_MAP: Record<string, string>;
        MODIFIER_PHONETIC_MAP: Record<string, string>;
    };
    EarTraining?: {
        create: (options: any) => any;
    };
    PlaybackState?: typeof PlaybackState;
    PlayerCommands?: typeof PlayerCommands;
    PlayerPlaylist?: typeof PlayerPlaylist;
    PlayerLyrics?: typeof PlayerLyrics;
    PlayerSongLibrary?: typeof PlayerSongLibrary;
    PlayerStorage?: any;
    PlayerHistoryDB?: PlayerHistoryDBApi;
    PlayerHistoryUI?: typeof PlayerHistoryUI;
    MediaSessionCore?: any;
    PitchTestPanel?: any;
    ProgressStore?: any;
    HistoryList?: any;
    NotationSpelling?: {
        vexKeySignature: (root: string, scaleType: string) => string;
        midiToVexKey: (midi: number, accidentalPreference?: '#' | 'b' | null) => string;
        midiToVexKeyForScale: (
            midi: number,
            rootMidi: number,
            scaleType: string,
            accidentalPreference?: '#' | 'b' | null
        ) => string;
        clefForPhrase: (rootMidi: number, midis: number[]) => 'treble' | 'bass';
        passingAccidental: (
            offset: number,
            dp: number,
            index: number,
            offsets: number[]
        ) => '#' | 'b' | null;
    };
    StaffView?: {
        create: (config: {
            hostId: string;
            key: () => KeyContext;
            notes: () => PhrasePlanNote[];
        }) => { draw: () => void; clear: () => void };
    };

    // Named state inspection for the test suite (phrases take plan)
    phrasesDebug?: {
        takePlan: () => PhrasePlanNote[];
        tonePlaybackPlan: () => SequenceNote[];
        testTargets: () => TargetSpan[];
        breakdownPasses: () => number[][];
        breakdownPassIndex: () => number;
        mediaPlay: () => void;
        mediaNext: () => void;
        settings: () => {
            breakdownEnabled: boolean;
            autoStep: boolean;
            playOnStep: boolean;
            playOnNext: boolean;
            loopCurrent: boolean;
            hearTones: boolean;
            hearSpeech: boolean;
            singNumbers: boolean;
            showNumbers: boolean;
            showNoteNames: boolean;
            showPlayRow: boolean;
            showStaff: boolean;
            lessonLockedKeys: string[];
        };
        panel: any;
    };
    intervalsDebug?: { panel: any };

    normalizeNoteName?: (spoken: string | null | undefined) => string | null;
    normalizeModifier?: (spoken: string | null | undefined) => string | null;
}

// -----------------------------------------------------------------------
// Tone.js - Audio synthesis library (loaded from CDN)
// -----------------------------------------------------------------------

declare const Tone: typeof import('tone');
declare const Vex: { Flow: any };

declare function normalizeNoteName(spoken: string | null | undefined): string | null;
declare function normalizeModifier(spoken: string | null | undefined): string | null;

// -----------------------------------------------------------------------
// Ebook page CDN libraries (pdf.js, JSZip)
// -----------------------------------------------------------------------

declare const pdfjsLib: any;
declare const JSZip: any;

// -----------------------------------------------------------------------
// YouTube IFrame API - YT namespace is declared by @types/youtube
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// SpeechRecognition event types (enhanced from lib.dom.d.ts)
// -----------------------------------------------------------------------

interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
}


