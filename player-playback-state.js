// @ts-check
//-----------------------------------------------------------------------
// PLAYBACK STATE
// The single authoritative location for music-player playback state:
// the play/pause status, the one reused YouTube player handle and its
// readiness, the active item/video the player holds, the current item,
// the playlist cursor, and the two transient intents (resume-after-
// listening, auto-advance suppression).
//
// Nothing outside this object stores playback state. All mutations go
// through the named transitions below so the status, the active player,
// and the current item can never drift out of sync across modules.
//-----------------------------------------------------------------------

/** @typedef {'idle' | 'loading' | 'playing' | 'paused' | 'error'} PlaybackStatus */

class PlaybackState {
    constructor() {
        /** @type {PlaybackStatus} */
        this.status = 'idle';
        /** @type {YT.Player | null} The single reused YouTube player handle */
        this.player = null;
        /** @type {boolean} Player constructed and onReady fired */
        this.ready = false;
        /** @type {number | null} Playlist item id the player currently holds */
        this.activeItemId = null;
        /** @type {string} Video id the player currently holds */
        this.activeVideoId = '';
        /** @type {number | null} Item id currently designated as current/playing */
        this.currentPlayingId = null;
        /** @type {number} Cursor into the playlist array (-1 = none) */
        this.currentPlaylistIndex = -1;
        /** @type {boolean} Resume playback after a listening/LLM turn finishes */
        this.resumeAfterListening = false;
        /** @type {number} Ignore ENDED auto-advance until this epoch-ms timestamp */
        this.suppressAutoAdvanceUntil = 0;
    }

    get isPlaying() {
        return this.status === 'playing';
    }

    get isPaused() {
        return this.status === 'paused';
    }

    /** The (single) player is being created/loaded; nothing sounding yet. */
    markLoading() {
        this.status = 'loading';
    }

    /** @param {YT.Player} player The player reported ready via onReady. */
    markPlayerReady(player) {
        this.player = player;
        this.ready = true;
    }

    /**
     * Bind the reused player to a new item + video (used when a real load
     * will follow, so the video id is recorded as what the player holds).
     * @param {number} itemId @param {string} videoId
     */
    setActiveMedia(itemId, videoId) {
        this.activeItemId = itemId;
        this.activeVideoId = videoId;
    }

    /**
     * Point the reused, already-ready player at a different item without
     * changing the recorded video id, so the next play triggers a load.
     * @param {number} itemId
     */
    setActiveItem(itemId) {
        this.activeItemId = itemId;
    }

    /** @param {number} itemId The item now playing. */
    markPlaying(itemId) {
        this.status = 'playing';
        this.currentPlayingId = itemId;
    }

    markPaused() {
        if (this.currentPlayingId != null) {
            this.status = 'paused';
        }
    }

    markStopped() {
        this.status = 'idle';
    }

    markError() {
        this.status = 'error';
    }

    /** @param {number} ms */
    suppressAutoAdvanceFor(ms) {
        this.suppressAutoAdvanceUntil = Date.now() + ms;
    }

    shouldSuppressAutoAdvance() {
        return Date.now() < this.suppressAutoAdvanceUntil;
    }

    /** Return to the empty/idle baseline (playlist cleared). */
    reset() {
        this.status = 'idle';
        this.player = null;
        this.ready = false;
        this.activeItemId = null;
        this.activeVideoId = '';
        this.currentPlayingId = null;
        this.currentPlaylistIndex = -1;
        this.resumeAfterListening = false;
        this.suppressAutoAdvanceUntil = 0;
    }
}

window.PlaybackState = PlaybackState;
