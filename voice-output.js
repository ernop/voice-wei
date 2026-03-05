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
                console.log('[VoiceOutput] Selected voice:', match.name);
                return;
            }
        }

        // Fallback: any English voice
        const english = voices.find(v => v.lang.startsWith('en'));
        if (english) {
            preferredVoice = english;
            console.log('[VoiceOutput] Fallback voice:', english.name);
        }
    }

    //-------INITIALIZATION-------
    function init() {
        if ('speechSynthesis' in window) {
            synthesis = window.speechSynthesis;
            pickBestVoice();
            // Voices may load asynchronously (Chrome does this)
            synthesis.addEventListener('voiceschanged', pickBestVoice);
            console.log('[VoiceOutput] Browser speechSynthesis available');
        } else {
            console.warn('[VoiceOutput] Browser speechSynthesis not available');
        }
    }

    //-------PUBLIC API-------

    /**
     * Speak text aloud using browser's speechSynthesis.
     *
     * @param {string} text - The text to speak
     * @returns {Promise<void>} Resolves when speech completes
     */
    function speak(text) {
        return new Promise((resolve, reject) => {
            if (!text || typeof text !== 'string') {
                resolve();
                return;
            }

            if (!synthesis) {
                reject(new Error('Browser speech synthesis not available'));
                return;
            }

            // Cancel any ongoing speech
            synthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            if (preferredVoice) utterance.voice = preferredVoice;
            utterance.rate = CONFIG.rate;
            utterance.pitch = CONFIG.pitch;
            utterance.volume = CONFIG.volume;

            utterance.onend = () => resolve();
            utterance.onerror = (event) => {
                // 'interrupted' and 'canceled' are not real errors
                if (event.error === 'interrupted' || event.error === 'canceled') {
                    resolve();
                } else {
                    reject(new Error(`Speech error: ${event.error}`));
                }
            };

            synthesis.speak(utterance);
        });
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
        stop,
        isSpeaking,
        configure,
        getConfig,
        isAvailable
    };
})();

// Also expose as window global for compatibility
window.VoiceOutput = VoiceOutput;
