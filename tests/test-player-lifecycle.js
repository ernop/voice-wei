// @ts-check
// Durable playback evidence distinguishes discard/reload from an iframe pause,
// and an iframe pause on a hidden page that nobody asked for is continued
// once per hidden period.

const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

// A YouTube stand-in that reports states as the IFrame API does: after the
// calling task, in order, and PAUSED first when a load replaces a playing
// video (measured on Android Chrome 155: 2, -1, 3, -1, 3, 1). A load reads
// time 0 until its second UNSTARTED, where the start position applies (a
// reload at 5.74 s read 0 for about 0.3 s). browserPause() is Chrome pausing
// a hidden page's video on its own. afterReport, when set, runs after each
// report, as a progress-clock wake can. quiet() resolves once every report,
// including ones the page's reactions caused, is delivered.
const FAKE_YOUTUBE_API = `(function () {
    window.__youtubeLoads = [];
    class Player {
        constructor(id, opts) {
            this.events = opts.events;
            this.videoId = opts.videoId;
            this.state = 5;
            this.time = 0;
            this.afterReport = null;
            this.pending = Promise.resolve();
            window.__youtubePlayer = this;
            setTimeout(() => this.events.onReady({ target: this }), 0);
        }
        report(...steps) {
            for (const step of steps) {
                this.pending = this.pending.then(() => new Promise(resolve => setTimeout(() => {
                    if (typeof step === 'function') {
                        step();
                    } else {
                        this.state = step;
                        this.events.onStateChange({ target: this, data: step });
                        this.afterReport?.();
                    }
                    resolve();
                }, 0)));
            }
        }
        async quiet() {
            let seen;
            while (seen !== this.pending) {
                seen = this.pending;
                await seen;
            }
        }
        setVolume() {}
        getDuration() { return 200; }
        getCurrentTime() { return this.time; }
        getPlaybackRate() { return 1; }
        getPlayerState() { return this.state; }
        getVideoLoadedFraction() { return 0.5; }
        loadVideoById(id, start = 0) {
            window.__youtubeLoads.push([id, start]);
            const replacingPlaying = this.state === 1;
            this.videoId = id;
            this.time = 0;
            this.report(...(replacingPlaying ? [2] : []), -1, 3, () => { this.time = start; }, -1, 3, 1);
        }
        playVideo() { this.report(3, 1); }
        pauseVideo() { this.report(2); }
        stopVideo() { this.report(5); }
        seekTo(time) { this.time = time; }
        destroy() {}
        browserPause() { this.report(2); }
    }
    window.YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
    queueMicrotask(() => window.onYouTubeIframeAPIReady?.());
})();`;

