// @ts-check
//-----------------------------------------------------------------------
// PLAYER LIFECYCLE
// Durable evidence for background-playback failures. The last transition is
// written synchronously to localStorage because Android may kill a hidden
// renderer without firing pagehide; the normal player log keeps the readable
// event history in IndexedDB.
//-----------------------------------------------------------------------

const PlayerLifecycle = (function () {
    'use strict';

    // Fresh-enough for a post-mortem, cheap enough to run always. Audible
    // tabs are exempt from background timer throttling, so while music
    // actually plays the beat stays on schedule; once sound stops, later
    // beats may arrive minutes apart, which is itself evidence.
    const HEARTBEAT_MS = 15000;

    /** @type {Readonly<Record<string, string>>} */
    const YOUTUBE_STATE_NAMES = Object.freeze({
        '-1': 'unstarted',
        0: 'ended',
        1: 'playing',
        2: 'paused',
        3: 'buffering',
        5: 'cued'
    });

    /** @type {VoiceMusicController | null} */
    let controller = null;
    /** @type {((text: string) => void) | null} */
    let report = null;
    /** @type {string} */
    let sessionId = '';
    let sequence = 0;
    let started = false;
    let pagehideObserved = false;
    /** @type {PlayerLifecycleBreadcrumb | null} */
    let previousBreadcrumb = null;

    /** @param {unknown} value @returns {value is PlayerLifecycleBreadcrumb} */
    function isBreadcrumb(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const record = /** @type {Record<string, unknown>} */ (value);
        return typeof record.sessionId === 'string'
            && typeof record.event === 'string'
            && typeof record.recordedAt === 'string';
    }

    function navigationType() {
        const navigation = /** @type {PerformanceNavigationTiming | undefined} */ (
            performance.getEntriesByType('navigation')[0]
        );
        return navigation ? navigation.type : 'unknown';
    }

    /** @returns {'yes' | 'no' | 'unsupported'} */
    function discardedState() {
        const lifecycleDocument = /** @type {Document & { wasDiscarded?: boolean }} */ (document);
        if (typeof lifecycleDocument.wasDiscarded !== 'boolean') return 'unsupported';
        return lifecycleDocument.wasDiscarded ? 'yes' : 'no';
    }

    /** @param {number | null} state */
    function youtubeStateName(state) {
        if (state === null) return 'unavailable';
        return YOUTUBE_STATE_NAMES[state] || `unknown-${state}`;
    }

    /** @returns {PlayerPlaybackDiagnosticSnapshot} */
    function playbackSnapshot() {
        if (!controller) {
            return {
                appStatus: 'unavailable',
                videoId: '',
                positionSeconds: null,
                youtubeState: null,
                mediaSessionState: 'unavailable',
                keepAlive: 'absent'
            };
        }

        const playback = controller.playback;
        const player = playback.player;
        let positionSeconds = null;
        let youtubeState = null;
        if (player && playback.ready) {
            try {
                const currentTime = player.getCurrentTime();
                if (Number.isFinite(currentTime)) positionSeconds = currentTime;
                const playerState = player.getPlayerState();
                if (Number.isFinite(playerState)) youtubeState = playerState;
            } catch (error) {
                console.warn('[playback diagnostic] Could not sample YouTube player', error);
            }
        }

        return {
            appStatus: playback.status,
            videoId: playback.activeVideoId,
            positionSeconds,
            youtubeState,
            mediaSessionState: MediaSessionCore.getPlaybackState(),
            keepAlive: MediaSessionCore.getKeepAliveState()
        };
    }

    function connectionDescription() {
        const networkNavigator = /** @type {Navigator & {
         *   connection?: { effectiveType?: string, type?: string, downlink?: number, rtt?: number }
         * }} */ (navigator);
        const connection = networkNavigator.connection;
        if (!connection) return navigator.onLine ? 'online' : 'offline';
        const parts = [navigator.onLine ? 'online' : 'offline'];
        if (connection.type) parts.push(`type=${connection.type}`);
        if (connection.effectiveType) parts.push(`effective=${connection.effectiveType}`);
        if (Number.isFinite(connection.downlink)) parts.push(`downlink=${connection.downlink}Mbps`);
        if (Number.isFinite(connection.rtt)) parts.push(`rtt=${connection.rtt}ms`);
        return parts.join(',');
    }

    /** @returns {PlayerLifecycleMemorySnapshot} */
    function memorySnapshot() {
        const memoryNavigator = /** @type {Navigator & { deviceMemory?: number }} */ (navigator);
        const memoryPerformance = /** @type {Performance & {
         *   memory?: { usedJSHeapSize: number, jsHeapSizeLimit: number }
         * }} */ (performance);
        const heap = memoryPerformance.memory;
        return {
            deviceMemoryGb: Number.isFinite(memoryNavigator.deviceMemory)
                ? memoryNavigator.deviceMemory
                : null,
            usedJsHeapMb: heap && Number.isFinite(heap.usedJSHeapSize)
                ? Math.round(heap.usedJSHeapSize / 104857.6) / 10
                : null,
            heapLimitMb: heap && Number.isFinite(heap.jsHeapSizeLimit)
                ? Math.round(heap.jsHeapSizeLimit / 104857.6) / 10
                : null
        };
    }

    /**
     * @param {string} event
     * @param {Record<string, string | number | boolean | null>} [detail]
     * @param {{ silent?: boolean }} [options] silent updates the durable
     *   breadcrumb without a Log line (heartbeats would flood the panel)
     */
    function record(event, detail = {}, options = {}) {
        if (!started) return;
        const playback = playbackSnapshot();
        const breadcrumb = {
            sessionId,
            sequence: ++sequence,
            event,
            recordedAt: new Date().toISOString(),
            visibility: document.visibilityState,
            hidden: document.hidden,
            network: connectionDescription(),
            navigationType: navigationType(),
            discarded: discardedState(),
            orderlyExit: pagehideObserved,
            memory: memorySnapshot(),
            playback,
            detail
        };
        SettingsStore.saveJson(StorageKeys.PLAYER_LIFECYCLE, breadcrumb);

        const position = playback.positionSeconds === null
            ? 'unavailable'
            : `${playback.positionSeconds.toFixed(1)}s`;
        const details = Object.entries(detail)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(',');
        const text = [
            `event=${event}`,
            `visibility=${breadcrumb.visibility}`,
            `app=${playback.appStatus}`,
            `youtube=${youtubeStateName(playback.youtubeState)}(${playback.youtubeState ?? 'n/a'})`,
            `mediaSession=${playback.mediaSessionState}`,
            `keepAlive=${playback.keepAlive}`,
            `video=${playback.videoId || 'none'}`,
            `position=${position}`,
            `network=${breadcrumb.network}`,
            `memory=${breadcrumb.memory.deviceMemoryGb ?? 'unknown'}GB-device,`
                + `${breadcrumb.memory.usedJsHeapMb ?? 'unknown'}MB-heap,`
                + `${breadcrumb.memory.heapLimitMb ?? 'unknown'}MB-limit`,
            details
        ].filter(Boolean).join('; ');
        console.info(`[playback diagnostic] ${text}`);
        if (report && !options.silent) report(text);
    }

    /**
     * Refresh the durable last-known-alive record. After an unannounced
     * renderer kill, the gap between this timestamp and the return visit
     * bounds when playback actually died; the frozen-or-advancing position
     * across consecutive beats shows whether sound survived hiding.
     */
    function recordHeartbeat() {
        if (!controller) return;
        const status = controller.playback.status;
        if (status !== 'playing' && status !== 'paused') return;
        record('heartbeat', {}, { silent: true });
    }

    function previousDescription() {
        if (!previousBreadcrumb) return 'previous=none';
        const playback = previousBreadcrumb.playback;
        const position = playback?.positionSeconds;
        return [
            `previous=${previousBreadcrumb.event}`,
            `previousVisibility=${previousBreadcrumb.visibility || 'unknown'}`,
            `previousOrderlyExit=${previousBreadcrumb.orderlyExit ? 'yes' : 'no'}`,
            `previousApp=${playback?.appStatus || 'unknown'}`,
            `previousYoutube=${youtubeStateName(playback?.youtubeState ?? null)}`,
            `previousVideo=${playback?.videoId || 'none'}`,
            `previousPosition=${typeof position === 'number' ? `${position.toFixed(1)}s` : 'unavailable'}`
        ].join(',');
    }

    /** @param {VoiceMusicController} musicController @param {(text: string) => void} reporter */
    function start(musicController, reporter) {
        if (started) throw new Error('PlayerLifecycle.start called twice');
        controller = musicController;
        report = reporter;
        previousBreadcrumb = SettingsStore.loadJson(
            StorageKeys.PLAYER_LIFECYCLE,
            null,
            isBreadcrumb
        );
        sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        started = true;

        record('session-start', {
            navigation: navigationType(),
            wasDiscarded: discardedState(),
            browser: navigator.userAgent,
            cores: navigator.hardwareConcurrency || 'unknown',
            prior: previousDescription()
        });

        document.addEventListener('visibilitychange', () => {
            record(`visibility-${document.visibilityState}`);
        });
        document.addEventListener('freeze', () => record('freeze'));
        document.addEventListener('resume', () => record('resume'));
        window.addEventListener('pagehide', event => {
            pagehideObserved = true;
            record('pagehide', { persisted: event.persisted });
        });
        window.addEventListener('pageshow', event => {
            record('pageshow', { persisted: event.persisted });
        });
        window.addEventListener('offline', () => record('network-offline'));
        window.addEventListener('online', () => record('network-online'));

        setInterval(recordHeartbeat, HEARTBEAT_MS);
    }

    /** @param {string} intent */
    function recordIntent(intent) {
        record('transport-intent', { intent });
    }

    /** @param {number} state */
    function recordYouTubeState(state) {
        record('youtube-state', {
            state,
            stateName: youtubeStateName(state)
        });
    }

    function recordYouTubeReady() {
        record('youtube-ready');
    }

    /** @param {number | string} code */
    function recordYouTubeError(code) {
        record('youtube-error', { code: String(code) });
    }

    return {
        start,
        recordIntent,
        recordHeartbeat,
        recordYouTubeReady,
        recordYouTubeState,
        recordYouTubeError,
        getPreviousBreadcrumb: () => previousBreadcrumb
    };
})();

window.PlayerLifecycle = PlayerLifecycle;
