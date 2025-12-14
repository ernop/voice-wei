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

const VoiceOutput = (function() {
    'use strict';

    //-------CONFIGURATION-------
    const CONFIG = {
        // Default speech rate (1.0 = normal)
        rate: 1.0,
        // Default pitch (1.0 = normal)
        pitch: 1.0,
        // Default volume (1.0 = full)
        volume: 1.0
    };

    //-------STATE-------
    let synthesis = null;

    //-------INITIALIZATION-------
    function init() {
        if ('speechSynthesis' in window) {
            synthesis = window.speechSynthesis;
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
     * @param {Object} settings
     */
    function configure(settings) {
        Object.assign(CONFIG, settings);
    }

    /**
     * Get current configuration.
     * @returns {Object}
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
