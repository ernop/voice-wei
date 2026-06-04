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
}

// -----------------------------------------------------------------------
// Tone.js - Audio synthesis library (loaded from CDN)
// -----------------------------------------------------------------------

declare const Tone: typeof import('tone');

// -----------------------------------------------------------------------
// Ebook page libraries loaded from CDN
// -----------------------------------------------------------------------

interface JSZipFile {
    async(type: 'text'): Promise<string>;
    async(type: 'blob'): Promise<Blob>;
}

declare const pdfjsLib: {
    GlobalWorkerOptions: {
        workerSrc: string;
    };
    getDocument: (params: { data: ArrayBuffer }) => {
        promise: Promise<{
            numPages: number;
            getPage: (pageNumber: number) => Promise<{
                getTextContent: () => Promise<{ items: unknown[] }>;
                getViewport: (params: { scale: number }) => { width: number; height: number };
                render: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
                    promise: Promise<void>;
                };
            }>;
        }>;
    };
};

declare const JSZip: {
    loadAsync: (file: Blob) => Promise<{
        file: (path: string) => JSZipFile | null;
    }>;
};

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


