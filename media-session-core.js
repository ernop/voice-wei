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
    /**
     * @typedef {{
     *   id: string,
     *   title: string,
     *   artist: string,
     *   album: string,
     *   artwork: MediaImage[]
     * }} TrackIdentity
     */
    /**
     * @typedef {{
     *   duration: number,
     *   position: number,
     *   playbackRate: number
     * }} PositionState
     */

    // A song's identity is stable while its lyric display line changes.
    // Keeping them separate is essential: Media Session is track-oriented,
    // but the Lyrics page deliberately uses its title field as a lyric relay.
    /** @type {TrackIdentity | null} */
    let trackIdentity = null;
    /** @type {string | null} null means use the stable track title */
    let displayLine = null;
    /** @type {{ title: string, artist: string } | null} Non-player page metadata */
    let simpleMetadata = null;
    /** @type {string | null} */
    let writtenMetadataKey = null;
    /** @type {PositionState | null} */
    let positionState = null;
    /** @type {string | null} */
    let writtenPositionKey = null;

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
            // Reclaiming the element means the OS may have been showing
            // another frame's session (YouTube). Force the complete stable
            // identity, lyric line, and real song position through again.
            writtenMetadataKey = null;
            writtenPositionKey = null;
            publishMetadata();
            publishPosition();
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
     * Keep THIS page the routed media session while transport claims
     * playing. Safe to call on every lyric push - no-ops when the silent
     * loop is already running and state is already 'playing'.
     */
    function ensurePlayingSession() {
        setPlaybackState('playing');
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
        const artist = options.artist === undefined ? 'Voice-Wei' : options.artist;
        trackIdentity = null;
        displayLine = null;
        simpleMetadata = { title, artist };
        publishMetadata();
    }

    /** @returns {MediaMetadataInit | null} */
    function composedMetadata() {
        if (trackIdentity) {
            return {
                title: displayLine || trackIdentity.title,
                artist: trackIdentity.artist,
                album: trackIdentity.album,
                artwork: trackIdentity.artwork
            };
        }
        return simpleMetadata;
    }

    /** Push complete metadata when any presented field differs. */
    function publishMetadata() {
        if (!('mediaSession' in navigator)) return;
        const metadata = composedMetadata();
        if (!metadata) return;
        const key = JSON.stringify(metadata);
        if (key === writtenMetadataKey) return;

        try {
            navigator.mediaSession.metadata = new MediaMetadata(metadata);
            writtenMetadataKey = key;
            // Some receivers reset their displayed timer when title metadata
            // changes. Reassert the same song position without treating the
            // lyric as a track boundary.
            publishPosition(true);
        } catch (err) {
            // Metadata is optional; action handlers are the useful part here.
        }
    }

    /**
     * Set stable metadata once per sounding media identity.
     * @param {TrackIdentity} identity
     */
    function setTrackIdentity(identity) {
        const changedTrack = !trackIdentity || trackIdentity.id !== identity.id;
        trackIdentity = {
            id: String(identity.id || ''),
            title: String(identity.title || 'Unknown song'),
            artist: String(identity.artist || ''),
            album: String(identity.album || ''),
            artwork: Array.isArray(identity.artwork) ? identity.artwork : []
        };
        simpleMetadata = null;
        if (changedTrack) {
            displayLine = null;
            writtenMetadataKey = null;
            clearPosition(false);
        }
        publishMetadata();
        if (!displayLine) showDisplayLine(trackIdentity.title);
    }

    /** @param {string} title */
    function setDisplayLine(title) {
        displayLine = String(title || '').trim() || null;
        publishMetadata();
        if (displayLine) {
            showDisplayLine(displayLine);
        } else if (trackIdentity) {
            showDisplayLine(trackIdentity.title);
        } else {
            restoreDisplayLine();
        }
    }

    function clearDisplayLine() {
        setDisplayLine('');
    }

    /**
     * Publish the audible media's true position, never the silent ownership
     * WAV's position. Invalid/unreadable player values are ignored.
     * @param {PositionState} state
     */
    function setPosition(state) {
        const duration = Number(state.duration);
        const position = Number(state.position);
        const playbackRate = Number(state.playbackRate);
        if (!Number.isFinite(duration) || duration <= 0
            || !Number.isFinite(position)
            || !Number.isFinite(playbackRate) || playbackRate <= 0) return;

        positionState = {
            duration,
            position: Math.min(Math.max(position, 0), duration),
            playbackRate
        };
        publishPosition();
    }

    /** @param {boolean} [force] */
    function publishPosition(force = false) {
        if (!positionState || !('mediaSession' in navigator)
            || typeof navigator.mediaSession.setPositionState !== 'function') return;
        // The receiver extrapolates between samples. Whole-second dedupe keeps
        // lyric-deadline renders from producing extra position traffic.
        const key = [
            positionState.duration,
            positionState.position.toFixed(1),
            positionState.playbackRate
        ].join('|');
        if (!force && key === writtenPositionKey) return;
        try {
            navigator.mediaSession.setPositionState(positionState);
            writtenPositionKey = key;
        } catch (err) {
            // Optional surface; invalid browser/device implementations must
            // not interrupt playback.
        }
    }

    /** @param {boolean} [force] */
    function clearPosition(force = true) {
        const hadPosition = positionState !== null || writtenPositionKey !== null;
        positionState = null;
        writtenPositionKey = null;
        if (!force && !hadPosition) return;
        if (!('mediaSession' in navigator)
            || typeof navigator.mediaSession.setPositionState !== 'function') return;
        try {
            navigator.mediaSession.setPositionState();
        } catch (err) {
            // Optional surface.
        }
    }

    /** @returns {HTMLElement | null} */
    function headerHeading() {
        // Both header layouts (title-in-top-row and the music page's
        // full-width lyric line) expose exactly one h1 in the header.
        const heading = document.querySelector('#siteHeader h1');
        return heading instanceof HTMLElement ? heading : null;
    }

    /** Remember what the header said before the first override. */
    function captureHeaderDefault(heading) {
        if (defaultHeaderText === null) defaultHeaderText = heading.textContent || '';
    }

    /** @param {string} title */
    function showDisplayLine(title) {
        if (document.title !== title) document.title = title;
        const heading = headerHeading();
        if (heading && heading.textContent !== title) {
            captureHeaderDefault(heading);
            heading.textContent = title;
        }
    }

    function restoreDisplayLine() {
        if (document.title !== DEFAULT_DOCUMENT_TITLE) document.title = DEFAULT_DOCUMENT_TITLE;
        const heading = headerHeading();
        if (heading && defaultHeaderText !== null && heading.textContent !== defaultHeaderText) {
            heading.textContent = defaultHeaderText;
        }
    }

    /**
     * Backward-compatible combined call for non-player tools. The Lyrics
     * player uses setTrackIdentity + setDisplayLine instead.
     * @param {string} title
     * @param {{ artist?: string }} [options]
     */
    function setNowPlayingTitle(title, options = {}) {
        updateMetadata(title, options);
        showDisplayLine(title);
    }

    /** Restore every surface to its page default. */
    function clearNowPlayingTitle() {
        updateMetadata('', { artist: '' });
        restoreDisplayLine();
    }

    /** End the logical track and release all stale external presentation. */
    function clearTrack() {
        trackIdentity = null;
        displayLine = null;
        simpleMetadata = null;
        writtenMetadataKey = null;
        clearPosition();
        restoreDisplayLine();
        explicitState = 'none';
        if (audioEl) {
            audioEl.pause();
            audioEl.currentTime = 0;
        }
        if (!('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.metadata = null;
            navigator.mediaSession.playbackState = 'none';
        } catch (err) {
            // Optional surface.
        }
    }

    /** @param {Array<[MediaSessionAction, MediaSessionActionHandler]>} handlers */
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
     * @param {Array<[MediaSessionAction, MediaSessionActionHandler]>} handlers
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
        ensurePlayingSession,
        register,
        setActionHandlers,
        updateMetadata,
        setNowPlayingTitle,
        clearNowPlayingTitle,
        setTrackIdentity,
        setDisplayLine,
        clearDisplayLine,
        setPosition,
        clearPosition,
        clearTrack,
        setPlaybackState
    };
})();

window.MediaSessionCore = MediaSessionCore;