(async () => {
    const report = createReporter('player lifecycle diagnostics');
    const browser = await launch();
    const tab = await browser.newPage();
    const errors = [];
    collectErrors(tab, 'player-lifecycle', errors);

    await tab.addInitScript(() => {
        if (!location.pathname.endsWith('/player.html')
            || sessionStorage.getItem('voice-wei:lifecycle-test-seeded')) return;
        sessionStorage.setItem('voice-wei:lifecycle-test-seeded', 'yes');
        Object.defineProperty(document, 'wasDiscarded', {
            configurable: true,
            value: true
        });
        localStorage.setItem('voice-wei:player-lifecycle', JSON.stringify({
            sessionId: 'previous-session',
            sequence: 7,
            event: 'visibility-hidden',
            recordedAt: '2026-07-24T22:00:00.000Z',
            visibility: 'hidden',
            hidden: true,
            network: 'online,effective=4g',
            navigationType: 'navigate',
            discarded: 'no',
            playback: {
                appStatus: 'playing',
                videoId: 'previous-video',
                positionSeconds: 73.5,
                youtubeState: 1
            },
            detail: {}
        }));
    });
    await tab.route('**/iframe_api', route => route.fulfill({
        contentType: 'application/javascript',
        body: 'queueMicrotask(() => window.onYouTubeIframeAPIReady?.());'
    }));
    await tab.route(/\/proxy\.php\?.*lyrics=search/, route => route.fulfill({
        contentType: 'application/json',
        body: '[]'
    }));

    await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);

    const startupEvidence = await tab.evaluate(() => {
        const previous = PlayerLifecycle.getPreviousBreadcrumb();
        const lines = Array.from(document.querySelectorAll('#logContent .log-line'))
            .map(line => line.textContent || '');
        return {
            previous,
            diagnostic: lines.find(line => line.includes('Playback diagnostic: event=session-start')) || ''
        };
    });
    report.check('discard startup retains the previous hidden playback breadcrumb',
        startupEvidence.previous?.event === 'visibility-hidden'
        && startupEvidence.previous.playback.appStatus === 'playing'
        && startupEvidence.previous.playback.videoId === 'previous-video'
        && startupEvidence.previous.playback.positionSeconds === 73.5);
    report.check('startup log names discard evidence and prior sounding state',
        startupEvidence.diagnostic.includes('wasDiscarded=yes')
        && startupEvidence.diagnostic.includes('previous=visibility-hidden')
        && startupEvidence.diagnostic.includes('previousApp=playing')
        && startupEvidence.diagnostic.includes('previousYoutube=playing'));

    const pausedUnderPlaying = await tab.evaluate(() => {
        const controller = window.musicController;
        if (!controller) throw new Error('Music controller missing');
        controller.playback.setActiveMedia(77, 'diagnostic-video');
        controller.playback.markPlayerReady(/** @type {any} */ ({
            getCurrentTime: () => 42.5,
            getPlayerState: () => 2
        }));
        controller.playback.markPlaying(77);
        PlayerLifecycle.recordYouTubeState(2);
        const stored = SettingsStore.peekData(StorageKeys.PLAYER_LIFECYCLE);
        const lines = Array.from(document.querySelectorAll('#logContent .log-line'))
            .map(line => line.textContent || '');
        return {
            stored,
            diagnostic: lines.findLast(line => line.includes('event=youtube-state')) || ''
        };
    });
    report.check('YouTube state evidence captures iframe paused while app still claims playing',
        pausedUnderPlaying.stored?.event === 'youtube-state'
        && pausedUnderPlaying.stored.playback.appStatus === 'playing'
        && pausedUnderPlaying.stored.playback.youtubeState === 2
        && pausedUnderPlaying.stored.playback.positionSeconds === 42.5
        && pausedUnderPlaying.diagnostic.includes('youtube=paused(2)'));

    const heartbeatEvidence = await tab.evaluate(() => {
        const logLinesBefore = document.querySelectorAll('#logContent .log-line').length;
        PlayerLifecycle.recordHeartbeat();
        const stored = SettingsStore.peekData(StorageKeys.PLAYER_LIFECYCLE);
        return {
            stored,
            addedLogLines: document.querySelectorAll('#logContent .log-line').length - logLinesBefore
        };
    });
    report.check('heartbeat refreshes the durable breadcrumb without flooding the Log',
        heartbeatEvidence.stored?.event === 'heartbeat'
        && heartbeatEvidence.stored.playback.positionSeconds === 42.5
        && heartbeatEvidence.stored.playback.keepAlive === 'absent'
        && heartbeatEvidence.addedLogLines === 0);

    const pagehideEvidence = await tab.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        return SettingsStore.peekData(StorageKeys.PLAYER_LIFECYCLE);
    });
    report.check('pagehide synchronously leaves an orderly-exit breadcrumb',
        pagehideEvidence?.event === 'pagehide'
        && pagehideEvidence.orderlyExit === true
        && pagehideEvidence.detail.persisted === false
        && pagehideEvidence.playback.videoId === 'diagnostic-video');

    await tab.reload({ waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
    const reloadEvidence = await tab.evaluate(() => {
        const previous = PlayerLifecycle.getPreviousBreadcrumb();
        const lines = Array.from(document.querySelectorAll('#logContent .log-line'))
            .map(line => line.textContent || '');
        return {
            previous,
            diagnostic: lines.find(line => line.includes('Playback diagnostic: event=session-start')) || ''
        };
    });
    report.check('ordinary reload is distinguishable from an unannounced discard',
        reloadEvidence.previous?.orderlyExit === true
        && reloadEvidence.diagnostic.includes('navigation=reload')
        && reloadEvidence.diagnostic.includes('previousOrderlyExit=yes'));

    // Unprompted layout shifts are recorded with the elements that moved,
    // so "the page moved on its own" reports name their culprit.
    const layoutShiftEvidence = await tab.evaluate(async () => {
        const intruder = document.createElement('div');
        intruder.id = 'layoutShiftIntruder';
        intruder.style.cssText = 'height: 320px; background: #123;';
        document.body.prepend(intruder);
        await new Promise(resolve => setTimeout(resolve, 400));
        intruder.remove();
        const lines = Array.from(document.querySelectorAll('#logContent .log-line'))
            .map(line => line.textContent || '');
        return {
            shiftLine: lines.findLast(line => line.includes('event=layout-shift')) || ''
        };
    });
    report.check('unprompted layout shifts are logged with the shifted elements named',
        layoutShiftEvidence.shiftLine.includes('event=layout-shift')
        && layoutShiftEvidence.shiftLine.includes('moved='));

    // Scroll anchoring on the ancestor scrollers converts the page's
    // continuous text mutation (lyric bar wrap, statuses, panel
    // auto-scroll) into unprompted window scrolls; it must stay disabled.
    const anchorGuard = await tab.evaluate(() => ({
        html: getComputedStyle(document.documentElement).overflowAnchor,
        main: getComputedStyle(document.querySelector('main')).overflowAnchor
    }));
    report.check('ancestor scrollers keep scroll anchoring disabled so the reader stays parked',
        anchorGuard.html === 'none' && anchorGuard.main === 'none');

    // The ?keepAlive=0 necessity experiment: identical Media Session
    // surface with no silent ownership audio ever created.
    const experimentTab = await browser.newPage();
    collectErrors(experimentTab, 'keep-alive-experiment', errors);
    await experimentTab.route('**/iframe_api', route => route.fulfill({
        contentType: 'application/javascript',
        body: 'queueMicrotask(() => window.onYouTubeIframeAPIReady?.());'
    }));
    await experimentTab.route(/\/proxy\.php\?.*lyrics=search/, route => route.fulfill({
        contentType: 'application/json',
        body: '[]'
    }));
    await experimentTab.goto(`${BASE_URL}/player.html?keepAlive=0`, { waitUntil: 'domcontentloaded' });
    await experimentTab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
    const experiment = await experimentTab.evaluate(async () => {
        document.body.click();
        await MediaSessionCore.activate();
        MediaSessionCore.setPlaybackState('playing');
        MediaSessionCore.updateMetadata('Experiment line');
        return {
            keepAliveState: MediaSessionCore.getKeepAliveState(),
            audioElements: document.querySelectorAll('audio').length,
            mediaSessionState: MediaSessionCore.getPlaybackState()
        };
    });
    report.check('keepAlive=0 publishes the full session surface with zero audio elements',
        experiment.keepAliveState === 'disabled'
        && experiment.audioElements === 0
        && experiment.mediaSessionState === 'playing');

    // Background continuation. Chrome on Android pauses a hidden page's
    // video and re-pauses the same media player whenever script resumes it;
    // the transport reloads the video at the paused position, once per
    // hidden period, and never answers its own pauses, song changes, a
    // visible page, or an OS audio-focus loss that way.
    const continuationTab = await browser.newPage();
    collectErrors(continuationTab, 'background-continuation', errors);
    await continuationTab.route('**/iframe_api', route => route.fulfill({
        contentType: 'application/javascript',
        body: FAKE_YOUTUBE_API
    }));
    await continuationTab.route(/\/proxy\.php\?.*lyrics=search/, route => route.fulfill({
        contentType: 'application/json',
        body: '[]'
    }));
    await continuationTab.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204, body: '' }));
    await continuationTab.goto(`${BASE_URL}/player.html`, { waitUntil: 'domcontentloaded' });
    await continuationTab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
    const continuation = await continuationTab.evaluate(async () => {
        const c = window.musicController;
        if (!c) throw new Error('Music controller missing');
        /** @param {DocumentVisibilityState} state */
        const setVisibility = state => {
            Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
            Object.defineProperty(document, 'hidden', { value: state === 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        };
        const continuationLines = () => Array.from(document.querySelectorAll('#logContent .log-line'))
            .map(line => line.textContent || '')
            .filter(line => line.includes('event=background-continuation'));
        /** @param {() => void | Promise<void>} act */
        const step = async act => {
            const loadsBefore = window.__youtubeLoads.length;
            const linesBefore = continuationLines().length;
            await act();
            await window.__youtubePlayer.quiet();
            return {
                loads: window.__youtubeLoads.slice(loadsBefore),
                lines: continuationLines().slice(linesBefore)
            };
        };

        c.appendPlaylistItems(['continueAAA', 'continueBBB'].map((videoId, index) => PlayerSongs.createPlaylistItem({
            videoId,
            name: `Song ${index + 1}`,
            artist: 'Lifecycle Test',
            duration: '3:20'
        }, { sourceKind: 'search', sourceLabel: 'Lifecycle test' })));
        await c.playVideo(c.playlist[0]);
        const player = window.__youtubePlayer;
        await player.quiet();
        const keepAlive = /** @type {HTMLAudioElement} */ (document.querySelector('audio[data-media-session-keep-alive]'));

        // The progress clock wakes after every report of the reload, and
        // whatever it sends the lock screen and car is recorded.
        player.time = 42.5;
        const realSetPositionState = navigator.mediaSession.setPositionState.bind(navigator.mediaSession);
        const reloadPositions = [];
        navigator.mediaSession.setPositionState = state => {
            if (state) reloadPositions.push(state.position);
            return realSetPositionState(state);
        };
        player.afterReport = () => c.scheduleNextProgressRender();
        const hiddenPause = await step(() => { setVisibility('hidden'); player.browserPause(); });
        player.afterReport = null;
        navigator.mediaSession.setPositionState = realSetPositionState;
        const renderedAfterReload = c.renderPlaybackPosition();
        const repeatedPause = await step(() => player.browserPause());

        // Shown again, Chrome resumes the video it paused for hiding.
        setVisibility('visible');
        await step(() => player.playVideo());
        const hiddenSongChange = await step(() => { setVisibility('hidden'); c.playNext(); });
        player.time = 12.25;
        const pauseAfterSongChange = await step(() => player.browserPause());

        setVisibility('visible');
        const focusLoss = await step(() => { setVisibility('hidden'); keepAlive.pause(); player.browserPause(); });

        // The OS pauses both; a lyric push re-arms the keep-alive before
        // YouTube's report of its own pause arrives.
        setVisibility('visible');
        await keepAlive.play();
        await step(() => player.playVideo());
        const rearmedFocusLoss = await step(async () => {
            setVisibility('hidden');
            const paused = new Promise(resolve => keepAlive.addEventListener('pause', resolve, { once: true }));
            keepAlive.pause();
            await paused;
            await keepAlive.play();
            player.browserPause();
        });

        setVisibility('visible');
        await step(() => player.playVideo());
        const ownPause = await step(() => { setVisibility('hidden'); c.pausePlayback(); });
        await step(() => c.playPlaylist());
        const playingBeforeVisiblePause = c.isPlaying && player.getPlayerState() === 1;
        setVisibility('visible');
        const visiblePause = await step(() => player.browserPause());

        return {
            hiddenPause,
            reloadPositions,
            renderedAfterReload,
            repeatedPause,
            hiddenSongChange,
            pauseAfterSongChange,
            focusLoss,
            rearmedFocusLoss,
            ownPause,
            visiblePause,
            playingBeforeVisiblePause
        };
    });
    const loadsText = /** @param {Array<[string, number]>} loads */ loads => JSON.stringify(loads);
    report.check(`a pause nobody asked for on a hidden page reloads the video at the paused position (${loadsText(continuation.hiddenPause.loads)})`,
        loadsText(continuation.hiddenPause.loads) === '[["continueAAA",42.5]]'
        && continuation.hiddenPause.lines.length === 1
        && continuation.hiddenPause.lines[0].includes('outcome=reloaded')
        && continuation.hiddenPause.lines[0].includes('visibility=hidden'));
    report.check(`while the reload reads time 0, no position but the song's reaches the media session, and the clock renders again once it plays (${JSON.stringify(continuation.reloadPositions)}, then ${continuation.renderedAfterReload})`,
        continuation.reloadPositions.every(position => position === 42.5)
        && continuation.renderedAfterReload === 42.5);
    report.check('a second pause in the same hidden period stands and is logged',
        continuation.repeatedPause.loads.length === 0
        && continuation.repeatedPause.lines.length === 1
        && continuation.repeatedPause.lines[0].includes('reason=already-continued-this-hidden-period'));
    report.check(`a hidden song change loads once: the PAUSED for the replaced video is not continued (${loadsText(continuation.hiddenSongChange.loads)})`,
        loadsText(continuation.hiddenSongChange.loads) === '[["continueBBB",0]]'
        && continuation.hiddenSongChange.lines.length === 0);
    report.check(`the song change left that hidden period its continuation (${loadsText(continuation.pauseAfterSongChange.loads)})`,
        loadsText(continuation.pauseAfterSongChange.loads) === '[["continueBBB",12.25]]');
    report.check('a paused keep-alive (OS audio focus taken) leaves the pause standing and logs why',
        continuation.focusLoss.loads.length === 0
        && continuation.focusLoss.lines.length === 1
        && continuation.focusLoss.lines[0].includes('outcome=declined')
        && continuation.focusLoss.lines[0].includes('reason=keep-alive-paused'));
    report.check('a keep-alive paused and re-armed before YouTube reports its pause still leaves that pause standing',
        continuation.rearmedFocusLoss.loads.length === 0
        && continuation.rearmedFocusLoss.lines.length === 1
        && continuation.rearmedFocusLoss.lines[0].includes('reason=keep-alive-interrupted'));
    report.check('the app\'s own pause and a pause on a visible page are never continued',
        continuation.ownPause.loads.length === 0
        && continuation.ownPause.lines.length === 0
        && continuation.playingBeforeVisiblePause
        && continuation.visiblePause.loads.length === 0
        && continuation.visiblePause.lines.length === 0);

    errors.forEach(error => report.errors.push(error));
    await browser.close();
    report.finish();
})().catch(error => {
    console.error(error);
    process.exit(1);
});
