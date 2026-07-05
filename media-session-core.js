// @ts-check
//-----------------------------------------------------------------------
// MEDIA SESSION CORE
// Hardware media key / lock-screen control integration. Browsers only
// surface media controls for pages that are "playing audio", so this
// loops a silent WAV element while registering action handlers.
//-----------------------------------------------------------------------

const MediaSessionCore = (function () {
    'use strict';

    const SILENCE_SECONDS = 10;
    const SAMPLE_RATE = 8000;

    /** @type {HTMLAudioElement | null} */
    let audioEl = null;
    /** @type {MediaSessionPlaybackState | null} Last state a page reported */
    let explicitState = null;

    function createSilentWavUrl() {
        const sampleCount = SAMPLE_RATE * SILENCE_SECONDS;
        const byteRate = SAMPLE_RATE;
        const buffer = new ArrayBuffer(44 + sampleCount);
        const view = new DataView(buffer);

        /** @param {number} offset @param {string} text */
        const writeAscii = (offset, text) => {
            for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
        };

        writeAscii(0, 'RIFF');
        view.setUint32(4, 36 + sampleCount, true);
        writeAscii(8, 'WAVE');
        writeAscii(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, SAMPLE_RATE, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, 1, true);
        view.setUint16(34, 8, true);
        writeAscii(36, 'data');
        view.setUint32(40, sampleCount, true);

        const samples = new Uint8Array(buffer, 44);
        samples.fill(128);

        return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    }

    async function activate() {
        if (!audioEl) {
            audioEl = new Audio(createSilentWavUrl());
            audioEl.loop = true;
            audioEl.volume = 1;
            audioEl.preload = 'auto';
            audioEl.setAttribute('playsinline', 'true');
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
        }

        try {
            await audioEl.play();
            // The silent loop would otherwise be computed as 'playing';
            // pages that report transport state keep their word here.
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = explicitState || 'playing';
            }
        } catch (err) {
            // Chrome may require a user gesture before exposing hardware media controls.
        }
    }

    /**
     * Report the page's true transport state. Car play/pause buttons are
     * a toggle routed by this state: claiming 'playing' while idle makes
     * every play press arrive as 'pause', so honesty here is what makes
     * the play button work at all.
     * @param {MediaSessionPlaybackState} state
     */
    function setPlaybackState(state) {
        explicitState = state;
        if (!('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.playbackState = state;
        } catch (err) {
            // Optional surface; never let it break playback.
        }
    }

    /**
     * @param {string} title
     * @param {{ artist?: string }} [options]
     */
    function updateMetadata(title, options = {}) {
        if (!('mediaSession' in navigator)) return;

        try {
            const metadata = options.artist === undefined
                ? { title, artist: 'Voice-Wei' }
                : { title, artist: options.artist };
            navigator.mediaSession.metadata = new MediaMetadata(metadata);
        } catch (err) {
            // Metadata is optional; action handlers are the useful part here.
        }
    }

    /**
     * @param {string} title
     * @param {Array<[MediaSessionAction, () => void]>} handlers
     */
    function register(title, handlers) {
        updateMetadata(title);

        handlers.forEach(([action, handler]) => {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (err) {
                // Individual actions vary by browser/device.
            }
        });
    }

    function primeOnUserGesture() {
        const prime = () => { activate(); };
        document.addEventListener('pointerup', prime, { once: true });
        document.addEventListener('click', prime, { once: true });
        document.addEventListener('touchend', prime, { once: true });
    }

    return { activate, register, updateMetadata, setPlaybackState, primeOnUserGesture };
})();

window.MediaSessionCore = MediaSessionCore;
