// @ts-check
// Opt-in diagnostic for measuring a three-player YouTube strategy:
// the normal current player plus two muted, off-screen warm players.

const PlayerPrebufferProbe = (function () {
    'use strict';

    const PROBE_QUERY_VALUE = '1';
    const PROBE_NEXT_COUNT = 2;
    const PREWARM_PLAY_MS = 2500;
    const PREWARM_HOLD_MS = 3000;
    const WARM_SAMPLE_MS = 500;

    /** @param {VoiceMusicController} controller */
    function install(controller) {
        Object.assign(controller, /** @type {ThisType<VoiceMusicController>} */ ({
            prebufferProbeEnabled: new URLSearchParams(window.location.search).get('prebufferProbe') === PROBE_QUERY_VALUE,
            prebufferProbeRunId: 0,
            prebufferProbePlayers: [],
            prebufferProbeTimers: [],
            prebufferProbeSlots: [],

            /** @param {PlaylistItem} currentItem */
            prebufferProbeCandidates(currentItem) {
                const currentIndex = this.playlist.findIndex(item => item.id === currentItem.id);
                if (currentIndex < 0 || this.playlist.length < PROBE_NEXT_COUNT + 1) return [];
                const candidates = [];
                for (let distance = 1; distance < this.playlist.length && candidates.length < PROBE_NEXT_COUNT; distance++) {
                    const candidate = this.playlist[(currentIndex + distance) % this.playlist.length];
                    if (candidate.id !== currentItem.id) candidates.push(candidate);
                }
                return candidates;
            },

            cleanupPrebufferProbe() {
                for (const timer of this.prebufferProbeTimers) clearTimeout(timer);
                this.prebufferProbeTimers = [];
                for (const player of this.prebufferProbePlayers) {
                    if (player && typeof player.destroy === 'function') player.destroy();
                }
                this.prebufferProbePlayers = [];
                this.prebufferProbeSlots = [];
                document.getElementById('prebuffer-probe-host')?.remove();
            },

            /** @param {number} runId @param {() => void} callback @param {number} delayMs */
            schedulePrebufferProbe(runId, callback, delayMs) {
                const timer = setTimeout(() => {
                    if (this.prebufferProbeRunId === runId) callback();
                }, delayMs);
                this.prebufferProbeTimers.push(timer);
            },

            /** @param {PlaylistItem} currentItem */
            async startPrebufferProbeFor(currentItem) {
                if (!this.prebufferProbeEnabled) return;
                this.cleanupPrebufferProbe();
                const candidates = this.prebufferProbeCandidates(currentItem);
                if (candidates.length < PROBE_NEXT_COUNT) {
                    this.addMessage('claude', 'Prebuffer probe', 'Need at least 3 playlist songs (current + next 2).');
                    return;
                }

                const runId = ++this.prebufferProbeRunId;
                const runStartedAt = performance.now();
                this.addMessage(
                    'claude',
                    'Prebuffer probe',
                    `Starting current + 2 warm players after "${currentItem.name || currentItem.title}": ${candidates.map(item => item.name || item.title).join(' | ')}`
                );
                await this.ensureYouTubeApi();
                if (this.prebufferProbeRunId !== runId) return;

                const host = document.createElement('div');
                host.id = 'prebuffer-probe-host';
                host.setAttribute('aria-hidden', 'true');
                host.style.cssText = 'position:fixed;left:-10000px;top:0;width:420px;height:220px;overflow:hidden;pointer-events:none;opacity:0.01';
                document.body.appendChild(host);

                candidates.forEach((item, slotIndex) => {
                    const playerElement = document.createElement('div');
                    playerElement.id = `prebuffer-probe-player-${slotIndex}`;
                    host.appendChild(playerElement);
                    const slot = {
                        item,
                        slotIndex,
                        stage: 'creating',
                        readyMs: 0,
                        coldStartMs: 0,
                        warmStartMs: 0,
                        bufferedAfterPrewarmSeconds: 0,
                        bufferedAfterWarmSeconds: 0,
                        warmRequestedAt: 0,
                        finished: false,
                        errorCode: 0
                    };
                    this.prebufferProbeSlots.push(slot);

                    const player = new YT.Player(playerElement.id, /** @type {YT.PlayerOptions} */ ({
                        height: '200',
                        width: '400',
                        videoId: item.videoId,
                        playerVars: {
                            autoplay: 0,
                            controls: 0,
                            enablejsapi: 1,
                            origin: window.location.origin,
                            playsinline: 1,
                            widget_referrer: window.location.origin,
                            rel: 0
                        },
                        events: {
                            onReady: (event) => {
                                if (this.prebufferProbeRunId !== runId) return;
                                slot.readyMs = performance.now() - runStartedAt;
                                slot.stage = 'waiting-cold-play';
                                event.target.mute();
                                event.target.playVideo();
                            },
                            onStateChange: (event) => {
                                this.handlePrebufferProbeState(runId, slot, event.target, event.data, runStartedAt);
                            },
                            onError: (event) => {
                                slot.errorCode = Number(event.data) || -1;
                                this.finishPrebufferProbeSlot(runId, slot, event.target);
                            }
                        }
                    }));
                    this.prebufferProbePlayers.push(player);
                });
            },

            /** @param {number} runId @param {PrebufferProbeSlot} slot @param {YT.Player} player @param {number} state @param {number} runStartedAt */
            handlePrebufferProbeState(runId, slot, player, state, runStartedAt) {
                if (this.prebufferProbeRunId !== runId || state !== YT.PlayerState.PLAYING) return;
                if (slot.stage === 'waiting-cold-play') {
                    slot.coldStartMs = performance.now() - runStartedAt;
                    slot.stage = 'prewarming';
                    this.schedulePrebufferProbe(runId, () => {
                        const duration = player.getDuration();
                        slot.bufferedAfterPrewarmSeconds = duration * player.getVideoLoadedFraction();
                        player.pauseVideo();
                        player.seekTo(0, true);
                        slot.stage = 'holding';
                        this.schedulePrebufferProbe(runId, () => {
                            slot.stage = 'waiting-warm-play';
                            slot.warmRequestedAt = performance.now();
                            player.playVideo();
                        }, PREWARM_HOLD_MS);
                    }, PREWARM_PLAY_MS);
                } else if (slot.stage === 'waiting-warm-play') {
                    slot.warmStartMs = performance.now() - slot.warmRequestedAt;
                    slot.stage = 'sampling-warm-play';
                    this.schedulePrebufferProbe(runId, () => {
                        const duration = player.getDuration();
                        slot.bufferedAfterWarmSeconds = duration * player.getVideoLoadedFraction();
                        player.pauseVideo();
                        this.finishPrebufferProbeSlot(runId, slot, player);
                    }, WARM_SAMPLE_MS);
                }
            },

            /** @param {number} runId @param {PrebufferProbeSlot} slot @param {YT.Player} player */
            finishPrebufferProbeSlot(runId, slot, player) {
                if (this.prebufferProbeRunId !== runId || slot.finished) return;
                slot.finished = true;
                if (slot.errorCode) {
                    this.addMessage(
                        'error',
                        'Prebuffer probe',
                        `slot ${slot.slotIndex + 1} "${slot.item.name || slot.item.title}": YouTube error ${slot.errorCode}`
                    );
                } else {
                    this.addMessage(
                        'claude',
                        'Prebuffer probe',
                        [
                            `slot ${slot.slotIndex + 1} "${slot.item.name || slot.item.title}"`,
                            `ready ${Math.round(slot.readyMs)}ms`,
                            `cold play ${Math.round(slot.coldStartMs)}ms`,
                            `buffered ${slot.bufferedAfterPrewarmSeconds.toFixed(1)}s after ${(PREWARM_PLAY_MS / 1000).toFixed(1)}s`,
                            `warm resume ${Math.round(slot.warmStartMs)}ms`,
                            `buffered ${slot.bufferedAfterWarmSeconds.toFixed(1)}s after resume`
                        ].join(' | ')
                    );
                }
                if (typeof player.pauseVideo === 'function') player.pauseVideo();

                if (this.prebufferProbeSlots.length === PROBE_NEXT_COUNT
                    && this.prebufferProbeSlots.every(candidate => candidate.finished)) {
                    this.addMessage(
                        'claude',
                        'Prebuffer probe complete',
                        'Copy all Prebuffer probe lines from Log. Normal playback was unchanged; both probe players stayed muted.'
                    );
                    this.schedulePrebufferProbe(runId, () => this.cleanupPrebufferProbe(), 1000);
                }
            }
        }));
    }

    return { install };
})();

window.PlayerPrebufferProbe = PlayerPrebufferProbe;
