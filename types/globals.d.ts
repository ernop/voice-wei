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

    // YouTube API callback queue
    youtubeApiReady?: (() => void)[];
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
    SettingsStore?: any;
    MediaSessionCore?: any;
    PitchTestPanel?: any;
    ProgressStore?: any;
    HistoryList?: any;

    // Named state inspection for the test suite (phrases take plan)
    phrasesDebug?: {
        takePlan: () => PhrasePlanNote[];
        testTargets: () => TargetSpan[];
    };
}

// -----------------------------------------------------------------------
// Tone.js - Audio synthesis library (loaded from CDN)
// -----------------------------------------------------------------------

declare const Tone: typeof import('tone');

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


