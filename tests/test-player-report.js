// @ts-check
// player report and media session product behavior, extracted from the retired tab-functions monolith.

const { BASE_URL, launchWithMic, collectErrors, instrumentVoices, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('player report and media session');
    const browser = await launchWithMic();
    // ============ PLAYER VOICE: shared core drives commands and music requests ============
    {
        const ctx = await browser.newContext();
        await ctx.route('https://i.ytimg.com/**', route => route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
        }));
        // Fake key (long enough to pass the gate) and a controllable fake
        // SpeechRecognition, installed before page scripts run.
        await ctx.addInitScript(() => {
            localStorage.setItem('claudeApiKey', 'test-key-not-real-1234567890');
            window.__recs = [];
            class FakeSpeechRecognition {
                constructor() {
                    window.__recs.push(this);
                    this.continuous = false;
                    this.interimResults = false;
                    this.lang = '';
                    // Real engines keep a growing per-session result list and
                    // re-send it in every event; the fakes must do the same.
                    this._results = [];
                }
                start() { this._results = []; this.onstart && this.onstart(); }
                stop() { this.onend && this.onend(); }
                abort() { this.onend && this.onend(); }
            }
            // Desktop pattern: each utterance appends a new result index.
            window.__emitResult = (text, isFinal = true) => {
                const rec = window.__recs[window.__recs.length - 1];
                const result = [{ transcript: text }];
                result.isFinal = isFinal;
                rec._results.push(result);
                rec.onresult({ resultIndex: rec._results.length - 1, results: rec._results });
            };
            // Android pattern: the SAME index is re-sent with grown
            // cumulative text, repeatedly marked final.
            window.__emitCumulative = (text, isFinal = true) => {
                const rec = window.__recs[window.__recs.length - 1];
                const result = [{ transcript: text }];
                result.isFinal = isFinal;
                const index = Math.max(0, rec._results.length - 1);
                rec._results[index] = result;
                rec.onresult({ resultIndex: index, results: rec._results });
            };
            window.SpeechRecognition = FakeSpeechRecognition;
            window.webkitSpeechRecognition = FakeSpeechRecognition;
            // Claude is unreachable in tests; fail fast so the flow resolves
            const realFetch = window.fetch.bind(window);
            window.fetch = (url, ...rest) => {
                if (String(url).includes('anthropic')) return Promise.reject(new Error('offline test'));
                return realFetch(url, ...rest);
            };
        });
        const tab = await ctx.newPage();
        // The manual-mode request intentionally fails at the stubbed Claude
        // fetch; those logged errors are expected.
        /** @type {string[]} */
        const playerVoiceErrors = [];
        collectErrors(tab, 'player-voice', playerVoiceErrors);
        await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'domcontentloaded' });
        await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);

        const lyricRelay = await tab.evaluate(() => {
            const item = {
                id: 77, videoId: 'test-video', name: 'Test Song', artist: 'Test Artist', year: '1999', album: 'Test Album',
                lyricsStatus: 'ready',
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Test Song', artistName: 'Test Artist',
                    albumName: '', duration: 100, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:12.00]late first line\n[00:15.00]second line here',
                    syncedLines: [
                        { time: 12, text: 'late first line' },
                        { time: 15, text: 'second line here' }
                    ]
                }
            };
            const harness = {
                settings: { lyricsOnNowPlaying: true, songDisplayMode: 'identity', songReportIntervalSeconds: 8 },
                playlist: [item],
                playback: { player: null },
                currentLyricsItemId: 77,
                currentLyricsLineIndex: -1,
                nowPlayingShowsText: false,
                isPlaying: true,
                isPaused: false,
                currentPlayingId: 77,
                currentPlaylistItem() { return item; }
            };
            PlayerSongReport.install(harness);
            PlayerLyrics.install(harness);
            MediaSessionCore.setTrackIdentity({
                id: item.videoId,
                title: item.name,
                artist: harness.describeNowPlayingArtist(item),
                album: item.album,
                artwork: [{
                    src: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                    sizes: '480x360',
                    type: 'image/jpeg'
                }]
            });
            const meta = () => navigator.mediaSession.metadata;
            const snap = () => ({
                docTitle: document.title,
                headerTitle: document.querySelector('#siteHeader h1')?.textContent || '',
                metaTitle: meta() ? meta().title : '',
                metaArtist: meta() ? meta().artist : '',
                metaAlbum: meta() ? meta().album : '',
                artwork: meta()?.artwork[0]?.src || '',
                barLyric: document.getElementById('transportBarLyric')?.textContent || '',
                highlightIndex: harness.currentLyricsLineIndex
            });
            // 0.5s: the song identity intro - who and what is playing.
            harness.updateListeningTextPosition(0.5);
            const identity = snap();
            // 3s: first line is 9s away (>5s from song start), so the
            // title counts down in front of the upcoming line.
            harness.updateListeningTextPosition(3);
            const countdown = snap();
            // 11.5s: line 1 (at 12s) not sung yet but inside the title
            // lead window - the title runs ahead of the highlight.
            harness.updateListeningTextPosition(11.5);
            const led = snap();
            harness.updateListeningTextPosition(13);
            const during = snap();
            harness.isPaused = true;
            MediaSessionCore.setPlaybackState('paused');
            const after = snap();
            harness.updateTransportBarLyric('');
            MediaSessionCore.clearTrack();
            return { identity, countdown, led, during, after };
        });
        const identityText = 'Test Artist - Test Song - 1999 - Test Album';
        const artistLine = '1999 - Test Artist - Test Song';
        const titleCleanPastIntro = [lyricRelay.countdown, lyricRelay.led, lyricRelay.during, lyricRelay.after]
            .every(snap => !snap.metaTitle.includes('Test Song') && !snap.docTitle.includes('Test Song'));
        const artistLineWhilePlaying = [lyricRelay.identity, lyricRelay.countdown, lyricRelay.led, lyricRelay.during]
            .every(snap => snap.metaArtist === artistLine);
        const stableTrackFields = [lyricRelay.identity, lyricRelay.countdown, lyricRelay.led, lyricRelay.during, lyricRelay.after]
            .every(snap => snap.metaAlbum === 'Test Album'
                && snap.artwork.endsWith('/test-video/hqdefault.jpg'));
        report.check(`player titles: identity intro, countdown, then lyric + stable track identity ("${lyricRelay.identity.metaTitle}" / "${lyricRelay.identity.metaArtist}" -> "${lyricRelay.countdown.metaTitle}" -> "${lyricRelay.led.metaTitle}")`,
            lyricRelay.identity.metaTitle === identityText
            && lyricRelay.identity.docTitle === identityText
            && lyricRelay.identity.headerTitle === identityText
            && lyricRelay.identity.barLyric === identityText
            && lyricRelay.identity.highlightIndex === -1
            && lyricRelay.countdown.metaTitle === '9 late first line'
            && lyricRelay.countdown.barLyric === '9 late first line'
            && lyricRelay.led.metaTitle === 'late first line'
            && lyricRelay.led.docTitle === 'late first line'
            && lyricRelay.led.headerTitle === 'late first line'
            && lyricRelay.led.highlightIndex === -1
            && lyricRelay.during.metaTitle === 'late first line'
            && lyricRelay.during.barLyric === 'late first line'
            && lyricRelay.during.highlightIndex === 0
            && lyricRelay.after.metaTitle === 'late first line'
            && lyricRelay.after.metaArtist === artistLine
            && lyricRelay.after.docTitle === 'late first line'
            && lyricRelay.after.headerTitle === 'late first line'
            && titleCleanPastIntro
            && artistLineWhilePlaying
            && stableTrackFields);

        // The sticky bar must never change height mid-track: lyric gaps and
        // blank lines empty a row's text, but the row's box holds until a
        // real track boundary releases it. A sticky bar that grows/shrinks
        // shoves the whole page under a reader scrolled below it.
        const stickyBarStability = await tab.evaluate(() => {
            const harness = {};
            PlayerLyrics.install(harness);
            const lyricRow = document.getElementById('transportBarLyric');
            const secondaryRow = document.getElementById('transportBarSecondary');
            harness.resetTransportBarText();

            harness.updateTransportBarLyric('sung line');
            const shown = { display: lyricRow.style.display, text: lyricRow.textContent };
            harness.updateTransportBarLyric('');
            const gap = { display: lyricRow.style.display, text: lyricRow.textContent };
            harness.updateTransportBarLyric('next line');
            const resumed = { display: lyricRow.style.display, text: lyricRow.textContent };

            // A row that never showed text this track must not appear.
            harness.updateTransportBarSecondary('');
            const neverShown = { display: secondaryRow.style.display, text: secondaryRow.textContent };

            harness.resetTransportBarText();
            const afterBoundary = {
                lyricDisplay: lyricRow.style.display,
                lyricText: lyricRow.textContent,
                holdReleased: lyricRow.dataset.holdsSpace === undefined
            };
            return { shown, gap, resumed, neverShown, afterBoundary };
        });
        report.check('sticky bar rows hold their box through lyric gaps and collapse only at track boundaries',
            stickyBarStability.shown.display === 'block'
            && stickyBarStability.shown.text === 'sung line'
            && stickyBarStability.gap.display === 'block'
            && stickyBarStability.gap.text === '\u00A0'
            && stickyBarStability.resumed.text === 'next line'
            && stickyBarStability.neverShown.display === 'none'
            && stickyBarStability.neverShown.text === ''
            && stickyBarStability.afterBoundary.lyricDisplay === 'none'
            && stickyBarStability.afterBoundary.lyricText === ''
            && stickyBarStability.afterBoundary.holdReleased);

        // A reader scrolling the lyric panel owns its position: the
        // auto-centering highlight yields for the holdoff window, then
        // resumes following the song.
        const lyricScrollGuard = await tab.evaluate(async () => {
            const harness = { currentLyricsLineIndex: -1 };
            PlayerLyrics.install(harness);
            const realContainer = document.getElementById('lyricsContent');
            if (realContainer) realContainer.id = 'lyricsContentParked';
            const container = document.createElement('div');
            container.id = 'lyricsContent';
            container.className = 'lyrics-content';
            container.style.cssText = 'height: 100px; max-height: 100px; overflow-y: auto;';
            for (let i = 0; i < 60; i++) {
                const line = document.createElement('div');
                line.className = 'lyrics-line';
                line.style.cssText = 'height: 20px;';
                line.textContent = `line ${i}`;
                container.appendChild(line);
            }
            document.body.appendChild(container);
            try {
                harness.applyActiveLyricsLine(30, true);
                const autoCentered = container.scrollTop;

                container.dispatchEvent(new WheelEvent('wheel'));
                container.scrollTop = 5;
                harness.applyActiveLyricsLine(35);
                await new Promise(resolve => setTimeout(resolve, 250));
                const whileReading = container.scrollTop;

                container.dataset.userScrollUntil = String(Date.now() - 1);
                harness.applyActiveLyricsLine(40);
                await new Promise(resolve => setTimeout(resolve, 400));
                const afterHoldoff = container.scrollTop;

                return { autoCentered, whileReading, afterHoldoff };
            } finally {
                container.remove();
                if (realContainer) realContainer.id = 'lyricsContent';
            }
        });
        report.check(`lyric panel auto-centering yields to a reading scroll and resumes after the holdoff (${lyricScrollGuard.autoCentered} -> ${lyricScrollGuard.whileReading} -> ${lyricScrollGuard.afterHoldoff})`,
            lyricScrollGuard.autoCentered > 0
            && lyricScrollGuard.whileReading === 5
            && lyricScrollGuard.afterHoldoff > 100);

        // A requested report is web-grounded through the selected provider
        // and returns short notes: lyric-anchored notes play at their line's
        // sung moment, general notes fill the gaps, and a 0.2s blank
        // separates consecutive notes on the in-page second line.
        const songReport = await tab.evaluate(async () => {
            const originalFetch = window.fetch;
            const requests = [];
            const commandLogs = [];
            const commandHarness = {
                settings: {
                    aiProvider: 'openai',
                    openaiModel: 'gpt-5.5',
                    claudeModel: 'claude-opus-4-8'
                },
                config: { openaiApiKey: 'test-openai-key', claudeApiKey: 'test-claude-key' },
                addMessage(type, label, text) {
                    commandLogs.push({ type, label, text });
                }
            };
            PlayerCommands.install(commandHarness);
            window.fetch = async (url, options) => {
                requests.push({ url: String(url), body: JSON.parse(String(options?.body || '{}')) });
                if (String(url).includes('openai.com')) {
                    return new Response(JSON.stringify({ status: 'completed', output_text: 'OpenAI researched report.' }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return new Response(JSON.stringify({
                    stop_reason: 'end_turn',
                    content: [{ type: 'text', text: 'Claude researched report.' }]
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            };

            const openai = await commandHarness.requestSongReportResearch('research this song');
            commandHarness.settings.aiProvider = 'claude';
            const claude = await commandHarness.requestSongReportResearch('research this song');
            window.fetch = originalFetch;

            const item = {
                id: 778,
                videoId: `song-report-${Date.now()}`,
                name: 'Report Song',
                artist: 'Report Artist',
                year: '2001',
                album: 'Report Album',
                comment: 'A useful seed',
                durationSeconds: 180,
                lyricsStatus: 'ready',
                lyricOffsetSeconds: 0,
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Report Song', artistName: 'Report Artist',
                    albumName: 'Report Album', duration: 180, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:00.00]lyric line\n[01:00.00]second verse line',
                    syncedLines: [
                        { time: 0, text: 'lyric line' },
                        { time: 60, text: 'second verse line' }
                    ]
                }
            };
            const harness = {
                settings: {
                    lyricsOnNowPlaying: true,
                    songDisplayMode: 'report',
                    songReportIntervalSeconds: 8
                },
                playlist: [item],
                playback: { player: { getCurrentTime() { return 0; } } },
                currentLyricsItemId: item.id,
                currentLyricsLineIndex: -1,
                nowPlayingShowsText: false,
                isPlaying: true,
                isPaused: false,
                currentPlayingId: item.id,
                saveSettings() {},
                resyncProgressClock() {},
                updateStatus() {},
                truncateForStatus(value) { return String(value); },
                describePlaylistItem() { return 'Report Artist - Report Song'; },
                logError() {},
                showApiKeyProblem() {},
                currentPlaylistItem() { return item; }
            };
            PlayerSongReport.install(harness);
            PlayerLyrics.install(harness);

            const prompt = harness.buildSongReportPrompt(item);
            const parsedEntries = harness.parseSongReportResponse(JSON.stringify({
                lyricNotes: [
                    { line: 2, note: 'The second verse turns the hook into a response.' },
                    { line: 99, note: 'This line number does not exist.' }
                ],
                generalNotes: ['The vocals and rhythm were recorded live.'],
                attributions: ['Example Review: second-verse reading']
            }), item);
            // The display boundary strips citations and URLs that slip
            // past the prompt; citation-only notes vanish from display.
            const sanitizedEntries = harness.parseSongReportResponse(JSON.stringify({
                lyricNotes: [
                    { line: 1, note: 'The [opening line](https://example.com/analysis) sets the scene [2].' }
                ],
                generalNotes: [
                    'The producer described the take at rollingstone.com/interview as unplanned.',
                    'See https://example.com/full-review',
                    'Sales climbed after the tour (www.billboard.com).'
                ]
            }), item);
            const record = {
                videoId: item.videoId,
                generatedAt: Date.now(),
                provider: 'openai',
                model: 'gpt-5.5',
                prompt,
                reportText: 'raw JSON response',
                entries: [
                    { time: 60, text: 'The second verse turns the hook into a response.' },
                    { time: null, text: 'The vocals and rhythm were recorded live.' }
                ]
            };
            await window.PlayerHistoryDB.putSongReport(record);
            harness.songReports.set(item.videoId, record);
            harness.songReportAnchorVideoId = item.videoId;
            harness.songReportAnchorTime = 0;
            // Anchored note at 60s; the general note lands in the largest
            // gap (60..180), so at 120s.
            const schedule = harness.songReportSchedule(item);

            MediaSessionCore.setTrackIdentity({
                id: item.videoId,
                title: item.name,
                artist: harness.describeNowPlayingArtist(item),
                album: item.album,
                artwork: []
            });
            const snap = time => {
                harness.updateListeningTextPosition(time);
                return {
                    title: navigator.mediaSession.metadata?.title || '',
                    artist: navigator.mediaSession.metadata?.artist || '',
                    barPrimary: document.getElementById('transportBarLyric')?.textContent || '',
                    barSecondary: document.getElementById('transportBarSecondary')?.textContent || ''
                };
            };
            const beforeNotes = snap(3);
            const atAnchoredNote = snap(60);
            const blankBetweenNotes = snap(120.1);
            const blankRowOpen = document.getElementById('transportBarSecondary')?.style.display || '';
            const atGeneralNote = snap(121);
            const deadlines = {
                toAnchored: harness.nextSongReportDeadline(0),
                toGeneral: harness.nextSongReportDeadline(60.05),
                toBlankEnd: harness.nextSongReportDeadline(120.05)
            };
            const stored = await window.PlayerHistoryDB.getSongReport(item.videoId);

            harness.settings.songDisplayMode = 'identity';
            const identityAgain = snap(60);

            // Records saved before timed notes migrate to untimed entries and
            // keep the interval-advancing behavior, down to 0.5s per line.
            await window.PlayerHistoryDB.putSongReport({
                videoId: item.videoId,
                generatedAt: Date.now(),
                provider: 'openai',
                model: 'gpt-5.5',
                prompt,
                reportText: 'legacy prose',
                lines: ['legacy one', 'legacy two']
            });
            harness.songReports.delete(item.videoId);
            const migrated = await harness.loadSongReportForItem(item);
            harness.settings.songDisplayMode = 'report';
            harness.songReportAnchorVideoId = item.videoId;
            harness.songReportAnchorTime = 0;
            harness.settings.songReportIntervalSeconds = 0.5;
            const halfSecondFirst = snap(0.49);
            const halfSecondBlank = snap(0.55);
            const halfSecondSecond = snap(0.75);
            const halfSecondDeadline = harness.nextSongReportDeadline(0);
            harness.settings.songReportIntervalSeconds = 8;
            harness.settings.songDisplayMode = 'identity';
            MediaSessionCore.clearTrack();
            await window.PlayerHistoryDB.putSongReport(record);

            const controller = window.musicController;
            const originalIndex = controller.currentPlaylistIndex;
            const originalMode = controller.settings.songDisplayMode;
            const originalInterval = controller.settings.songReportIntervalSeconds;
            controller.playlist.push(item);
            controller.currentPlaylistIndex = controller.playlist.length - 1;
            controller.songReports.set(item.videoId, record);
            controller.updateCentralPlayer(item);
            controller.updateSongReportControls();
            document.getElementById('songDisplayReportBtn')?.click();
            document.getElementById('songReportIntervalUpBtn')?.click();
            const afterUp = document.getElementById('songReportIntervalValue')?.textContent || '';
            document.getElementById('songReportIntervalDownBtn')?.click();
            const controls = {
                reportSelected: document.getElementById('songDisplayReportBtn')?.classList.contains('selected') || false,
                identitySelected: document.getElementById('songDisplayIdentityBtn')?.classList.contains('selected') || false,
                reportDisabled: /** @type {HTMLButtonElement | null} */ (document.getElementById('songDisplayReportBtn'))?.disabled,
                requestLabel: document.getElementById('requestSongReportBtn')?.textContent || '',
                status: document.getElementById('songReportStatus')?.textContent || '',
                afterUp,
                afterDown: document.getElementById('songReportIntervalValue')?.textContent || '',
                minimum: '',
                noReportFallsBackToIdentity: false
            };
            for (let index = 0; index < 20; index++) {
                document.getElementById('songReportIntervalDownBtn')?.click();
            }
            controls.minimum = document.getElementById('songReportIntervalValue')?.textContent || '';
            controller.songReports.delete(item.videoId);
            controller.updateSongReportControls();
            controls.noReportFallsBackToIdentity =
                document.getElementById('songDisplayIdentityBtn')?.classList.contains('selected') || false;
            controller.playlist.pop();
            controller.currentPlaylistIndex = originalIndex;
            controller.settings.songDisplayMode = originalMode;
            controller.settings.songReportIntervalSeconds = originalInterval;
            controller.saveSettings();
            controller.updateCentralPlayer(controller.currentPlaylistItem());
            controller.updateSongReportControls();

            const requestItem = {
                ...item,
                id: 779,
                videoId: `missing-song-report-${Date.now()}`,
                name: 'Missing Report Song'
            };
            const lifecycleLogs = [];
            let resolveResearch = /** @type {((result: { text: string, provider: 'openai', model: string }) => void) | null} */ (null);
            let researchCalls = 0;
            const requestHarness = {
                settings: {
                    lyricsOnNowPlaying: true,
                    songDisplayMode: 'identity',
                    songReportIntervalSeconds: 8,
                    aiProvider: 'openai',
                    openaiModel: 'gpt-5.5',
                    claudeModel: 'claude-opus-4-8'
                },
                config: { openaiApiKey: 'test-openai-key' },
                currentPlayingId: requestItem.id,
                saveSettings() {},
                resyncProgressClock() {},
                updateStatus() {},
                truncateForStatus(value) { return String(value); },
                describePlaylistItem(target) { return `${target.artist} - ${target.name}`; },
                addMessage(type, label, text) {
                    lifecycleLogs.push({ type, label, text: String(text) });
                },
                logError(label, error) {
                    lifecycleLogs.push({
                        type: 'error',
                        label,
                        text: error instanceof Error ? error.message : String(error)
                    });
                },
                showApiKeyProblem() {},
                playingPlaylistItem() { return null; },
                currentPlaylistItem() { return requestItem; },
                currentPlaybackTime() { return 42; },
                updateListeningTextPosition() {},
                ensureLyricsForItem() { return Promise.resolve(requestItem.lyricsData); },
                requestSongReportResearch() {
                    researchCalls++;
                    return new Promise(resolve => {
                        resolveResearch = resolve;
                    });
                }
            };
            PlayerSongReport.install(requestHarness);
            requestHarness.loadSongReportForItem = async () => null;
            requestHarness.updateSongReportControls();
            const idleLabel = document.getElementById('songDisplayReportBtn')?.textContent || '';

            const originalActivate = controller.activateSongReport;
            let activationPromise = Promise.resolve();
            controller.activateSongReport = function () {
                activationPromise = requestHarness.activateSongReport();
                return activationPromise;
            };
            const songReportButton = /** @type {HTMLButtonElement} */ (
                document.getElementById('songDisplayReportBtn')
            );
            songReportButton.disabled = false;
            songReportButton.click();
            await Promise.resolve();
            await Promise.resolve();
            if (!resolveResearch) throw new Error('Song Report did not start a missing-report request');

            requestHarness.songReportRequestState = {
                ...requestHarness.songReportRequestState,
                elapsedMs: 3200
            };
            requestHarness.updateSongReportControls();
            const waiting = {
                reportButton: document.getElementById('songDisplayReportBtn')?.textContent || '',
                requestButton: document.getElementById('requestSongReportBtn')?.textContent || '',
                status: document.getElementById('songReportStatus')?.textContent || ''
            };

            const returnedJson = JSON.stringify({
                lyricNotes: [{ line: 1, note: 'The opening lyric establishes the central refrain.' }],
                generalNotes: ['The performance was recorded live in one take.'],
                attributions: ['Example Archive: live-session account']
            });
            resolveResearch({ text: returnedJson, provider: 'openai', model: 'gpt-5.5' });
            await activationPromise;
            const completedRecord = requestHarness.songReportForItem(requestItem);
            const completed = {
                reportButton: document.getElementById('songDisplayReportBtn')?.textContent || '',
                status: document.getElementById('songReportStatus')?.textContent || '',
                mode: requestHarness.settings.songDisplayMode,
                anchor: requestHarness.songReportAnchorTime,
                returnedText: completedRecord?.reportText || '',
                entries: completedRecord?.entries || [],
                logLabels: lifecycleLogs.map(entry => entry.label)
            };
            const missingKeyLogStart = lifecycleLogs.length;
            requestHarness.settings.aiProvider = 'claude';
            await requestHarness.requestSongReport();
            const missingKey = {
                researchCalls,
                logs: lifecycleLogs.slice(missingKeyLogStart),
                inFlight: requestHarness.songReportRequestInFlight
            };
            controller.activateSongReport = originalActivate;
            controller.updateSongReportControls();

            return {
                prompt,
                parsedEntries,
                sanitizedEntries,
                schedule,
                beforeNotes,
                atAnchoredNote,
                blankBetweenNotes,
                blankRowOpen,
                atGeneralNote,
                deadlines,
                storedEntries: stored?.entries || [],
                migratedEntries: migrated?.entries || [],
                halfSecondFirst,
                halfSecondBlank,
                halfSecondSecond,
                halfSecondDeadline,
                identityAgain,
                openai,
                claude,
                requests,
                commandLogs,
                controls,
                requestLifecycle: { idleLabel, waiting, completed, missingKey }
            };
        });
        const openaiReportRequest = songReport.requests[0]?.body || {};
        const claudeReportRequest = songReport.requests[1]?.body || {};
        const orwellSixRules = [
            'i. Never use a metaphor, simile or other figure of speech which you are used to seeing in print.',
            'ii. Never use a long word where a short one will do.',
            'iii. If it is possible to cut a word out, always cut it out.',
            'iv. Never use the passive where you can use the active.',
            'v. Never use a foreign phrase, a scientific word or a jargon word if you can think of an everyday English equivalent.',
            'vi. Break any of these rules sooner than say anything outright barbarous.'
        ].join('\n');
        report.check(`song report requests force provider web research at default reasoning effort`,
            songReport.openai.provider === 'openai'
            && songReport.claude.provider === 'claude'
            && openaiReportRequest.tools?.[0]?.type === 'web_search'
            && openaiReportRequest.tool_choice === 'required'
            && openaiReportRequest.reasoning === undefined
            && claudeReportRequest.tools?.[0]?.type === 'web_search_20250305'
            && claudeReportRequest.tool_choice?.type === 'any');
        report.check(`song report prompt requires sourced reporting without model-authored interpretation or style`,
            /careful reporter, not a creative writer or stylist/.test(songReport.prompt)
            && /published literary or critical analysis/.test(songReport.prompt)
            && /personal and band history at the time, creative relationships, and well-sourced interpersonal stories/.test(songReport.prompt)
            && /business, money/.test(songReport.prompt)
            && /Every factual claim and interpretation must be traceable/.test(songReport.prompt)
            && /Do not add your own interpretation or inference/.test(songReport.prompt)
            && /never soften, intensify, or change a source's meaning/.test(songReport.prompt)
            && /Do not add scene-setting, flourishes, clever transitions, or generic praise/.test(songReport.prompt));
        report.check(`song report prompt excludes music videos and bare personnel credits`,
            /Do not report music-video concepts, imagery, production, cast, directors, reception, or view counts/.test(songReport.prompt)
            && /Credits are not notes/.test(songReport.prompt)
            && /Do not name musicians or other personnel merely to say who played, sang, wrote, produced, engineered, directed, or appeared/.test(songReport.prompt)
            && /Mention a person only when a well-sourced story, relationship, or creative decision involving them is itself notable/.test(songReport.prompt));
        report.check(`song report prompt supports separate research from references in the lyrics`,
            /separate research prompted by distinctive words, phrases, places, terms, people, objects, events, or ideas in the lyrics; report useful sourced context even when no source connects it to the song/.test(songReport.prompt));
        report.check(`song report prompt includes Orwell's six rules verbatim`,
            /Write every note under George Orwell's six rules, reproduced here verbatim:/.test(songReport.prompt)
            && songReport.prompt.includes(orwellSixRules));
        report.check(`song report prompt requires ordinary language instead of insider slang`,
            /Use ordinary, literal English/.test(songReport.prompt)
            && /Do not imitate musicians, critics, journalists, insiders, or a cool persona/.test(songReport.prompt)
            && /say "recorded live," never "cut live."/.test(songReport.prompt));
        report.check(`song report prompt keeps metadata, source names, and URLs out of display notes`,
            /metadata above is research context only, not material to repeat/.test(songReport.prompt)
            && /Keep source attribution out of lyricNotes and generalNotes/.test(songReport.prompt)
            && /Never name or refer to a critic, reviewer, magazine, publication, or other source in a note, and never use phrases such as "critics said" or "according to\."/.test(songReport.prompt)
            && /Never put a raw URL anywhere in the response, including attributions/.test(songReport.prompt)
            && /Never mention the song title, album title, release date, release year, or record label in a note/.test(songReport.prompt)
            && /Put any source names and attribution details in attributions, after lyricNotes and generalNotes/.test(songReport.prompt));
        report.check(`song report prompt numbers the lyrics, ties notes to lines, and quotes only provided lyrics`,
            /Full lyrics of the song, one line per row, numbered:\n1 \| lyric line\n2 \| second verse line/.test(songReport.prompt)
            && /Tie each note to the numbered lyric line it discusses/.test(songReport.prompt)
            && /quoting only from the numbered lyrics above/.test(songReport.prompt)
            && /Aim for roughly 12 notes in total/.test(songReport.prompt)
            && /"lyricNotes":\[\{"line":<numbered lyric line>,"note":"<short sentence>"\}\],"generalNotes":\["<short sentence>"\],"attributions":\["<source name and supported idea; no URL>"\]/.test(songReport.prompt)
            && !/Do not quote or reproduce the lyrics/.test(songReport.prompt));
        report.check(`parsed notes anchor valid lyric lines and demote unknown lines to general`,
            songReport.parsedEntries.length === 3
            && songReport.parsedEntries[0].time === 60
            && songReport.parsedEntries[1].time === null
            && songReport.parsedEntries[2].time === null
            && songReport.storedEntries.length === 2
            && songReport.storedEntries[0].time === 60);
        report.check(`display notes shed citations and URLs; citation-only notes never display`,
            songReport.sanitizedEntries.length === 3
            && songReport.sanitizedEntries[0].text === 'The opening line sets the scene.'
            && songReport.sanitizedEntries[1].text === 'The producer described the take at as unplanned.'
            && songReport.sanitizedEntries[2].text === 'Sales climbed after the tour.');
        report.check(`lyric-anchored notes play at their sung moment with general notes in the largest gap`,
            songReport.schedule.length === 2
            && songReport.schedule[0].at === 60
            && songReport.schedule[1].at === 120
            && songReport.beforeNotes.barSecondary === ''
            && songReport.beforeNotes.artist === '2001 - Report Artist - Report Song'
            && songReport.atAnchoredNote.artist === 'The second verse turns the hook into a response.'
            && songReport.atAnchoredNote.barSecondary === 'The second verse turns the hook into a response.'
            && songReport.atGeneralNote.artist === 'The vocals and rhythm were recorded live.'
            && songReport.deadlines.toAnchored === 60
            && songReport.deadlines.toGeneral === 120
            && songReport.deadlines.toBlankEnd === 120.2);
        report.check(`a 0.2s blank separates consecutive notes on the page while the relay carries the note`,
            // The blank renders as a non-breaking space: visually empty, but
            // the row keeps its line box so the sticky bar's height never
            // changes mid-track.
            songReport.blankBetweenNotes.barSecondary === '\u00A0'
            && songReport.blankRowOpen === 'block'
            && songReport.blankBetweenNotes.artist === 'The vocals and rhythm were recorded live.');
        report.check(`legacy line-based reports migrate to untimed notes and advance at 0.5s`,
            songReport.migratedEntries.length === 2
            && songReport.migratedEntries.every(entry => entry.time === null)
            && songReport.halfSecondFirst.artist === 'legacy one'
            && songReport.halfSecondFirst.barSecondary === 'legacy one'
            && songReport.halfSecondBlank.barSecondary === '\u00A0'
            && songReport.halfSecondBlank.artist === 'legacy two'
            && songReport.halfSecondSecond.artist === 'legacy two'
            && songReport.halfSecondDeadline === 0.5
            && songReport.identityAgain.artist === '2001 - Report Artist - Report Song'
            // Mid-track mode switch empties the second line's TEXT but must
            // not collapse its row: the bar is sticky and a height change
            // there shoves the page under the reader.
            && songReport.identityAgain.barSecondary === '\u00A0');
        report.check(`song report controls select saved reports and step the interval (${songReport.controls.afterUp} -> ${songReport.controls.afterDown})`,
            songReport.controls.reportSelected
            && !songReport.controls.identitySelected
            && songReport.controls.reportDisabled === false
            && songReport.controls.requestLabel === 'Refresh Song Report'
            && songReport.controls.status === '2 saved notes'
            && songReport.controls.afterUp === '10s'
            && songReport.controls.afterDown === '8s'
            && songReport.controls.minimum === '0.5s'
            && songReport.controls.noReportFallsBackToIdentity);
        const requestLifecycle = songReport.requestLifecycle;
        report.check('Song Report is the consistent user-facing mode name',
            requestLifecycle.idleLabel === 'Song Report');
        report.check('Song Report requests a missing report and displays elapsed wait state in both buttons',
            requestLifecycle.waiting.reportButton === 'Waiting 3s'
            && requestLifecycle.waiting.requestButton === 'Waiting 3s'
            && requestLifecycle.waiting.status.includes('OpenAI gpt-5.5')
            && requestLifecycle.waiting.status.includes('waiting 3s'));
        report.check('returned notes are identified, parsed, saved, and start playing with lyric anchors',
            requestLifecycle.completed.reportButton === `Playing ${requestLifecycle.completed.entries.length} notes`
            && requestLifecycle.completed.status.includes(`returned ${requestLifecycle.completed.returnedText.length} characters`)
            && requestLifecycle.completed.status.includes(`playing ${requestLifecycle.completed.entries.length} notes at their lyric moments`)
            && requestLifecycle.completed.mode === 'report'
            && requestLifecycle.completed.anchor === 42
            && requestLifecycle.completed.entries.length === 2
            && requestLifecycle.completed.entries[0].time === 0
            && requestLifecycle.completed.entries[1].time === null);
        report.check('an unconfigured provider fails before a song-report request is announced or sent',
            requestLifecycle.missingKey.researchCalls === 1
            && requestLifecycle.missingKey.inFlight === false
            && requestLifecycle.missingKey.logs.length === 1
            && requestLifecycle.missingKey.logs[0].type === 'error'
            && requestLifecycle.missingKey.logs[0].label === 'Song report request'
            && requestLifecycle.missingKey.logs[0].text === 'Claude API key not configured');
        const lifecycleLabels = requestLifecycle.completed.logLabels;
        const providerLabels = songReport.commandLogs.map(entry => entry.label);
        report.check('song report request, provider payloads, returned prose, split, save, and playback are logged',
            providerLabels.some(label => label.startsWith('Song report request to OpenAI'))
            && providerLabels.includes('Song report response from OpenAI')
            && providerLabels.some(label => label.startsWith('Song report request to Claude'))
            && providerLabels.includes('Song report response from Claude')
            && lifecycleLabels.includes('Song report request')
            && lifecycleLabels.includes('Song report request sent')
            && lifecycleLabels.includes('Song report response received')
            && lifecycleLabels.includes('Song report returned notes')
            && lifecycleLabels.includes('Song report notes parsed')
            && lifecycleLabels.includes('Song report saved')
            && lifecycleLabels.includes('Song report playback'));

        // Car/title relay follows the sounding track even when the lyrics
        // panel is focused on a different row (chip tap must not freeze
        // the Bluetooth/header lyric line).
        const lyricRelayIgnoresPanelFocus = await tab.evaluate(() => {
            const playing = {
                id: 11, name: 'Playing Song', artist: 'Playing Artist',
                lyricsStatus: 'ready',
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Playing Song', artistName: 'Playing Artist',
                    albumName: '', duration: 100, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:03.00]playing line one\n[00:08.00]playing line two',
                    syncedLines: [
                        { time: 3, text: 'playing line one' },
                        { time: 8, text: 'playing line two' }
                    ]
                }
            };
            const other = {
                id: 22, name: 'Other Song', artist: 'Other Artist',
                lyricsStatus: 'ready',
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Other Song', artistName: 'Other Artist',
                    albumName: '', duration: 100, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:01.00]other line',
                    syncedLines: [{ time: 1, text: 'other line' }]
                }
            };
            const harness = {
                settings: { lyricsOnNowPlaying: true, songDisplayMode: 'identity', songReportIntervalSeconds: 8 },
                playlist: [playing, other],
                playback: { player: null },
                currentLyricsItemId: other.id,
                currentLyricsLineIndex: -1,
                nowPlayingShowsText: false,
                isPlaying: true,
                isPaused: false,
                currentPlayingId: playing.id,
                currentPlaylistItem() { return playing; }
            };
            PlayerSongReport.install(harness);
            PlayerLyrics.install(harness);
            MediaSessionCore.setTrackIdentity({
                id: 'playing-video',
                title: playing.name,
                artist: harness.describeNowPlayingArtist(playing),
                album: '',
                artwork: []
            });
            harness.updateListeningTextPosition(4);
            const result = {
                metaTitle: navigator.mediaSession.metadata?.title || '',
                headerTitle: document.querySelector('#siteHeader h1')?.textContent || '',
                barLyric: document.getElementById('transportBarLyric')?.textContent || '',
                panelFocusId: harness.currentLyricsItemId
            };
            MediaSessionCore.clearTrack();
            return result;
        });
        report.check(`player car/title relay follows playing song while panel shows another ("${lyricRelayIgnoresPanelFocus.metaTitle}")`,
            lyricRelayIgnoresPanelFocus.metaTitle === 'playing line one'
            && lyricRelayIgnoresPanelFocus.headerTitle === 'playing line one'
            && lyricRelayIgnoresPanelFocus.barLyric === 'playing line one'
            && lyricRelayIgnoresPanelFocus.panelFocusId === 22);
        await tab.setViewportSize({ width: 400, height: 800 });
        // Per-song lyric offset: listener-language controls nudge the display
        // clock in 0.5s steps and persist on the lyricStates record.
        const mediaSessionChannels = await tab.evaluate(() => {
            const realSetPositionState = navigator.mediaSession.setPositionState.bind(navigator.mediaSession);
            const positionWrites = [];
            navigator.mediaSession.setPositionState = state => {
                positionWrites.push(state ? { ...state } : null);
                return realSetPositionState(state);
            };
            MediaSessionCore.setTrackIdentity({
                id: 'channel-video',
                title: 'Channel Song',
                artist: '2004 - Channel Artist - Channel Song',
                album: 'Channel Album',
                artwork: [{
                    src: 'https://i.ytimg.com/vi/channel-video/hqdefault.jpg',
                    sizes: '480x360',
                    type: 'image/jpeg'
                }]
            });
            MediaSessionCore.setPosition({ duration: 240, position: 31.2, playbackRate: 1 });
            const installedMetadata = navigator.mediaSession.metadata;
            const writesBeforeFirstLines = positionWrites.length;
            MediaSessionCore.setDisplayLines('first lyric', 'first report');
            const firstLinePositionWrites = positionWrites.length - writesBeforeFirstLines;
            const first = {
                title: navigator.mediaSession.metadata?.title || '',
                artist: navigator.mediaSession.metadata?.artist || '',
                album: navigator.mediaSession.metadata?.album || '',
                artwork: navigator.mediaSession.metadata?.artwork[0]?.src || ''
            };
            MediaSessionCore.clearDisplayLine();
            const lyricsOff = {
                mediaTitle: navigator.mediaSession.metadata?.title || '',
                mediaArtist: navigator.mediaSession.metadata?.artist || '',
                documentTitle: document.title,
                headerTitle: document.querySelector('#siteHeader h1')?.textContent || ''
            };
            MediaSessionCore.clearSecondaryDisplayLine();
            const identityRestored = navigator.mediaSession.metadata?.artist || '';
            MediaSessionCore.setPosition({ duration: 240, position: 32.4, playbackRate: 1 });
            const writesBeforeSecondLines = positionWrites.length;
            MediaSessionCore.setDisplayLines('second lyric', 'second report');
            const secondLinePositionWrites = positionWrites.length - writesBeforeSecondLines;
            const sameMetadataObject = navigator.mediaSession.metadata === installedMetadata;
            const second = {
                title: navigator.mediaSession.metadata?.title || '',
                artist: navigator.mediaSession.metadata?.artist || '',
                album: navigator.mediaSession.metadata?.album || '',
                artwork: navigator.mediaSession.metadata?.artwork[0]?.src || ''
            };
            MediaSessionCore.setPlaybackState('paused');
            const paused = {
                title: navigator.mediaSession.metadata?.title || '',
                artist: navigator.mediaSession.metadata?.artist || '',
                state: navigator.mediaSession.playbackState
            };
            MediaSessionCore.setTrackIdentity({
                id: 'next-video',
                title: 'Next Song',
                artist: '2005 - Next Artist - Next Song',
                album: 'Next Album',
                artwork: [{
                    src: 'https://i.ytimg.com/vi/next-video/hqdefault.jpg',
                    sizes: '480x360',
                    type: 'image/jpeg'
                }]
            });
            const boundary = {
                title: navigator.mediaSession.metadata?.title || '',
                artist: navigator.mediaSession.metadata?.artist || '',
                artwork: navigator.mediaSession.metadata?.artwork[0]?.src || '',
                lastPosition: positionWrites[positionWrites.length - 1]
            };
            MediaSessionCore.clearTrack();
            const cleared = {
                metadata: navigator.mediaSession.metadata,
                state: navigator.mediaSession.playbackState,
                lastPosition: positionWrites[positionWrites.length - 1]
            };
            navigator.mediaSession.setPositionState = realSetPositionState;
            return {
                first,
                second,
                firstLinePositionWrites,
                secondLinePositionWrites,
                sameMetadataObject,
                lyricsOff,
                identityRestored,
                paused,
                boundary,
                cleared,
                positionWrites: positionWrites.filter(value => value !== null)
            };
        });
        report.check(`Media Session mutates one track across listening lines without disturbing time remaining`,
            mediaSessionChannels.first.title === 'first lyric'
            && mediaSessionChannels.second.title === 'second lyric'
            && mediaSessionChannels.first.artist === 'first report'
            && mediaSessionChannels.second.artist === 'second report'
            && mediaSessionChannels.sameMetadataObject
            && mediaSessionChannels.firstLinePositionWrites === 0
            && mediaSessionChannels.secondLinePositionWrites === 0
            && mediaSessionChannels.first.album === mediaSessionChannels.second.album
            && mediaSessionChannels.first.artwork === mediaSessionChannels.second.artwork
            && mediaSessionChannels.lyricsOff.mediaTitle === 'Channel Song'
            && mediaSessionChannels.lyricsOff.mediaArtist === 'first report'
            && mediaSessionChannels.lyricsOff.documentTitle === 'Channel Song'
            && mediaSessionChannels.lyricsOff.headerTitle === 'Channel Song'
            && mediaSessionChannels.identityRestored === '2004 - Channel Artist - Channel Song'
            && mediaSessionChannels.positionWrites.some(state =>
                state.duration === 240 && state.position === 32.4 && state.playbackRate === 1)
            && mediaSessionChannels.positionWrites.filter(state => state.position === 32.4).length === 1
            && mediaSessionChannels.positionWrites.every(state => state.position > 0)
            && mediaSessionChannels.paused.title === 'second lyric'
            && mediaSessionChannels.paused.artist === 'second report'
            && mediaSessionChannels.paused.state === 'paused'
            && mediaSessionChannels.boundary.title === 'Next Song'
            && mediaSessionChannels.boundary.artist === '2005 - Next Artist - Next Song'
            && mediaSessionChannels.boundary.artwork.endsWith('/next-video/hqdefault.jpg')
            && mediaSessionChannels.boundary.lastPosition === null
            && mediaSessionChannels.cleared.metadata === null
            && mediaSessionChannels.cleared.state === 'none'
            && mediaSessionChannels.cleared.lastPosition === null);

        // Minimal display communication: identical repeat writes to the
        // now-playing surfaces are dropped at the core - one metadata
        // construction per distinct title, none for repeats.
        const minimalWrites = await tab.evaluate(() => {
            const RealMediaMetadata = window.MediaMetadata;
            let constructions = 0;
            // @ts-ignore - counting wrapper
            window.MediaMetadata = function (init) { constructions++; return new RealMediaMetadata(init); };
            MediaSessionCore.setNowPlayingTitle('repeat line', { artist: '' });
            for (let i = 0; i < 5; i++) MediaSessionCore.setNowPlayingTitle('repeat line', { artist: '' });
            const afterRepeats = constructions;
            MediaSessionCore.setNowPlayingTitle('changed line', { artist: '' });
            const afterChange = constructions;
            for (let i = 0; i < 5; i++) MediaSessionCore.setPlaybackState('paused');
            window.MediaMetadata = RealMediaMetadata;
            MediaSessionCore.clearNowPlayingTitle();
            return { afterRepeats, afterChange, state: navigator.mediaSession.playbackState };
        });
        report.check(`player now-playing writes are deduped (${minimalWrites.afterRepeats} write for 6 same, ${minimalWrites.afterChange} after change)`,
            minimalWrites.afterRepeats === 1
            && minimalWrites.afterChange === 2
            && minimalWrites.state === 'paused');


        playerVoiceErrors
            .filter(e => !e.includes('offline test'))
            .forEach(e => report.errors.push(e));
        await ctx.close();
    }

    await browser.close();
    report.finish();
})();
