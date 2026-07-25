// @ts-check
// Durable playback evidence distinguishes discard/reload from an iframe pause.

const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

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
    await tab.route('https://lrclib.net/**', route => route.fulfill({
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

    // The ?keepAlive=0 necessity experiment: identical Media Session
    // surface with no silent ownership audio ever created.
    const experimentTab = await browser.newPage();
    collectErrors(experimentTab, 'keep-alive-experiment', errors);
    await experimentTab.route('**/iframe_api', route => route.fulfill({
        contentType: 'application/javascript',
        body: 'queueMicrotask(() => window.onYouTubeIframeAPIReady?.());'
    }));
    await experimentTab.route('https://lrclib.net/**', route => route.fulfill({
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

    errors.forEach(error => report.errors.push(error));
    await browser.close();
    report.finish();
})().catch(error => {
    console.error(error);
    process.exit(1);
});
