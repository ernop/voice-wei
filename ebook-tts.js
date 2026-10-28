// @ts-check
// Books narration: the OpenAI text-to-speech models, voices, accents and
// styles, the saved Books settings that choose among them, and the speech
// request that turns one audio part into an MP3.

const OPENAI_TTS_MODELS = [
    {
        id: 'gpt-4o-mini-tts',
        label: 'GPT-4o mini TTS - Current',
        price: '$0.60 / 1M text input tokens + $12 / 1M audio output tokens (~$0.015/min)',
        supportsInstructions: true
    },
    {
        id: 'gpt-4o-mini-tts-2025-12-15',
        label: 'GPT-4o mini TTS 2025-12-15 - Pinned',
        price: '$0.60 / 1M text input tokens + $12 / 1M audio output tokens (~$0.015/min)',
        supportsInstructions: true
    },
    {
        id: 'tts-1',
        label: 'TTS-1 - Legacy fast',
        price: '$15 / 1M characters ($0.015 / 1K characters)',
        supportsInstructions: false
    },
    {
        id: 'tts-1-hd',
        label: 'TTS-1-HD - Legacy high quality',
        price: '$30 / 1M characters ($0.030 / 1K characters)',
        supportsInstructions: false
    }
];

const OPENAI_TTS_VOICES = [
    { id: 'alloy', label: 'Alloy', description: 'Neutral and balanced, good for most content.', legacy: true },
    { id: 'ash', label: 'Ash', description: 'Clear, calm, and grounded.', legacy: true },
    { id: 'ballad', label: 'Ballad', description: 'Expressive and narrative, suited to long-form reading.', legacy: false },
    { id: 'cedar', label: 'Cedar', description: 'Warm and steady for extended listening.', legacy: false },
    { id: 'coral', label: 'Coral', description: 'Bright and conversational.', legacy: true },
    { id: 'echo', label: 'Echo', description: 'Male voice, clear and articulate. Good for non-fiction.', legacy: true },
    { id: 'fable', label: 'Fable', description: 'British accent, warm and expressive. Great for fiction.', legacy: true },
    { id: 'marin', label: 'Marin', description: 'Natural and relaxed for audiobook narration.', legacy: false },
    { id: 'nova', label: 'Nova', description: 'Female voice, warm and conversational. Good for stories.', legacy: true },
    { id: 'onyx', label: 'Onyx', description: 'Deep male voice, authoritative. Good for dramatic content.', legacy: true },
    { id: 'sage', label: 'Sage', description: 'Measured and thoughtful.', legacy: true },
    { id: 'shimmer', label: 'Shimmer', description: 'Soft female voice, gentle and calm. Good for relaxing content.', legacy: true },
    { id: 'verse', label: 'Verse', description: 'Lyrical and expressive.', legacy: false }
];

const OPENAI_TTS_ACCENTS = [
    { id: 'default', label: 'Default', instruction: '' },
    { id: 'american', label: 'American English', instruction: 'Use a natural American English accent.' },
    { id: 'british', label: 'British English', instruction: 'Use a natural British English accent.' },
    { id: 'australian', label: 'Australian English', instruction: 'Use a natural Australian English accent.' },
    { id: 'irish', label: 'Irish English', instruction: 'Use a natural Irish English accent.' },
    { id: 'scottish', label: 'Scottish English', instruction: 'Use a natural Scottish English accent.' },
    { id: 'indian', label: 'Indian English', instruction: 'Use a natural Indian English accent.' },
    { id: 'new-york', label: 'New York English', instruction: 'Use a light New York English accent.' },
    { id: 'southern-us', label: 'Southern US English', instruction: 'Use a light Southern US English accent.' }
];

const OPENAI_TTS_STYLES = [
    { id: 'audiobook', label: 'Audiobook narrator', instruction: 'Read like an attentive audiobook narrator with clear pacing.' },
    { id: 'neutral', label: 'Neutral', instruction: 'Read in a neutral, natural style.' },
    { id: 'dramatic', label: 'Dramatic suspense', instruction: 'Read with dramatic suspense, careful pauses, and rising tension.' },
    { id: 'warm', label: 'Warm storyteller', instruction: 'Read warmly, like a close storyteller.' },
    { id: 'documentary', label: 'Documentary', instruction: 'Read with a calm documentary narration style.' },
    { id: 'bedtime', label: 'Calm bedtime', instruction: 'Read softly and calmly, suitable for relaxed listening.' },
    { id: 'whisper', label: 'Whisper', instruction: 'Read in a quiet whisper while remaining intelligible.' }
];

