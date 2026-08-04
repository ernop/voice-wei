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
    __voiceWeiStartup?: {
        budgetMs: number;
        ready: boolean;
        report: PlayerStartupReport | null;
    };

    // YouTube IFrame API ready callback (invoked by the API once loaded)
    onYouTubeIframeAPIReady?: () => void;

    // Our global instances (defined in JS files, declared here for cross-file access)
    scalesController?: import('../scales.js').ScalesController;
    musicController?: VoiceMusicController;
    pitchMeter?: import('../pitch-meter.js').PitchMeterController;
    VoiceCommandCore?: any;
    TranscriptManager?: any;
    VoiceOutput?: any;
    AudioVolume?: {
        PIANO_DB: number;
        SINE_DB: number;
        DRONE_DB: number;
        MEDIA_GAIN: number;
        MEDIA_PERCENT: number;
        SPEECH_GAIN: number;
    };
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
        normalizeScaleTypeName: (spoken: string) => string;
        NOTE_PHONETIC_MAP: Record<string, string>;
        MODIFIER_PHONETIC_MAP: Record<string, string>;
    };
    EarTraining?: {
        create: (options: any) => any;
    };
    PlaybackState?: typeof PlaybackState;
    PlayerCommands?: typeof PlayerCommands;
    PlayerPlaylist?: typeof PlayerPlaylist;
    PlayerPrebufferProbe?: typeof PlayerPrebufferProbe;
    PlayerLyrics?: typeof PlayerLyrics;
    PlayerSongReport?: typeof PlayerSongReport;
    PlayerSongLibrary?: typeof PlayerSongLibrary;
    PlayerStorage?: any;
    PlayerSongs?: typeof PlayerSongs;
    PlayerHistoryDB?: PlayerHistoryDBApi;
    PlayerHistoryUI?: typeof PlayerHistoryUI;
    PlayerLifecycle?: PlayerLifecycleApi;
    MediaSessionCore?: MediaSessionCoreApi;
    PitchTestPanel?: any;
    DiagLog?: any;
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
        staffSystemForPhrase: (rootMidi: number, midis: number[]) => 'treble' | 'bass' | 'grand';
        clefForNote: (midi: number) => 'treble' | 'bass';
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
    StaffScrollView?: {
        create: (config: StaffScrollViewConfig) => {
            render: () => void;
            frame: () => void;
            clear: () => void;
            resize: () => void;
            yForMidi: (midi: number) => number;
            geometry: () => {
                headerWidth: number;
                nowScreenX: number;
                scrollOffset: number;
                chunkCount: number;
                notePositions: Array<{ beat: number; midi: number; clef: 'treble' | 'bass'; x: number; y: number }>;
            };
        };
    };

    // Named state inspection for the test suite (staff page)
    staffDebug?: {
        events: () => StaffStreamEvent[];
        timedEvents: () => TimedSequenceEvent[];
        geometry: () => {
            headerWidth: number;
            nowScreenX: number;
            scrollOffset: number;
            chunkCount: number;
            notePositions: Array<{ beat: number; beats: number; midi: number; clef: 'treble' | 'bass'; x: number; y: number }>;
            pitchZoneTop: number;
            pitchZoneHeight: number;
        };
        yForMidi: (midi: number) => number;
        zoneYForMidi: (midi: number) => number;
        pitchRange: () => { minMidi: number; maxMidi: number };
        clockBeat: () => number;
        setClockBeat: (beat: number) => void;
        firedNoteCount: () => number;
        soundedNoteCount: () => number;
        piano: () => any;
        audioLeadMs: () => number;
        revealBeforeBeat: () => number | null;
        startRun: () => Promise<void>;
        stopRun: () => void;
        recordTraceSample: (beat: number, midi: number) => void;
        traceSamples: () => StaffTraceSample[];
        sessions: () => any[];
        loadSessionAt: (index: number) => void;
        setMode: (mode: 'page' | 'scroll') => void;
        regenerate: () => void;
        settings: () => any;
        stateText: () => string;
        statusLog: () => string[];
        singPanel: () => any;
        singRails: (expandRange: boolean) => RailLine[];
        singTargets: () => TargetSpan[];
        singTakeClockMs: () => number | null;
        applySettings: (partial: Record<string, unknown>) => void;
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
        mediaPrevious: () => void;
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
    traceDebug?: {
        patternEntries: () => Array<{ interval: number; label: string }>;
        guideTargets: () => TargetSpan[];
        rails: () => ScaleDegreeNote[];
        verticalBounds: () => { minMidi: number; maxMidi: number };
        windowMs: () => number;
    };

    normalizeNoteName?: (spoken: string | null | undefined) => string | null;
    normalizeModifier?: (spoken: string | null | undefined) => string | null;
}

interface MediaSessionTrackIdentity {
    id: string;
    title: string;
    artist: string;
    album: string;
    artwork: MediaImage[];
}

interface MediaSessionPosition {
    duration: number;
    position: number;
    playbackRate: number;
}

interface MediaSessionCoreApi {
    activate(): Promise<void>;
    ensurePlayingSession(): void;
    register(title: string, handlers: Array<[MediaSessionAction, MediaSessionActionHandler]>): void;
    setActionHandlers(handlers: Array<[MediaSessionAction, MediaSessionActionHandler]>): void;
    updateMetadata(title: string, options?: { artist?: string }): void;
    setNowPlayingTitle(title: string, options?: { artist?: string }): void;
    clearNowPlayingTitle(): void;
    setTrackIdentity(identity: MediaSessionTrackIdentity): void;
    setDisplayLine(title: string): void;
    setDisplayLines(primaryText: string, secondaryText: string): void;
    clearDisplayLine(): void;
    setSecondaryDisplayLine(text: string): void;
    clearSecondaryDisplayLine(): void;
    setPosition(state: MediaSessionPosition): void;
    clearPosition(force?: boolean): void;
    clearTrack(): void;
    setPlaybackState(state: MediaSessionPlaybackState): void;
    getPlaybackState(): MediaSessionPlaybackState | 'unavailable';
    getKeepAliveState(): 'absent' | 'playing' | 'paused' | 'disabled';
}

// -----------------------------------------------------------------------
// Tone.js - Audio synthesis library (loaded from CDN)
// -----------------------------------------------------------------------

declare const Tone: typeof import('tone');
declare const Vex: { Flow: any };

declare function normalizeNoteName(spoken: string | null | undefined): string | null;
declare function normalizeModifier(spoken: string | null | undefined): string | null;
declare function normalizeScaleTypeName(spoken: string): string;

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


