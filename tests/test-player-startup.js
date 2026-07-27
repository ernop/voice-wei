// @ts-check
// Lyrics startup has one named readiness contract and a one-second budget.

const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

const STARTUP_BUDGET_MS = 1000;
const RESTORED_PLAYLIST_SIZE = 883;

(async () => {
    const report = createReporter('player startup');
    const browser = await launch();
    const tab = await browser.newPage();
    const errors = [];
    collectErrors(tab, 'player-startup', errors);

    let toneRequests = 0;
    await tab.route('**/iframe_api', route => route.fulfill({
        contentType: 'application/javascript',
        body: 'queueMicrotask(() => window.onYouTubeIframeAPIReady?.());'
    }));
    await tab.route('**/Tone.js', route => {
        toneRequests++;
        return route.fulfill({
            contentType: 'application/javascript',
            body: `
                window.Tone = {
                    context: { state: 'suspended' },
                    start: async () => { window.Tone.context.state = 'running'; }
                };
            `
        });
    });
    await tab.route('https://lrclib.net/**', route => route.fulfill({
        contentType: 'application/json',
        body: '[]'
    }));

    await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);

    const cold = await startupSnapshot(tab);
    const expectedPhases = [
        'controller construction and stored settings',
        'configuration and API key state',
        'UI and voice control wiring',
        'lyrics view settings',
        'YouTube API readiness wiring',
        'local song library hydration',
        'favorite lyrics reconciliation scheduling',
        'saved playlist restoration',
        'favorite video identity repair scheduling',
        'demo request',
        'application initialization'
    ];
    report.check(`cold player is ready within ${STARTUP_BUDGET_MS}ms (${cold.readyAtMs}ms)`,
        cold.readyAtMs <= STARTUP_BUDGET_MS && cold.withinBudget);
    report.check('startup report names every initialization phase',
        expectedPhases.every(name => cold.phaseNames.includes(name)));
    report.check('startup report includes navigation and per-resource costs',
        cold.navigation.totalReadyMs === cold.readyAtMs
        && cold.resources.some(resource => resource.name.startsWith('player.js')));
    report.check('Tone.js is absent from the startup path',
        !cold.resources.some(resource => resource.name.includes('Tone.js')) && toneRequests === 0);
    report.check('startup timing is written to the in-app log', cold.hasStartupLog);

    await tab.evaluate((count) => {
        const entries = Array.from({ length: count }, (_, index) => {
            const item = PlayerSongs.createPlaylistItem({
                videoId: `startup-video-${index}`,
                name: `Startup Song ${index}`,
                artist: `Startup Artist ${index}`,
                year: '2026',
                album: 'Startup Test',
                title: `Startup Artist ${index} - Startup Song ${index}`,
                channelTitle: `Startup Artist ${index}`,
                duration: '3:00',
                durationSeconds: 180,
                comment: '',
                searchTerm: `Startup Artist ${index} Startup Song ${index}`
            }, {
                sourceKind: 'restored',
                sourceLabel: 'Startup test'
            });
            if (!item) throw new Error(`Could not create startup song ${index}`);
            return PlayerSongs.persistedPlaylistEntry(item);
        });
        PlayerStorage.savePlaylist(entries, 0);
        PlayerStorage.saveFavorites(Object.fromEntries(entries.map(entry => [
            entry.videoId,
            { ...entry, favoritedAt: Date.now() }
        ])));
    }, RESTORED_PLAYLIST_SIZE);

    await tab.reload({ waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
    const restored = await startupSnapshot(tab);
    const restorePhase = restored.phases.find(phase => phase.name === 'saved playlist restoration');
    const favoritesPhase = restored.phases.find(phase => phase.name === 'favorite lyrics reconciliation scheduling');
    report.check(
        `${RESTORED_PLAYLIST_SIZE}-song restore remains within ${STARTUP_BUDGET_MS}ms (${restored.readyAtMs}ms)`,
        restored.readyAtMs <= STARTUP_BUDGET_MS && restored.playlistSize === RESTORED_PLAYLIST_SIZE
    );
    report.check('playlist restore timing records restored song count',
        restorePhase?.detail.songs === RESTORED_PLAYLIST_SIZE);
    report.check('startup coverage reconciles the observed favorite-library scale',
        favoritesPhase?.detail.favorites === RESTORED_PLAYLIST_SIZE);

    await tab.evaluate(() => PianoCore.ensureStarted());
    report.check('first local-library audio intent loads Tone.js exactly once',
        toneRequests === 1 && await tab.evaluate(() => window.Tone?.context.state === 'running'));

    errors.forEach(error => report.errors.push(error));
    await browser.close();
    report.finish();
})().catch(error => {
    console.error(error);
    process.exit(1);
});

/** @param {import('playwright').Page} tab */
async function startupSnapshot(tab) {
    return tab.evaluate(() => {
        const startup = window.__voiceWeiStartup;
        if (!startup?.report) throw new Error('Startup report missing');
        return {
            ...startup.report,
            phaseNames: startup.report.phases.map(phase => phase.name),
            playlistSize: window.musicController?.playlist.length || 0,
            hasStartupLog: Array.from(document.querySelectorAll('#logContent .log-line'))
                .some(line => line.textContent?.includes('Startup: Ready in'))
        };
    });
}