const VOICE_DESCRIPTIONS = Object.fromEntries(OPENAI_TTS_VOICES.map(voice => [voice.id, voice.description]));

const VOICE_SAMPLE_TEXT = 'it was a dark and stormy night. The datacenter was centrally located in the data plains of Torrenthia, humming along as usual, blotting out the sound of scraping from beneath.';

/**
 * @typedef {Object} BooksSettings
 * @property {string} voice
 * @property {string} model
 * @property {number} speed
 * @property {string} accent
 * @property {string} style
 * @property {string} instructions
 * @property {boolean} speakAiAnswers
 */

// The one list of saved Books settings: loading and saving take their keys
// from it, so a retired setting leaves storage at the next save.
/** @type {Readonly<BooksSettings>} */
const BOOKS_SETTINGS_DEFAULTS = Object.freeze({
    voice: 'alloy',
    model: 'gpt-4o-mini-tts',
    speed: 1,
    accent: 'default',
    style: 'audiobook',
    instructions: '',
    speakAiAnswers: false
});
const BOOKS_SETTINGS_KEYS = Object.keys(BOOKS_SETTINGS_DEFAULTS);

const BooksTts = (function () {
    'use strict';

    /** @param {string} model */
    function voicesForModel(model) {
        if (model.startsWith('gpt-4o-mini-tts')) return OPENAI_TTS_VOICES;
        return OPENAI_TTS_VOICES.filter(voice => voice.legacy);
    }

    /** @param {string} modelId */
    function modelFor(modelId) {
        return OPENAI_TTS_MODELS.find(item => item.id === modelId) || OPENAI_TTS_MODELS[0];
    }

    /** @param {string} modelId */
    function supportsInstructions(modelId) {
        return OPENAI_TTS_MODELS.find(item => item.id === modelId)?.supportsInstructions || false;
    }

    /**
     * Saved settings with every value one the controls offer.
     * @param {BooksSettings} settings
     * @returns {BooksSettings}
     */
    function normalizeSettings(settings) {
        const defaults = BOOKS_SETTINGS_DEFAULTS;
        const model = OPENAI_TTS_MODELS.some(item => item.id === settings.model) ? settings.model : defaults.model;
        const speed = Number.isFinite(settings.speed) ? Math.max(0.25, Math.min(4, settings.speed)) : defaults.speed;
        const voices = voicesForModel(model);
        const voice = voices.some(item => item.id === settings.voice) ? settings.voice : defaults.voice;
        return {
            voice,
            model,
            speed,
            accent: OPENAI_TTS_ACCENTS.some(item => item.id === settings.accent) ? settings.accent : defaults.accent,
            style: OPENAI_TTS_STYLES.some(item => item.id === settings.style) ? settings.style : defaults.style,
            instructions: typeof settings.instructions === 'string' ? settings.instructions : defaults.instructions,
            speakAiAnswers: Boolean(settings.speakAiAnswers)
        };
    }

    /** @param {BooksSettings} settings */
    function narrationInstructions(settings) {
        const accent = OPENAI_TTS_ACCENTS.find(item => item.id === settings.accent)?.instruction || '';
        const style = OPENAI_TTS_STYLES.find(item => item.id === settings.style)?.instruction || '';
        const custom = settings.instructions.trim();
        return [accent, style, custom].filter(Boolean).join(' ');
    }

    /**
     * One MP3 of text, read as the settings say.
     * @param {string | null} apiKey
     * @param {string} text
     * @param {BooksSettings} settings
     * @param {AbortSignal | null} signal
     * @param {string} [voice] a voice other than the chosen one (voice samples)
     */
    async function fetchSpeech(apiKey, text, settings, signal, voice = settings.voice) {
        if (!apiKey) throw new Error('API key not configured');
        const payload = {
            model: settings.model,
            input: text,
            voice,
            speed: settings.speed,
            response_format: 'mp3'
        };
        const instructions = narrationInstructions(settings);
        if (instructions && supportsInstructions(settings.model)) {
            /** @type {any} */ (payload).instructions = instructions;
        }
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: signal || undefined
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
        }
        return response;
    }

    return { voicesForModel, modelFor, supportsInstructions, normalizeSettings, narrationInstructions, fetchSpeech };
})();

window.BooksTts = BooksTts;
