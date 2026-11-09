// @ts-check
// Listening history: how many times each song started and how long it
// actually played, measured from the main YouTube player's own state
// reports and saved per videoId (PlayerHistoryDB `songListening`).

/** While a song plays its time so far is saved this often, so a page the browser discards loses at most this much. */
const LISTENING_CHECKPOINT_MS = 30000;

const PlayerListening = (function () {
    'use strict';

    /**
     * Most listened first: seconds heard, then plays. Songs with equal
     * listening (every song never played) compare equal, so the caller's
     * own order decides among them.
     * @param {Map<string, SongListeningRecord>} listening
     * @returns {(a: { videoId: string }, b: { videoId: string }) => number}
     */
    function compareMostListened(listening) {
        return (a, b) => {
            const left = listening.get(a.videoId);
            const right = listening.get(b.videoId);
            return ((right ? right.listenedSeconds : 0) - (left ? left.listenedSeconds : 0))
                || ((right ? right.playCount : 0) - (left ? left.playCount : 0));
        };
    }

    /** @param {PlayerController} controller */
    function install(controller) {
        Object.assign(controller, /** @type {ThisType<PlayerController>} */ ({
            /** A hidden page may be discarded without another event: save the sounding song's time first. */
            setupListeningHistory() {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden') void this.checkpointListening();
                });
                window.addEventListener('pagehide', () => {
                    void this.checkpointListening();
                });
            },

            /** @param {number} state One state report of the main YouTube player */
            noteListeningState(state) {
                const nowMs = performance.now();
                if (state !== YT.PlayerState.PLAYING) {
                    this.endListeningSpan();
                    return;
                }
                const { playStarted, endedSpan } = this.playback.startListening(nowMs);
                if (endedSpan) void this.saveListening(endedSpan.videoId, 0, endedSpan.seconds);
                if (playStarted) void this.saveListening(this.playback.activeVideoId, 1, 0);
                if (this.listeningCheckpointTimer === null) {
                    this.listeningCheckpointTimer = setInterval(() => {
                        if (this.playback.listeningSpan) {
                            void this.checkpointListening();
                            return;
                        }
                        clearInterval(this.listeningCheckpointTimer);
                        this.listeningCheckpointTimer = null;
                    }, LISTENING_CHECKPOINT_MS);
                }
            },

            /** Close the open span and save its time: YouTube left PLAYING, or the player is going away. */
            endListeningSpan() {
                const listened = this.playback.stopListening(performance.now());
                if (listened) void this.saveListening(listened.videoId, 0, listened.seconds);
            },

            /** Save the sounding song's time so far; it goes on counting from now. */
            checkpointListening() {
                const listened = this.playback.takeListenedSoFar(performance.now());
                if (!listened) return Promise.resolve();
                return this.saveListening(listened.videoId, 0, listened.seconds);
            },

            /** Settles once written; a failed write is shown in the Log. */
            saveListening(videoId, playStarts, listenedSeconds) {
                if (playStarts === 0 && listenedSeconds === 0) return Promise.resolve();
                return window.PlayerHistoryDB.addSongListening({ videoId, playStarts, listenedSeconds })
                    .catch(error => this.logError('Listening history', error));
            },

            /** Every played song's listening by videoId, the sounding song's time included. */
            async loadListening() {
                await this.checkpointListening();
                const records = await window.PlayerHistoryDB.listSongListening();
                return new Map(records.map(record => [record.videoId, record]));
            },

            /** "3 plays · 12:40": the plays started and the time heard. */
            describeListening(record) {
                const seconds = Math.round(record.listenedSeconds);
                const heard = seconds > 0 ? this.formatSeconds(seconds) : '0:00';
                return `${record.playCount} play${record.playCount === 1 ? '' : 's'} \u00b7 ${heard}`;
            }
        }));
    }

    return { install, compareMostListened };
})();

window.PlayerListening = PlayerListening;
