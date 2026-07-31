// @ts-check
// player live controls product behavior, extracted from the retired tab-functions monolith.

const { BASE_URL, launchWithMic, collectErrors, instrumentVoices, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('player live controls');
    const browser = await launchWithMic();
    // ============ PLAYER VOICE: shared core drives commands and music requests ============
    {
        const ctx = await browser.newContext();
        await ctx.route('https://i.ytimg.com/**', route => route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
        }));
        await ctx.route(/\/proxy\.php\?.*\bq=/, route => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                source: 'test-proxy',
                results: [{
                    videoId: 'voice000001',
                    title: 'Test Artist - Voice Search Song',
                    channelTitle: 'Test Artist',
                    duration: 180,
                    isAlbumTrack: true
                }]
            })
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
        /** @type {string[]} */
        const playerVoiceErrors = [];
        collectErrors(tab, 'player-voice', playerVoiceErrors);
        await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'domcontentloaded' });
        await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);

        const modelOptions = await tab.evaluate(() => {
            return {
                hasClaudeFable5: !!document.querySelector('[data-claude-model="claude-fable-5"]'),
                hasClaudeOpus48: !!document.querySelector('[data-claude-model="claude-opus-4-8"]'),
                hasClaudeSonnet5: !!document.querySelector('[data-claude-model="claude-sonnet-5"]'),
                hasClaudeHaiku45: !!document.querySelector('[data-claude-model="claude-haiku-4-5"]'),
                openaiModels: Array.from(document.querySelectorAll('[data-openai-model]'))
                    .map(btn => /** @type {HTMLElement} */ (btn).dataset.openaiModel)
            };
        });
        report.check('player exposes current LLM model options',
            modelOptions.hasClaudeFable5
            && modelOptions.hasClaudeOpus48
            && modelOptions.hasClaudeSonnet5
            && modelOptions.hasClaudeHaiku45
            && modelOptions.openaiModels.includes('gpt-5.5')
            && modelOptions.openaiModels.includes('gpt-5.4')
            && modelOptions.openaiModels.includes('gpt-4.1'));

        // The one-time Fable 5 target switch: fresh installs land on
        // claude-fable-5, an unmarked stored OpenAI selection migrates
        // once, and a marked selection is the owner's choice and stays.
        const freshTarget = await tab.evaluate(() => ({
            provider: window.musicController.settings.aiProvider,
            model: window.musicController.settings.claudeModel,
            marker: window.musicController.settings.llmMigration,
            persistedMarker: SettingsStore.peekData('voice-wei:player-settings')?.llmMigration
        }));
        await tab.evaluate(() => {
            const envelope = JSON.parse(localStorage.getItem('voice-wei:player-settings'));
            envelope.data.aiProvider = 'openai';
            envelope.data.claudeModel = 'claude-opus-4-8';
            delete envelope.data.llmMigration;
            localStorage.setItem('voice-wei:player-settings', JSON.stringify(envelope));
        });
        await tab.reload({ waitUntil: 'domcontentloaded' });
        await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
        const migratedTarget = await tab.evaluate(() => ({
            provider: window.musicController.settings.aiProvider,
            model: window.musicController.settings.claudeModel
        }));
        await tab.evaluate(() => {
            const envelope = JSON.parse(localStorage.getItem('voice-wei:player-settings'));
            envelope.data.aiProvider = 'openai';
            envelope.data.openaiModel = 'gpt-5.4';
            localStorage.setItem('voice-wei:player-settings', JSON.stringify(envelope));
        });
        await tab.reload({ waitUntil: 'domcontentloaded' });
        await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
        const ownerChoice = await tab.evaluate(() => ({
            provider: window.musicController.settings.aiProvider,
            model: window.musicController.settings.openaiModel
        }));
        report.check('player targets Claude Fable 5 once and then honors later provider choices',
            freshTarget.provider === 'claude'
            && freshTarget.model === 'claude-fable-5'
            && freshTarget.marker === 'fable-5-target'
            && freshTarget.persistedMarker === 'fable-5-target'
            && migratedTarget.provider === 'claude'
            && migratedTarget.model === 'claude-fable-5'
            && ownerChoice.provider === 'openai'
            && ownerChoice.model === 'gpt-5.4');

        const prebufferProbe = await tab.evaluate(async () => {
            const realYT = window.YT;
            const instances = [];
            class FakeProbePlayer {
                constructor(id, options) {
                    this.id = id;
                    this.options = options;
                    this.muted = false;
                    this.playCalls = 0;
                    this.pauseCalls = 0;
                    this.destroyed = false;
                    instances.push(this);
                    queueMicrotask(() => options.events.onReady({ target: this }));
                }
                mute() { this.muted = true; }
                playVideo() {
                    this.playCalls++;
                    queueMicrotask(() => this.options.events.onStateChange({ target: this, data: 1 }));
                }
                pauseVideo() { this.pauseCalls++; }
                seekTo() {}
                destroy() { this.destroyed = true; }
                getDuration() { return 100; }
                getVideoLoadedFraction() { return 0.2; }
            }
            window.YT = { Player: FakeProbePlayer, PlayerState: { PLAYING: 1 } };
            const items = ['Current', 'Next One', 'Next Two', 'Later'].map((name, index) => ({
                id: index + 1,
                videoId: `probe-${index + 1}`,
                name,
                title: name
            }));
            const messages = [];
            const harness = {
                playlist: items,
                addMessage(type, label, text) { messages.push({ type, label, text }); },
                async ensureYouTubeApi() {}
            };
            PlayerPrebufferProbe.install(harness);
            const defaultDisabled = harness.prebufferProbeEnabled === false;
            harness.prebufferProbeEnabled = true;
            const candidates = harness.prebufferProbeCandidates(items[0]).map(item => item.name);
            await harness.startPrebufferProbeFor(items[0]);
            await new Promise(resolve => setTimeout(resolve, 0));
            const started = instances.length === 2
                && instances.every(player => player.muted && player.playCalls === 1)
                && harness.prebufferProbeSlots.every(slot => slot.stage === 'prewarming')
                && !!document.getElementById('prebuffer-probe-host');

            harness.prebufferProbeSlots.forEach((slot, index) => {
                slot.readyMs = 100 + index;
                slot.coldStartMs = 200 + index;
                slot.warmStartMs = 30 + index;
                slot.bufferedAfterPrewarmSeconds = 12 + index;
                slot.bufferedAfterWarmSeconds = 13 + index;
                harness.finishPrebufferProbeSlot(harness.prebufferProbeRunId, slot, instances[index]);
            });
            const reported = messages.filter(message => message.label === 'Prebuffer probe').length === 3
                && messages.some(message => message.label === 'Prebuffer probe complete')
                && messages.some(message => message.text.includes('warm resume 30ms'));
            harness.cleanupPrebufferProbe();
            const cleaned = instances.every(player => player.destroyed)
                && !document.getElementById('prebuffer-probe-host');
            window.YT = realYT;
            return { defaultDisabled, candidates, started, reported, cleaned };
        });
        report.check('player three-player prebuffer probe is opt-in, warms next two, reports, and cleans up',
            prebufferProbe.defaultDisabled
            && prebufferProbe.candidates.join('|') === 'Next One|Next Two'
            && prebufferProbe.started
            && prebufferProbe.reported
            && prebufferProbe.cleaned);

        const lyricsOverlayNavigation = await tab.evaluate(() => {
            const controller = window.musicController;
            const overlay = document.getElementById('lyricsOverlay');
            const content = document.getElementById('lyricsOverlayContent');
            const lyricsData = (prefix) => ({
                provider: 'test',
                trackName: prefix,
                artistName: 'Test Artist',
                albumName: '',
                duration: 100,
                instrumental: false,
                plainLyrics: '',
                syncedLyrics: '',
                syncedLines: Array.from({ length: 80 }, (_, index) => ({
                    time: index,
                    text: `${prefix} line ${index + 1}`
                }))
            });
            const first = { id: 901, name: 'First', artist: 'Test Artist', lyricsStatus: 'ready', lyricsData: lyricsData('first') };
            const second = { id: 902, name: 'Second', artist: 'Test Artist', lyricsStatus: 'ready', lyricsData: lyricsData('second') };

            controller.openLyricsOverlay();
            controller.currentLyricsItemId = first.id;
            controller.currentLyricsLineIndex = -1;
            controller.renderLyricsStateForItem(first);
            content.scrollTop = content.scrollHeight;
            const priorTrackScroll = content.scrollTop;

            controller.currentLyricsItemId = second.id;
            controller.currentLyricsLineIndex = -1;
            controller.renderLyricsStateForItem(second);
            const nextTrackScroll = content.scrollTop;

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            return {
                priorTrackScroll,
                nextTrackScroll,
                overlayClosed: overlay.getAttribute('aria-hidden') === 'true'
                    && !document.body.classList.contains('lyrics-overlay-open')
            };
        });
        report.check(`player Big Lyrics resets at the next track (${lyricsOverlayNavigation.priorTrackScroll}px -> ${lyricsOverlayNavigation.nextTrackScroll}px)`,
            lyricsOverlayNavigation.priorTrackScroll > 0 && lyricsOverlayNavigation.nextTrackScroll === 0);
        report.check('player Escape closes Big Lyrics', lyricsOverlayNavigation.overlayClosed);

        // Log lines persist across sessions, but opening the panel shows only
        // this page session until the explicit history button is pressed.
        const logHistory = await tab.evaluate(async () => {
            const previousStamp = `previous log probe ${Date.now()}`;
            const currentStamp = `current log probe ${Date.now()}`;
            PlayerHistoryDB.recordLog({
                type: 'claude',
                label: 'Probe',
                text: previousStamp,
                line: `[00:00:00] Probe: ${previousStamp}`
            });
            await new Promise(resolve => setTimeout(resolve, 120));
            const c = window.musicController;
            c.sessionStartedAt = new Date().toISOString();
            c.addMessage('claude', 'Probe', currentStamp);
            await new Promise(resolve => setTimeout(resolve, 120));
            const stored = await PlayerHistoryDB.listStoredLogs();

            document.querySelectorAll('#logContent .log-history, #logContent .log-history-divider')
                .forEach(line => line.remove());
            c.historicalLogsLoaded = false;
            c.historicalLogsLoading = false;
            const container = document.getElementById('logContainer');
            if (container && !container.classList.contains('collapsed')) {
                c.toggleLogPanel();
            }
            c.toggleLogPanel();
            const historyBeforeClick = document.querySelectorAll('#logContent .log-history').length;
            const historyButton = /** @type {HTMLButtonElement} */ (document.getElementById('loadHistoryLogBtn'));
            const buttonVisible = historyButton.style.display !== 'none';
            const clipboardWrites = [];
            const clipboard = navigator.clipboard;
            const originalWriteText = clipboard.writeText;
            clipboard.writeText = async text => {
                clipboardWrites.push(text);
            };
            document.getElementById('copyAllLogBtn').click();
            await Promise.resolve();
            const copiedBeforeHistory = clipboardWrites.at(-1) || '';

            const originalLoad = c.loadHistoricalLogs;
            let loadPromise = Promise.resolve();
            c.loadHistoricalLogs = function () {
                loadPromise = originalLoad.call(this);
                return loadPromise;
            };
            historyButton.click();
            await loadPromise;
            c.loadHistoricalLogs = originalLoad;
            document.getElementById('copyAllLogBtn').click();
            await Promise.resolve();
            const copiedAfterHistory = clipboardWrites.at(-1) || '';
            clipboard.writeText = originalWriteText;

            const replayed = Array.from(document.querySelectorAll('#logContent .log-line.log-history'))
                .some(line => line.textContent.includes(previousStamp));
            const currentWasNotReplayed = !Array.from(document.querySelectorAll('#logContent .log-line.log-history'))
                .some(line => line.textContent.includes(currentStamp));
            const currentVisible = Array.from(document.querySelectorAll('#logContent .log-line:not(.log-history)'))
                .some(line => line.textContent.includes(currentStamp));
            const divider = !!document.querySelector('#logContent .log-history-divider');
            return {
                stored: stored.some(record => record.text === previousStamp),
                historyBeforeClick,
                buttonVisible,
                buttonText: historyButton.textContent,
                copiedCurrentOnly: copiedBeforeHistory.includes(currentStamp)
                    && !copiedBeforeHistory.includes(previousStamp),
                copiedHistoryAfterLoad: copiedAfterHistory.includes(currentStamp)
                    && copiedAfterHistory.includes(previousStamp),
                replayed,
                currentWasNotReplayed,
                currentVisible,
                divider
            };
        });
        report.check('player Log and Copy All stay session-only until Load Old Logs includes retained history',
            logHistory.stored
            && logHistory.historyBeforeClick === 0
            && logHistory.buttonVisible
            && logHistory.buttonText.startsWith('Old Logs Loaded')
            && logHistory.copiedCurrentOnly
            && logHistory.copiedHistoryAfterLoad
            && logHistory.replayed
            && logHistory.currentWasNotReplayed
            && logHistory.currentVisible
            && logHistory.divider);

        await tab.click('#listenBtn');
        await tab.waitForTimeout(200);
        const listeningStatus = await tab.textContent('#status');
        await tab.evaluate(() => window.__emitResult('clear'));
        await tab.waitForTimeout(400);
        const afterClear = await tab.textContent('#status');
        report.check(`player voice control ("${listeningStatus}" -> "${afterClear}")`,
            listeningStatus === 'Listening...' && afterClear === 'Playlist is already empty');

        // The following assertions own voice/search routing, not YouTube's
        // external embed policy for the synthetic test video.
        await tab.evaluate(() => {
            window.musicController.playPlaylist = () => {};
        });

        // Manual mode: segments accumulate, spoken "submit" starts keyless search
        await tab.click('#settingsBtn');
        await tab.evaluate(() => document.getElementById('autoSubmitMode').click());
        await tab.click('#closeSettingsBtn');
        await tab.click('#listenBtn');
        await tab.waitForTimeout(200);
        const manualStatus = await tab.textContent('#status');
        await tab.evaluate(() => window.__emitResult('play some jazz'));
        await tab.waitForTimeout(200);
        await tab.evaluate(() => window.__emitResult('submit'));
        await tab.waitForTimeout(600);
        const logged = await tab.evaluate(() =>
            document.getElementById('logContent').textContent.includes('play some jazz'));
        report.check(`player manual mode + spoken submit ("${manualStatus}", request logged: ${logged})`,
            manualStatus.includes('say "submit"') && logged);

        // Spoken requests use the primary keyless path even when the selected
        // AI provider has no key.
        const overlayAfterSubmit = await tab.evaluate(() =>
            document.getElementById('apiKeyOverlay').style.display);
        const voiceSearchRows = await tab.evaluate(() => window.musicController.playlist.length);
        report.check('player spoken requests default to keyless YouTube search',
            overlayAfterSubmit === 'none' && voiceSearchRows === 1);

        // Android-style cumulative re-delivery (same index re-sent with
        // grown text, marked final each time) must not duplicate anything
        await tab.click('#listenBtn');
        await tab.waitForTimeout(200);
        await tab.evaluate(() => {
            window.__emitCumulative('there was', true);
            window.__emitCumulative('there was a guy', true);
            window.__emitCumulative('there was a guy I think', true);
        });
        const liveText = await tab.evaluate(() =>
            document.getElementById('transcript').textContent.trim());
        await tab.evaluate(() => window.__emitResult('submit'));
        await tab.waitForTimeout(600);
        const cumulativeLogged = await tab.evaluate(() =>
            document.getElementById('logContent').textContent.includes('there was a guy I think'));
        report.check(`player cumulative re-delivery stays deduped ("${liveText}")`,
            liveText === 'there was a guy I think' && cumulativeLogged);
        // Cross-index cumulative finals (the other Android variant) collapse
        const collapsed = await tab.evaluate(() => {
            const tm = new window.TranscriptManager();
            tm.updateSessionResult(0, 'there was', true);
            tm.updateSessionResult(1, 'there was a guy', true);
            tm.updateSessionResult(2, ' play it', true);
            return tm.getFinalizedText();
        });
        report.check(`transcript collapses cumulative finals across indices ("${collapsed}")`,
            collapsed === 'there was a guy play it');

        // The now-playing title (car / lock screen / tab / header line):
        // song identity for the first seconds, a countdown prefix before
        // a late first lyric line, then the bare lyric led ahead of the
        // sung moment. Title never carries song/artist past the intro;
        // Media Session artist/artwork stay stable while the title changes.
        // Pause freezes the same track and current lyric.
        const deadlineClock = await tab.evaluate(async () => {
            const c = window.musicController;
            if (!c) return { error: 'no controller' };
            const item = {
                id: 553, videoId: 'clock', name: 'Clock Song', artist: 'Clock Artist',
                lyricsStatus: 'ready',
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Clock Song', artistName: 'Clock Artist',
                    albumName: '', duration: 120, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:05.00]clock line one\n[00:09.00]clock line two',
                    syncedLines: [
                        { time: 5, text: 'clock line one' },
                        { time: 9, text: 'clock line two' }
                    ]
                }
            };
            c.playlist.push(item);
            c.currentLyricsItemId = item.id;
            c.playback.setActiveMedia(item.id, item.videoId);
            c.playback.markPlaying(item.id);
            const realSetPositionState = navigator.mediaSession.setPositionState.bind(navigator.mediaSession);
            const positionWrites = [];
            navigator.mediaSession.setPositionState = state => {
                positionWrites.push(state ? { ...state } : null);
                return realSetPositionState(state);
            };
            const realSetActionHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
            const mediaHandlers = new Map();
            navigator.mediaSession.setActionHandler = (action, handler) => {
                mediaHandlers.set(action, handler);
                return realSetActionHandler(action, handler);
            };
            c.mediaActionHandlersSet = false;
            c.updateMediaSessionForItem(item);
            navigator.mediaSession.setActionHandler = realSetActionHandler;
            MediaSessionCore.setPosition({ duration: 120, position: 119, playbackRate: 1 });
            MediaSessionCore.setDisplayLine('stale final lyric');
            c.updateMediaSessionForItem(item);
            const sameVideoReplayTitle = navigator.mediaSession.metadata?.title || '';
            const sameVideoReplayPosition = positionWrites[positionWrites.length - 1];

            const deadlines = {
                fromZero: c.nextListeningTextDeadline(0),
                beforeFirst: c.nextListeningTextDeadline(4.5),
                betweenLines: c.nextListeningTextDeadline(6),
                afterLast: c.nextListeningTextDeadline(9.5)
            };

            // Fake player whose clock advances like real playback.
            let reads = 0;
            let mediaStart = 0.2;
            let wallStart = performance.now();
            const seekCalls = [];
            const fakePlayer = {
                getCurrentTime() { reads++; return mediaStart + (performance.now() - wallStart) / 1000; },
                getDuration() { return 120; },
                getPlaybackRate() { return 1.25; },
                seekTo(time) {
                    seekCalls.push(time);
                    mediaStart = time;
                    wallStart = performance.now();
                },
                pauseVideo() {},
                stopVideo() {}
            };
            c.playback.markPlayerReady(fakePlayer);

            // Mid-second, far from any lyric: one initial render, then the
            // clock sleeps to the next second boundary (0.8s away) - a
            // 100ms poll would have read the time ~7 times in 650ms.
            c.startProgressUpdates();
            reads = 0;
            await new Promise(resolve => setTimeout(resolve, 650));
            const idleReads = reads;

            // Jump to just before the first line's led window (4.25s):
            // the transition must land without any polling cadence.
            mediaStart = 4.1;
            wallStart = performance.now();
            c.resyncProgressClock();
            await new Promise(resolve => setTimeout(resolve, 450));
            const titleAfterLead = navigator.mediaSession.metadata?.title || '';
            mediaHandlers.get('seekto')?.({ action: 'seekto', seekTime: 6, fastSeek: false });

            const lastPosition = positionWrites[positionWrites.length - 1] || null;
            c.pausePlayback();
            const paused = {
                title: navigator.mediaSession.metadata?.title || '',
                state: navigator.mediaSession.playbackState,
                position: positionWrites.filter(value => value !== null).at(-1) || null
            };
            c.stopPlayback();
            const stopped = {
                metadata: navigator.mediaSession.metadata,
                state: navigator.mediaSession.playbackState,
                lastPosition: positionWrites[positionWrites.length - 1]
            };
            navigator.mediaSession.setPositionState = realSetPositionState;
            c.playback.reset();
            c.currentLyricsItemId = null;
            c.playlist.pop();
            return {
                deadlines, idleReads, titleAfterLead, lastPosition, paused, stopped,
                sameVideoReplayTitle, sameVideoReplayPosition,
                mediaActions: [...mediaHandlers.keys()], seekCalls
            };
        });
        report.check(`player progress clock publishes YouTube position and pause/stop preserve then clear it (idle reads ${deadlineClock.idleReads}, lead title "${deadlineClock.titleAfterLead}")`,
            !deadlineClock.error
            && deadlineClock.deadlines.fromZero === 4.25
            && deadlineClock.deadlines.beforeFirst === 5
            && deadlineClock.deadlines.betweenLines === 8.25
            && deadlineClock.deadlines.afterLast === Infinity
            && deadlineClock.idleReads <= 2
            && deadlineClock.sameVideoReplayTitle === 'Clock Song'
            && deadlineClock.sameVideoReplayPosition === null
            && ['seekbackward', 'seekforward', 'seekto'].every(action =>
                deadlineClock.mediaActions.includes(action))
            && deadlineClock.seekCalls[0] === 6
            && deadlineClock.titleAfterLead === 'clock line one'
            && deadlineClock.lastPosition?.duration === 120
            && deadlineClock.lastPosition?.playbackRate === 1.25
            && deadlineClock.lastPosition?.position >= 4.1
            && deadlineClock.paused?.title === 'clock line one'
            && deadlineClock.paused?.state === 'paused'
            && deadlineClock.paused?.position?.duration === 120
            && deadlineClock.stopped?.metadata === null
            && deadlineClock.stopped?.state === 'none'
            && deadlineClock.stopped?.lastPosition === null);

        // Save-then-activate under a failing store write: the live item is
        // never activated with lyrics the permanent store does not hold
        // (that session-only state was the "L shows but reload loses it"
        // class). The song stays unresolved and heals on the next attempt.

        playerVoiceErrors
            .filter(e => !e.includes('offline test'))
            .forEach(e => report.errors.push(e));
        await ctx.close();
    }

    // ============ PLAYER: optional API keys + settings panel ============
    {
        const ctx = await browser.newContext();
        const tab = await ctx.newPage();
        collectErrors(tab, 'player', report.errors);
        await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'domcontentloaded' });
        await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
        const overlayShown = await tab.evaluate(() => {
            const overlay = document.getElementById('apiKeyOverlay');
            return overlay && getComputedStyle(overlay).display !== 'none';
        });
        const noKeyStatus = await tab.textContent('#status');
        report.check('player opens normally without an API key',
            overlayShown === false && noKeyStatus === 'Ready - keyless search');

        await tab.evaluate(() => localStorage.setItem('claudeApiKey', 'test-key-not-real-1234567890'));
        await tab.reload({ waitUntil: 'domcontentloaded' });
        await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
        const overlayGone = await tab.evaluate(() => {
            const overlay = document.getElementById('apiKeyOverlay');
            return !overlay || getComputedStyle(overlay).display === 'none';
        });
        await tab.click('#settingsBtn');
        await tab.waitForTimeout(400);
        const panelOpen = await tab.evaluate(() =>
            getComputedStyle(document.getElementById('settingsPanel')).display !== 'none');
        await tab.click('#closeSettingsBtn');
        await tab.waitForTimeout(300);
        const panelClosed = await tab.evaluate(() =>
            getComputedStyle(document.getElementById('settingsPanel')).display === 'none');
        report.check('player with key: overlay gone, settings open/close', overlayGone && panelOpen && panelClosed);

        // The Notes toggle is wired to the real controller: default off,
        // checking it flips the setting and the container class instantly.
        const notesToggleWiring = await tab.evaluate(() => {
            const controller = window.musicController;
            const container = document.getElementById('playlistContainer');
            const toggle = document.getElementById('playlistNotesToggle');
            const defaultOff = controller.settings.showSongNotes === false
                && toggle.checked === false
                && !container.classList.contains('playlist-notes-on');
            toggle.checked = true;
            toggle.dispatchEvent(new Event('change'));
            const onAfterClick = controller.settings.showSongNotes === true
                && container.classList.contains('playlist-notes-on');
            toggle.checked = false;
            toggle.dispatchEvent(new Event('change'));
            const offAgain = controller.settings.showSongNotes === false
                && !container.classList.contains('playlist-notes-on');
            return { defaultOff, onAfterClick, offAgain };
        });
        report.check('player notes toggle defaults off and applies instantly',
            notesToggleWiring.defaultOff && notesToggleWiring.onAfterClick && notesToggleWiring.offAgain);
        await ctx.close();
    }
    await browser.close();
    report.finish();
})();
