// @ts-check
//-----------------------------------------------------------------------
// VOICE OUTPUT
// Centralized text-to-speech library.
// Single source of truth for all voice output in the application.
//
// Uses browser's native speechSynthesis API.
// Quality depends on device's installed TTS voices.
// On Android: Google TTS or Samsung TTS typically provide good quality.
//
// Usage:
//   await VoiceOutput.speak("Hello world");
//   VoiceOutput.stop();
//-----------------------------------------------------------------------

const VoiceOutput = (function () {
    'use strict';

    //-------CONFIGURATION-------
    /** @type {{ rate: number, pitch: number, volume: number }} */
    const CONFIG = {
        rate: 1.4,
        pitch: 1.0,
        volume: 1.0
    };

    //-------STATE-------
    /** @type {SpeechSynthesis | null} */
    let synthesis = null;
    /** @type {SpeechSynthesisVoice | null} */
    let preferredVoice = null;
    /** @type {SpeechSynthesisVoice | null} An explicit user selection wins over auto-pick */
    let userVoice = null;

    // Ranked preference: first match wins.
    // "Natural" / "Online" voices are cloud-synthesized and dramatically better.
    const VOICE_PREFS = [
        /Microsoft.+Online.*Natural/i,
        /Google US English/i,
        /Google UK English/i,
        /Google.*English/i,
        /Samantha/i,           // macOS / iOS high-quality
        /Daniel/i,             // macOS / iOS British
        /English.*United States/i,
        /English.*United Kingdom/i,
    ];

    function pickBestVoice() {
        if (!synthesis) return;
        const voices = synthesis.getVoices();
        if (voices.length === 0) return;

        // Walk preference list; first voice matching a pattern wins
        for (const pattern of VOICE_PREFS) {
            const match = voices.find(v => pattern.test(v.name) && v.lang.startsWith('en'));
            if (match) {
                preferredVoice = match;
                return;
            }
        }

        // Last resort: any English voice
        const english = voices.find(v => v.lang.startsWith('en'));
        if (english) {
            preferredVoice = english;
        }
    }

    //-------INITIALIZATION-------
    function init() {
        if ('speechSynthesis' in window) {
            synthesis = window.speechSynthesis;
            pickBestVoice();
            // Voices may load asynchronously (Chrome does this)
            synthesis.addEventListener('voiceschanged', pickBestVoice);
        } else {
            console.warn('[VoiceOutput] Browser speechSynthesis not available');
        }
    }

    //-------PUBLIC API-------

    /** @param {string} name */
    function findVoiceByName(name) {
        if (!synthesis) return null;
        return synthesis.getVoices().find(v => v.name === name) || null;
    }

    /**
     * Speak text aloud using browser's speechSynthesis.
     *
     * Always resolves: speech is auxiliary output, so an engine error must
     * never crash a playback loop awaiting it. Real errors are logged.
     *
     * @param {string} text - The text to speak
     * @param {{ rate?: number, pitch?: number, voiceName?: string | null }} [options] - Per-call overrides
     * @returns {Promise<void>} Resolves when speech completes (or fails)
     */
    function speak(text, options = {}) {
        return new Promise((resolve) => {
            if (!text || typeof text !== 'string') {
                resolve();
                return;
            }

            if (!synthesis) {
                console.warn('[VoiceOutput] speechSynthesis not available; skipping speech');
                resolve();
                return;
            }

            // Cancel any ongoing speech
            synthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            const voice = (options.voiceName ? findVoiceByName(options.voiceName) : null)
                || userVoice
                || preferredVoice;
            if (voice) utterance.voice = voice;
            utterance.rate = options.rate ?? CONFIG.rate;
            utterance.pitch = options.pitch ?? CONFIG.pitch;
            utterance.volume = CONFIG.volume;

            utterance.onend = () => resolve();
            utterance.onerror = (event) => {
                // 'interrupted' and 'canceled' are routine (a newer speak cancelled us)
                if (event.error !== 'interrupted' && event.error !== 'canceled') {
                    console.warn(`[VoiceOutput] Speech error: ${event.error}`);
                }
                resolve();
            };

            synthesis.speak(utterance);
        });
    }

    /**
     * Speak text at an approximate utterance pitch, resolving after speech
     * ends or after a duration cap. Used for "sing the numbers" output.
     * Native speech pitch is approximate; callers map notes to pitch values.
     *
     * @param {string} text
     * @param {{ pitch: number, rate?: number, durationMs?: number }} options
     * @returns {Promise<void>}
     */
    function speakAtPitch(text, options) {
        return new Promise(resolve => {
            if (!synthesis) { resolve(); return; }
            synthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.pitch = options.pitch;
            utterance.rate = options.rate ?? 1.0;
            utterance.volume = CONFIG.volume;
            let settled = false;
            const finish = () => { if (settled) return; settled = true; resolve(); };
            utterance.onend = finish;
            utterance.onerror = finish;
            synthesis.speak(utterance);
            setTimeout(finish, Math.max(250, (options.durationMs || 0) + 250));
        });
    }

    /**
     * Select a specific voice by name; pass null to return to auto-pick.
     * @param {string | null} name
     */
    function setVoiceByName(name) {
        userVoice = name ? findVoiceByName(name) : null;
    }

    /**
     * Stop any currently playing speech.
     */
    function stop() {
        if (synthesis) {
            synthesis.cancel();
        }
    }

    /**
     * Check if speech is currently playing.
     * @returns {boolean}
     */
    function isSpeaking() {
        return synthesis ? synthesis.speaking : false;
    }

    /**
     * Configure voice output settings.
     * @param {Partial<{ rate: number, pitch: number, volume: number }>} settings
     */
    function configure(settings) {
        Object.assign(CONFIG, settings);
    }

    /**
     * Get current configuration.
     * @returns {{ rate: number, pitch: number, volume: number }}
     */
    function getConfig() {
        return { ...CONFIG };
    }

    /**
     * Check if TTS is available.
     * @returns {boolean}
     */
    function isAvailable() {
        return !!synthesis;
    }

    // Initialize on load
    init();

    // Public API
    return {
        speak,
        speakAtPitch,
        setVoiceByName,
        stop,
        isSpeaking,
        configure,
        getConfig,
        isAvailable
    };
})();

// Also expose as window global for compatibility
window.VoiceOutput = VoiceOutput;
