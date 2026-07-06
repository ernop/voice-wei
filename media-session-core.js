// @ts-check
//-----------------------------------------------------------------------
// MEDIA SESSION CORE
// The single owner of the now-playing surface: Media Session metadata
// (what car Bluetooth displays and lock screens show), the document
// title, the visible site-header heading, the reported playback state,
// and hardware media key handlers.
//
// Browsers route the media session to whichever frame is audibly
// playing. Our pages sound through Web Audio bursts or a YouTube
// iframe, so left alone the session would detach (or belong to
// youtube.com). The core therefore loops a silent WAV element to keep
// THIS page the routed session, and reporting 'playing' automatically
// secures that ownership - pages cannot claim playback without it.
//
// No page touches navigator.mediaSession or assigns document.title
// directly (enforced by ast-grep); everything goes through here.
//-----------------------------------------------------------------------

const MediaSessionCore = (function () {
    'use strict';

    const SILENCE_SECONDS = 10;
    const SAMPLE_RATE = 8000;

    const DEFAULT_DOCUMENT_TITLE = document.title;

    /** @type {HTMLAudioElement | null} */
    let audioEl = null;
    /** @type {MediaSessionPlaybackState | null} Last state a page reported */
    let explicitState = null;
    /** @type {string | null} Header heading text before the first override */
    let defaultHeaderText = null;
    // Last-written values: the core communicates minimally with the
    // display surfaces, so identical repeat writes are dropped here and
    // callers never carry their own dedupe.
    /** @type {string | null} */
    let writtenMetaTitle = null;
    /** @type {string | null} */
    let writtenMetaArtist = null;

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
     * the play button work at all. Reporting 'playing' also secures the
     * session (the silent loop) so the report reaches the car at all.
     * @param {MediaSessionPlaybackState} state
     */
    function setPlaybackState(state) {
        const changed = state !== explicitState;
        explicitState = state;
        // Re-arm the keep-alive on the transition to playing, or when the
        // OS paused the silent loop out from under a standing claim.
        if (state === 'playing' && (changed || !audioEl || audioEl.paused)) void activate();
        if (!changed || !('mediaSession' in navigator)) return;
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
        const artist = options.artist === undefined ? 'Voice-Wei' : options.artist;
        if (title === writtenMetaTitle && artist === writtenMetaArtist) return;

        try {
            navigator.mediaSession.metadata = new MediaMetadata({ title, artist });
            writtenMetaTitle = title;
            writtenMetaArtist = artist;
        } catch (err) {
            // Metadata is optional; action handlers are the useful part here.
        }
    }

    /** @returns {HTMLElement | null} */
    function headerHeading() {
        const heading = document.querySelector('#siteHeader .header-title-group h1');
        return heading instanceof HTMLElement ? heading : null;
    }

    /** Remember what the header said before the first override. */
    function captureHeaderDefault(heading) {
        if (defaultHeaderText === null) defaultHeaderText = heading.textContent || '';
    }

    /**
     * THE now-playing text: one call updates every surface a listener
     * can see - car/lock-screen metadata, the tab title, and the site
     * header heading. Pages express "show this"; the fan-out is owned
     * here so the surfaces can never disagree.
     * @param {string} title
     * @param {{ artist?: string }} [options]
     */
    function setNowPlayingTitle(title, options = {}) {
        updateMetadata(title, options);
        if (document.title !== title) document.title = title;
        const heading = headerHeading();
        if (heading && heading.textContent !== title) {
            captureHeaderDefault(heading);
            heading.textContent = title;
        }
    }

    /** Restore every surface to its page default. */
    function clearNowPlayingTitle() {
        updateMetadata('', { artist: '' });
        if (document.title !== DEFAULT_DOCUMENT_TITLE) document.title = DEFAULT_DOCUMENT_TITLE;
        const heading = headerHeading();
        if (heading && defaultHeaderText !== null && heading.textContent !== defaultHeaderText) {
            heading.textContent = defaultHeaderText;
        }
    }

    /** @param {Array<[MediaSessionAction, () => void]>} handlers */
    function setActionHandlers(handlers) {
        if (!('mediaSession' in navigator)) return;
        handlers.forEach(([action, handler]) => {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (err) {
                // Individual actions vary by browser/device.
            }
        });
    }

    /**
     * @param {string} title
     * @param {Array<[MediaSessionAction, () => void]>} handlers
     */
    function register(title, handlers) {
        updateMetadata(title);
        setActionHandlers(handlers);
    }

    // Arm the keep-alive on the first user gesture automatically: any
    // page that loads the core gets session ownership without wiring.
    const prime = () => { activate(); };
    document.addEventListener('pointerup', prime, { once: true });
    document.addEventListener('click', prime, { once: true });
    document.addEventListener('touchend', prime, { once: true });

    return {
        activate,
        register,
        setActionHandlers,
        updateMetadata,
        setNowPlayingTitle,
        clearNowPlayingTitle,
        setPlaybackState
    };
})();

window.MediaSessionCore = MediaSessionCore;
