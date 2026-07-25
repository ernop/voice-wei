// @ts-check
// player search and requests product behavior, extracted from the retired tab-functions monolith.

const { BASE_URL, launchWithMic, collectErrors, instrumentVoices, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('player search and requests');
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

        const musicHistoryCache = await tab.evaluate(async () => {
            const query = `cache test ${Date.now()}`;
            PlayerHistoryDB.recordYouTubeSearch(query, [{
                videoId: 'cached-video',
                title: 'Cached Video',
                channelTitle: 'Cached Channel',
                duration: 100
            }], { source: 'test' });
            await new Promise(resolve => setTimeout(resolve, 100));
            const cached = await PlayerHistoryDB.getYouTubeSearch(query);
            return {
                query: cached?.query || '',
                count: cached?.results?.length || 0,
                videoId: cached?.results?.[0]?.videoId || '',
                source: cached?.source || ''
            };
        });
        report.check('player IndexedDB stores YouTube search conversions',
            musicHistoryCache.query.startsWith('cache test')
            && musicHistoryCache.count === 1
            && musicHistoryCache.videoId === 'cached-video'
            && musicHistoryCache.source === 'test');

        const musicHistoryWorkflows = await tab.evaluate(async () => {
            const harness = {
                musicHistoryLookups: [{
                    id: 1,
                    requestText: 'old lookup request',
                    songCount: 2,
                    provider: 'openai',
                    createdAt: '2026-01-01',
                    songList: [{ searchTerm: 'old one' }, { searchTerm: 'old two' }]
                }],
                musicHistorySongs: [{
                    videoId: 'known-video',
                    name: 'Known Song',
                    artist: 'Known Artist',
                    title: 'Known Song',
                    channelTitle: 'Known Artist',
                    duration: '2:00',
                    durationSeconds: 120,
                    searchTerm: 'Known Artist Known Song',
                    sourceKind: 'search',
                    lastSeenAt: '2026-01-02'
                }],
                musicHistorySearches: [{
                    query: 'cached query',
                    queryKey: 'cached query',
                    resultCount: 1,
                    source: 'cache',
                    updatedAt: '2026-01-03',
                    results: [{ videoId: 'cached-video', title: 'Cached Video', channelTitle: 'Cached Channel', duration: 100 }]
                }],
                playlist: [],
                currentPlaylistIndex: -1,
                statuses: [],
                messages: [],
                searchedTerms: [],
                rerunRequest: '',
                escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); },
                truncateForStatus(value) { return String(value || ''); },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.statuses.push(message); },
                async searchAndAddToPlaylist(songList) { this.searchedTerms.push(...songList.map(song => song.searchTerm)); },
                async processMusicSearch(requestText) { this.rerunRequest = requestText; },
                appendPlaylistItem(item) { this.playlist.push(item); },
                updatePlaylistLabel() {},
                persistPlaylist() {},
                showPlaylistSurfaces() {}
            };
            PlayerHistoryUI.install(harness);
            harness.refreshMusicHistoryPanel = async () => {};
            harness.renderLookupHistory(harness.musicHistoryLookups);
            harness.renderKnownSongsHistory(harness.musicHistorySongs);
            harness.renderSearchCacheHistory(harness.musicHistorySearches);
            const rendered = {
                lookup: document.getElementById('musicLookupHistoryList').textContent,
                song: document.getElementById('musicKnownSongsList').textContent,
                cache: document.getElementById('musicSearchCacheList').textContent
            };
            await harness.loadHistoryLookups([1]);
            await harness.rerunHistoryLookupById(1);
            await harness.loadKnownSongs(['known-video']);
            document.getElementById('musicLookupHistoryList').innerHTML = '';
            document.getElementById('musicKnownSongsList').innerHTML = '';
            document.getElementById('musicSearchCacheList').innerHTML = '';
            return {
                rendered,
                searchedTerms: harness.searchedTerms.join('|'),
                rerunRequest: harness.rerunRequest,
                loadedKnown: harness.playlist[0]?.sourceKind || ''
            };
        });
        report.check('player history UI loads, reruns, and combines stored work',
            musicHistoryWorkflows.rendered.lookup.includes('old lookup request')
            && musicHistoryWorkflows.rendered.song.includes('Known Song')
            && musicHistoryWorkflows.rendered.cache.includes('cached query')
            && musicHistoryWorkflows.searchedTerms === 'old one|old two'
            && musicHistoryWorkflows.rerunRequest === 'old lookup request'
            && musicHistoryWorkflows.loadedKnown === 'history');

        // Known Songs live search: the list filters with the same matcher
        // as the playlist filter, and Load All Shown loads exactly the
        // matching songs into the working playlist.
        const knownSongsSearch = await tab.evaluate(async () => {
            const harness = {
                musicHistoryLookups: [],
                musicHistorySongs: [
                    { videoId: 'v-sunset', name: 'Sunset Boulevard', artist: 'Evening Band', year: '1984', title: 'Sunset Boulevard', channelTitle: 'Evening Band', duration: '3:00', searchTerm: 'Evening Band Sunset Boulevard', sourceKind: 'search', lastSeenAt: '2026-01-02' },
                    { videoId: 'v-morning', name: 'Morning Run', artist: 'Dawn Crew', year: '2001', title: 'Morning Run', channelTitle: 'Dawn Crew', duration: '2:30', searchTerm: 'Dawn Crew Morning Run', sourceKind: 'search', lastSeenAt: '2026-01-03' }
                ],
                musicHistorySearches: [],
                playlist: [],
                knownSongsQuery: '',
                statuses: [],
                messages: [],
                escapeHtml(value) { return String(value || ''); },
                truncateForStatus(value) { return String(value || ''); },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.statuses.push(message); },
                hydrateItemLyricsFromCache() {},
                appendPlaylistItem(item) { this.playlist.push(item); },
                updatePlaylistLabel() {},
                persistPlaylist() {},
                showPlaylistSurfaces() {}
            };
            PlayerHistoryUI.install(harness);
            harness.refreshMusicHistoryPanel = async () => {};

            const host = document.getElementById('musicKnownSongsList');
            harness.renderKnownSongsHistory(harness.musicHistorySongs);
            const unfilteredRows = host.querySelectorAll('.music-history-item').length;

            harness.knownSongsQuery = 'evening sunset';
            harness.renderKnownSongsHistory(harness.musicHistorySongs);
            const filteredText = host.textContent;
            const filteredRows = host.querySelectorAll('.music-history-item').length;

            await harness.loadShownKnownSongs();
            const loadedIds = harness.playlist.map(item => item.videoId).join('|');

            harness.knownSongsQuery = 'no such song anywhere';
            harness.renderKnownSongsHistory(harness.musicHistorySongs);
            const emptyMessage = host.textContent;

            host.innerHTML = '';
            return { unfilteredRows, filteredRows, filteredText, loadedIds, emptyMessage };
        });
        report.check(`player known songs search filters and loads shown (loaded: ${knownSongsSearch.loadedIds})`,
            knownSongsSearch.unfilteredRows === 2
            && knownSongsSearch.filteredRows === 1
            && knownSongsSearch.filteredText.includes('Sunset Boulevard')
            && !knownSongsSearch.filteredText.includes('Morning Run')
            && knownSongsSearch.loadedIds === 'v-sunset'
            && knownSongsSearch.emptyMessage.includes('No known songs match'));

        const musicHistoryRefreshOverride = await tab.evaluate(async () => {
            const query = `refresh cache ${Date.now()}`;
            const realFetch = window.fetch;
            window.fetch = async url => {
                if (String(url).includes('proxy.php?q=')) {
                    return new Response(JSON.stringify({
                        results: [{ videoId: 'fresh-video', title: 'Fresh Video', channelTitle: 'Fresh Channel', duration: 111 }],
                        source: 'fresh-source',
                        instance: 'fresh-instance'
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url);
            };
            const harness = {
                statuses: [],
                messages: [],
                updateStatus(message) { this.statuses.push(message); },
                truncateForStatus(value) { return String(value || ''); },
                escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                async refreshMusicHistoryPanel() {}
            };
            PlayerHistoryUI.install(harness);
            await harness.refreshCachedSearchQuery(query);
            window.fetch = realFetch;
            await new Promise(resolve => setTimeout(resolve, 100));
            const cached = await PlayerHistoryDB.getYouTubeSearch(query);
            return {
                videoId: cached?.results?.[0]?.videoId || '',
                source: cached?.source || '',
                refreshedByUser: cached?.refreshedByUser === true
            };
        });
        report.check('player search cache can be force-refreshed from remote',
            musicHistoryRefreshOverride.videoId === 'fresh-video'
            && musicHistoryRefreshOverride.source === 'fresh-source'
            && musicHistoryRefreshOverride.refreshedByUser);

        const aiParsing = await tab.evaluate(async () => {
            const harness = {
                statuses: [],
                messages: [],
                settings: { openaiModel: 'gpt-5.5' },
                updateStatus(message) { this.statuses.push(message); },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                logClaudeMessage(text) { this.messages.push({ kind: 'claude', label: 'Claude', text }); }
            };
            PlayerCommands.install(harness);
            const openaiRequest = harness.buildOpenAIRequest('Return []');
            const openaiText = harness.extractOpenAIResponseText({
                output: [{
                    content: [{ type: 'output_text', text: '[{"searchTerm":"test"}]' }]
                }]
            });

            const wrapped = harness.parseAIResponse(JSON.stringify({
                songs: [
                    'The Clash London Calling',
                    { song: 'Cecilia', artist: 'Simon & Garfunkel' },
                    { band: 'The Ventures', comment: 'regional riff band' }
                ]
            }), 'prompt');
            let emptyErrorName = '';
            try {
                harness.parseAIResponse('[]', 'prompt');
            } catch (error) {
                emptyErrorName = error.name;
            }

            const realFetch = window.fetch;
            const fetchUrls = [];
            window.fetch = async url => {
                fetchUrls.push(String(url));
                return new Response(JSON.stringify({
                    url: 'https://example.test/page',
                    requestedUrl: 'https://example.test/page',
                    title: 'Regional riffs',
                    text: 'The page mentions The Clash, London Calling, and The Ventures.',
                    charCount: 67,
                    originalCharCount: 1000,
                    truncated: true
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            };
            const prepared = await harness.prepareMusicSearchRequest('all songs in https://example.test/page please');
            const inferred = await harness.prepareMusicSearchRequest('get the songs bands and search terms from the tvtropes regional riffs page');
            const prompt = harness.getMusicSearchPrompt(prepared);
            const longTextPrompts = harness.getMusicSearchPrompts({
                transcript: `Please extract every song. ${'Song line. '.repeat(7000)}`,
                linkedPages: []
            });
            window.fetch = realFetch;

            return {
                urls: harness.extractUrlsFromTranscript('read https://example.test/page, thanks'),
                inferredUrls: harness.inferKnownPageUrls('get tvtropes regional riffs'),
                fetchUrls,
                count: wrapped.songList.length,
                terms: wrapped.songList.map(song => song.searchTerm),
                openaiUrl: openaiRequest.url,
                openaiMaxOutputTokens: openaiRequest.body.max_output_tokens,
                openaiReasoningEffort: openaiRequest.body.reasoning?.effort || '',
                openaiText,
                emptyErrorName,
                linkedTitle: prepared.linkedPages[0]?.title || '',
                inferredTitle: inferred.linkedPages[0]?.title || '',
                prompt,
                longTextPromptCount: longTextPrompts.length,
                longTextPromptHasContinuationNote: longTextPrompts[0].includes('continues in the extraction batches'),
                status: harness.statuses[0] || ''
            };
        });
        report.check('player AI parser accepts wrapped songs and search terms',
            aiParsing.count === 3
            && aiParsing.terms.includes('The Clash London Calling')
            && aiParsing.terms.includes('Simon & Garfunkel Cecilia')
            && aiParsing.terms.includes('The Ventures')
            && aiParsing.openaiUrl.endsWith('/v1/responses')
            && aiParsing.openaiMaxOutputTokens === 16000
            && aiParsing.openaiReasoningEffort === 'low'
            && aiParsing.openaiText.includes('test')
            && aiParsing.emptyErrorName === 'NoSongsFoundError');
        report.check('player URL requests are prepared with linked page text',
            aiParsing.urls[0] === 'https://example.test/page'
            && aiParsing.linkedTitle === 'Regional riffs'
            && aiParsing.status.includes('Reading 1 linked page')
            && aiParsing.prompt.includes('return every distinct music item')
            && aiParsing.prompt.includes('never substitute a different better-known artist')
            && aiParsing.prompt.includes('truncated from 1000 chars')
            && !aiParsing.prompt.includes('5-25')
            && aiParsing.longTextPromptCount > 1
            && aiParsing.longTextPromptHasContinuationNote);
        // A response cut off mid-list by the output token limit must not
        // fail the whole request: every complete song is recovered and the
        // partial trailing object is dropped. Braces/quotes inside values
        // cannot fool the scanner.
        const truncatedRecovery = await tab.evaluate(() => {
            const harness = { messages: [], addMessage(kind, label, text) { this.messages.push({ kind, label, text }); }, logClaudeMessage() {} };
            PlayerCommands.install(harness);
            harness.addMessage = (kind, label, text) => harness.messages.push({ kind, label, text });
            harness.logClaudeMessage = () => {};
            const truncated = `[
                { "name": "Feel It All Around", "artist": "Washed Out", "year": "2009", "album": "Life of Leisure", "comment": "Chillwave with a { brace } and \\"quotes\\" inside", "searchTerm": "Washed Out Feel It All Around" },
                { "name": "Electric Feel", "artist": "MGMT", "year": "2007", "album": "Oracular Spectacular", "comment": "Psych-pop", "searchTerm": "MGMT Electric Feel" },
                { "name": "It Is Not Meant to Be", "artist": "Tame Impala",`;
            const recovered = harness.parseAIResponse(truncated, 'p', { allowEmpty: true, truncated: true });
            let unrecoverableThrew = false;
            try {
                harness.parseAIResponse('complete garbage, no array here', 'p', { allowEmpty: true });
            } catch (error) {
                unrecoverableThrew = error instanceof SyntaxError;
            }
            return {
                count: recovered.songList.length,
                terms: recovered.songList.map(song => song.searchTerm).join('|'),
                recoveryLogged: harness.messages.some(message =>
                    message.label === 'Truncated response recovered' && message.text.includes('Kept 2 complete songs')),
                unrecoverableThrew
            };
        });
        report.check(`player recovers complete songs from a truncated AI response (${truncatedRecovery.count} kept)`,
            truncatedRecovery.count === 2
            && truncatedRecovery.terms === 'Washed Out Feel It All Around|MGMT Electric Feel'
            && truncatedRecovery.recoveryLogged
            && truncatedRecovery.unrecoverableThrew);

        report.check('player infers TV Tropes Regional Riff page without pasted URL',
            aiParsing.inferredUrls[0] === 'https://tvtropes.org/pmwiki/pmwiki.php/Main/RegionalRiff'
            && aiParsing.fetchUrls.some(url => url.includes('RegionalRiff'))
            && aiParsing.inferredTitle === 'Regional riffs');

        const partialPlaylist = await tab.evaluate(async () => {
            const harness = {
                playlist: [],
                youtubeAlternateResults: new Map(),
                currentPlaylistIndex: -1,
                settings: { playlistTimedOnly: false },
                messages: [],
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus() {},
                showTransportBar() {},
                decodeHtml(value) { return value; },
                addPlaylistItemToDOM() {},
                addPlaylistItemsToDOM() {},
                updatePlaylistLabel() {},
                persistPlaylist() {},
                speakText() {}
            };
            PlayerPlaylist.install(harness);
            harness.showTransportBar = () => {};
            harness.addPlaylistItemToDOM = () => {};
            harness.addPlaylistItemsToDOM = () => {};
            harness.updatePlaylistLabel = () => {};
            harness.persistPlaylist = () => {};
            harness.ensureLyricsForItem = () => Promise.resolve();
            harness.queueLyricsLookup = () => {};
            harness.searchYouTube = query => {
                if (query === 'found song') {
                    return Promise.resolve({
                        videoId: 'abc123',
                        title: 'Found Song',
                        channelTitle: 'Found Artist',
                        duration: '3:00',
                        durationSeconds: 180,
                        alternateVideos: [{
                            videoId: 'alternate-found',
                            title: 'Found Alternate',
                            channelTitle: 'Found Artist',
                            duration: '3:10',
                            durationSeconds: 190
                        }]
                    });
                }
                return Promise.resolve(null);
            };
            const result = await harness.searchAndAddToPlaylist([
                { searchTerm: 'found song', name: 'Found Song', artist: 'Found Artist' },
                { searchTerm: 'missing song', name: 'Missing Song', artist: 'Missing Artist' }
            ]);
            return {
                result,
                playlistLength: harness.playlist.length,
                playlistHasAlternates: Array.isArray(harness.playlist[0]?.alternateVideos),
                cachedAlternate: harness.youtubeAlternateResults.get(harness.playlist[0]?.id)?.[0]?.videoId || '',
                hasErrorLog: harness.messages.some(message => message.kind === 'error'),
                hasNotAddedLog: harness.messages.some(message => message.label.includes('not added'))
            };
        });
        report.check('player partial YouTube misses return counts without error logs',
            partialPlaylist.result.addedCount === 1
            && partialPlaylist.result.skippedCount === 1
            && partialPlaylist.result.attemptedTerms.join('|') === 'found song|missing song'
            && partialPlaylist.result.skippedTerms.join('|') === 'missing song'
            && partialPlaylist.playlistLength === 1
            && partialPlaylist.playlistHasAlternates === false
            && partialPlaylist.cachedAlternate === 'alternate-found'
            && partialPlaylist.hasErrorLog === false
            && partialPlaylist.hasNotAddedLog === true);

        // Replace-on-search keeps the playing song: the old list is only
        // dropped when the first found song is actually added, the current
        // song carries over as entry 0 still playing, and a search that
        // finds nothing leaves the playlist untouched.
        const keepPlayingReplace = await tab.evaluate(async () => {
            const makeHarness = () => {
                const harness = {
                    playlist: [],
                    youtubeAlternateResults: new Map(),
                    lyricsFetchQueue: [],
                    settings: { playlistTimedOnly: false },
                    spoken: []
                };
                PlayerPlaylist.install(harness);
                Object.assign(harness, {
                    addMessage() {},
                    updateStatus() {},
                    showPlaylistSurfaces() {},
                    decodeHtml(value) { return value; },
                    addPlaylistItemToDOM() {},
                    addPlaylistItemsToDOM() {},
                    updatePlaylistLabel() {},
                    persistPlaylist() {},
                    queueLyricsLookup() {},
                    renderLyricsStateForItem() {},
                    speakText(text) { this.spoken.push(text); }
                });
                return harness;
            };
            const song = (videoId, name) => PlayerSongs.createPlaylistItem({
                videoId, name, artist: 'Keep Artist', duration: '1:00', durationSeconds: 60, searchTerm: name
            }, { sourceKind: 'search', sourceLabel: 'test' });

            const harness = makeHarness();
            const oldA = song('old-a', 'Old A');
            const oldB = song('old-b', 'Old B');
            harness.playlist.push(oldA, oldB);
            harness.playback.markPlaying(oldB.id);
            harness.currentPlaylistIndex = 1;
            harness.searchYouTube = async () => ({
                videoId: 'new-1', title: 'New One', channelTitle: 'Y', duration: '2:00', durationSeconds: 120
            });
            await harness.searchAndAddToPlaylist(
                [{ searchTerm: 'new one', name: 'New One', artist: 'Y' }],
                { replaceExisting: true }
            );
            const afterReplace = {
                ids: harness.playlist.map(entry => entry.videoId).join('|'),
                cursor: harness.currentPlaylistIndex,
                stillPlaying: harness.isPlaying && harness.currentPlayingId === oldB.id
            };

            // A replace search that finds nothing must not touch the list.
            const untouched = makeHarness();
            untouched.playlist.push(song('keep-1', 'Keep One'));
            untouched.searchYouTube = async () => null;
            await untouched.searchAndAddToPlaylist(
                [{ searchTerm: 'nothing', name: 'Nothing', artist: 'Z' }],
                { replaceExisting: true }
            );
            return {
                afterReplace,
                untouchedIds: untouched.playlist.map(entry => entry.videoId).join('|'),
                unexpectedSpeech: untouched.spoken
            };
        });
        report.check(`player replace keeps the playing song and defers clearing (${keepPlayingReplace.afterReplace.ids})`,
            keepPlayingReplace.afterReplace.ids === 'old-b|new-1'
            && keepPlayingReplace.afterReplace.cursor === 0
            && keepPlayingReplace.afterReplace.stillPlaying === true
            && keepPlayingReplace.untouchedIds === 'keep-1'
            && keepPlayingReplace.unexpectedSpeech.length === 0);

        const boundedSearch = await tab.evaluate(async () => {
            const harness = {
                active: 0,
                maxActive: 0,
                status: '',
                messages: [],
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.status = message; },
                async fakeSearchYouTube(query) {
                    this.active++;
                    this.maxActive = Math.max(this.maxActive, this.active);
                    await new Promise(resolve => setTimeout(resolve, 10));
                    this.active--;
                    return { videoId: query, title: query, channelTitle: 'Test', duration: '1:00', durationSeconds: 60 };
                }
            };
            PlayerPlaylist.install(harness);
            harness.searchYouTube = query => harness.fakeSearchYouTube(query);
            const validSongs = Array.from({ length: 9 }, (_, index) => ({
                index,
                song: { searchTerm: `term-${index}` }
            }));
            const incrementalOrder = [];
            const results = await harness.searchSongsWithConcurrency(validSongs, {
                concurrency: 3,
                onResult: result => incrementalOrder.push(result.videoData.videoId)
            });
            return {
                count: results.length,
                order: results.map(result => result.videoData.videoId).join('|'),
                incrementalCount: incrementalOrder.length,
                maxActive: harness.maxActive,
                status: harness.status
            };
        });
        report.check('player searches every YouTube term with bounded concurrency and per-result delivery',
            boundedSearch.count === 9
            && boundedSearch.order === 'term-0|term-1|term-2|term-3|term-4|term-5|term-6|term-7|term-8'
            && boundedSearch.incrementalCount === 9
            && boundedSearch.maxActive <= 3
            && boundedSearch.status.includes('Searched 9/9'));

        const alternateSearchResult = await tab.evaluate(async () => {
            const harness = {
                messages: [],
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); }
            };
            PlayerPlaylist.install(harness);
            const realFetch = window.fetch;
            window.fetch = async () => new Response(JSON.stringify({
                results: [
                    { videoId: 'bad-video', title: 'Bad Result', channelTitle: 'Bad Channel', duration: 100 },
                    { videoId: 'good-video', title: 'Good Result', channelTitle: 'Good Channel', duration: 120 }
                ],
                source: 'test'
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            const result = await harness.searchYouTube('retry song');
            window.fetch = realFetch;
            return {
                first: result.videoId,
                alternate: result.alternateVideos[0]?.videoId || '',
                message: harness.messages.find(message => message.label === 'Found')?.text || ''
            };
        });
        report.check('player stores alternate YouTube results for retry',
            alternateSearchResult.first === 'bad-video'
            && alternateSearchResult.alternate === 'good-video'
            && alternateSearchResult.message.includes('Bad Result'));

        // Studio-version-first ranking: live/cover/remix markers lose to
        // the studio upload unless the request asked for them, and Topic
        // (auto-generated album) uploads win outright. Key-level provider
        // errors are classified for the persistent banner.
        const versionRanking = await tab.evaluate(() => {
            const harness = { addMessage() {} };
            PlayerPlaylist.install(harness);
            PlayerCommands.install(harness);
            const videos = [
                { videoId: 'live-1', title: 'New Slang (Live at KEXP)', channelTitle: 'KEXP', duration: '4:10', durationSeconds: 250 },
                { videoId: 'cover-1', title: 'New Slang - cover by somebody', channelTitle: 'Somebody', duration: '3:50', durationSeconds: 230 },
                { videoId: 'studio-1', title: 'New Slang', channelTitle: 'The Shins - Topic', duration: '3:51', durationSeconds: 231 },
                { videoId: 'video-1', title: 'The Shins - New Slang (Official Music Video)', channelTitle: 'Sub Pop', duration: '3:52', durationSeconds: 232 },
                { videoId: 'full-1', title: 'The Shins - Full Performance', channelTitle: 'KEXP', duration: '40:58', durationSeconds: 2458 }
            ];
            const normal = harness.rankYouTubeResults(videos, { searchTerm: 'The Shins New Slang', artist: 'The Shins', name: 'New Slang' })
                .map(video => video.videoId);
            const liveRequested = harness.rankYouTubeResults(videos, { searchTerm: 'The Shins New Slang live kexp', artist: 'The Shins', name: 'New Slang' })
                .map(video => video.videoId);
            // A marker word inside the song's own name must not read as a
            // version request: "Cover Me Up" wants the studio track.
            const nameCollision = harness.rankYouTubeResults([
                { videoId: 'cmu-live', title: 'Jason Isbell - Cover Me Up | Live From Austin City Limits TV', channelTitle: 'ACL', duration: '5:00', durationSeconds: 300 },
                { videoId: 'cmu-studio', title: 'Cover Me Up', channelTitle: 'Jason Isbell - Topic', duration: '5:20', durationSeconds: 320 }
            ], { searchTerm: 'Jason Isbell Cover Me Up', artist: 'Jason Isbell', name: 'Cover Me Up' }).map(video => video.videoId);
            // A clean-titled recording that names the artist nowhere is
            // probably someone else's version (movie-cast covers).
            const wrongArtist = harness.rankYouTubeResults([
                { videoId: 'castcover-1', title: 'I Want To Hold Your Hand (Tracks On The Tracks Sessions)', channelTitle: 'Himesh Patel', duration: '3:20', durationSeconds: 200 },
                { videoId: 'plain-1', title: 'The Beatles - I Want To Hold Your Hand', channelTitle: 'SomeUploader', duration: '2:25', durationSeconds: 145 }
            ], { searchTerm: 'The Beatles I Want to Hold Your Hand', artist: 'The Beatles', name: 'I Want to Hold Your Hand' }).map(video => video.videoId);
            // The Fleet Foxes regression set (real proxy results): the
            // artist's official upload of a DIFFERENT song must never beat
            // the requested track; the auto-generated album track (Piped
            // strips " - Topic" from the channel, so the proxy's
            // isAlbumTrack flag is the signal) must beat renamed live
            // re-recordings ("Solstice Version") and date-stamped concert
            // uploads that carry no explicit live/concert marker.
            const lorelaiContext = { searchTerm: 'Fleet Foxes Lorelai', artist: 'Fleet Foxes', name: 'Lorelai' };
            const wrongSong = harness.rankYouTubeResults([
                { videoId: 'isles-1', title: 'Fleet Foxes - Isles (Official Audio)', channelTitle: 'Fleet Foxes', duration: '3:09', durationSeconds: 189 },
                { videoId: 'lorelai-1', title: 'Lorelai', channelTitle: 'Fleet Foxes', duration: '4:25', durationSeconds: 265, isAlbumTrack: true }
            ], lorelaiContext).map(video => video.videoId);
            const hbContext = { searchTerm: 'Fleet Foxes Helplessness Blues', artist: 'Fleet Foxes', name: 'Helplessness Blues' };
            const renamedLive = harness.rankYouTubeResults([
                { videoId: 'solstice-1', title: 'Fleet Foxes - "Helplessness Blues" (Solstice Version)', channelTitle: 'Fleet Foxes', duration: '5:04', durationSeconds: 304 },
                { videoId: 'hb-album', title: 'Helplessness Blues', channelTitle: 'Fleet Foxes', duration: '5:02', durationSeconds: 302, isAlbumTrack: true }
            ], hbContext).map(video => video.videoId);
            const wwhContext = { searchTerm: 'Fleet Foxes White Winter Hymnal', artist: 'Fleet Foxes', name: 'White Winter Hymnal' };
            const dateStamped = harness.rankYouTubeResults([
                { videoId: 'dated-1', title: 'Fleet Foxes - White Winter Hymnal - 2008-11-04', channelTitle: 'steelygray', duration: '2:57', durationSeconds: 177 },
                { videoId: 'wwh-video', title: 'Fleet Foxes - White Winter Hymnal (OFFICIAL VIDEO)', channelTitle: 'Sub Pop', duration: '2:28', durationSeconds: 148 }
            ], wwhContext).map(video => video.videoId);
            // Wrong-song and unrequested-version results are unacceptable
            // embed-failure fallbacks: only same-recording candidates may
            // enter the alternate list.
            const wrongSongAlternateScore = harness.scoreVideoCandidate(
                { videoId: 'isles-1', title: 'Fleet Foxes - Isles (Official Audio)', channelTitle: 'Fleet Foxes', duration: '3:09', durationSeconds: 189 },
                lorelaiContext
            );
            const plainUploadAlternateScore = harness.scoreVideoCandidate(
                { videoId: 'plain-lorelai', title: 'Fleet Foxes - Lorelai', channelTitle: 'greg g', duration: '4:26', durationSeconds: 266 },
                lorelaiContext
            );
            const quotaError = harness.classifyProviderError('claude', 429, { error: { type: 'rate_limit_error', message: 'Your credit balance is too low' } });
            const plainError = harness.classifyProviderError('openai', 500, { error: { message: 'server exploded' } });
            return {
                normalFirst: normal[0],
                normalLiveLast: normal.indexOf('live-1') > normal.indexOf('studio-1') && normal.indexOf('cover-1') > normal.indexOf('video-1'),
                normalFullSetLast: normal[normal.length - 1] === 'full-1',
                liveRequestedFirstIsLive: liveRequested[0] === 'live-1',
                nameCollisionFirst: nameCollision[0],
                wrongArtistFirst: wrongArtist[0],
                wrongSongFirst: wrongSong[0],
                renamedLiveFirst: renamedLive[0],
                dateStampedFirst: dateStamped[0],
                wrongSongAlternateScore,
                plainUploadAlternateScore,
                quotaName: quotaError.name,
                quotaProvider: quotaError.provider,
                plainName: plainError.name
            };
        });
        report.check(`player ranks studio versions first (${versionRanking.normalFirst}, name-collision pick ${versionRanking.nameCollisionFirst}, wrong-artist pick ${versionRanking.wrongArtistFirst}) and classifies key-level errors`,
            versionRanking.normalFirst === 'studio-1'
            && versionRanking.normalLiveLast
            && versionRanking.normalFullSetLast
            && versionRanking.liveRequestedFirstIsLive
            && versionRanking.nameCollisionFirst === 'cmu-studio'
            && versionRanking.wrongArtistFirst === 'plain-1'
            && versionRanking.quotaName === 'ApiKeyError'
            && versionRanking.quotaProvider === 'claude'
            && versionRanking.plainName === 'Error');
        report.check(`player never picks the artist's official upload of a different song (${versionRanking.wrongSongFirst}), beats renamed live re-recordings (${versionRanking.renamedLiveFirst}) and date-stamped concert uploads (${versionRanking.dateStampedFirst})`,
            versionRanking.wrongSongFirst === 'lorelai-1'
            && versionRanking.renamedLiveFirst === 'hb-album'
            && versionRanking.dateStampedFirst === 'wwh-video');
        report.check('player alternate filter rejects wrong-song candidates and keeps same-recording uploads',
            versionRanking.wrongSongAlternateScore < 0
            && versionRanking.plainUploadAlternateScore >= 0);

        const singlePlayerCreation = await tab.evaluate(async () => {
            const harness = {
                players: new Map(),
                playerReadyPromises: new Map(),
                playlist: [],
                favorites: {},
                messages: [],
                isFavorite() { return false; },
                escapeHtml(value) { return String(value || ''); },
                showLyricsForItem() {},
                lyricsRowMarker() { return { label: '\u00b7', className: '', aria: 'Get lyrics' }; },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); }
            };
            PlayerPlaylist.install(harness);
            const item = {
                id: 4001,
                videoId: 'lazy-video-id',
                name: 'Lazy Song',
                artist: 'Lazy Artist',
                year: '',
                album: '',
                title: 'Lazy Song',
                channelTitle: 'Lazy Artist',
                duration: '2:00',
                comment: '',
                searchTerm: 'Lazy Artist Lazy Song'
            };
            const realYT = window.YT;
            window.YT = undefined;
            harness.addPlaylistItemToDOM(item);
            const beforeEnsure = {
                hasEntry: harness.playerReadyPromises.has(item.id),
                hasPlayerDiv: !!document.getElementById('active-youtube-player')
            };
            harness.ensurePlaylistPlayer(item);
            const afterEnsure = {
                hasEntry: harness.playerReadyPromises.has(item.id),
                hasPlayerDiv: !!document.getElementById('active-youtube-player')
            };
            await new Promise(resolve => setTimeout(resolve, 80));
            window.youtubeApiReady = [];
            document.querySelector(`[data-item-id="${item.id}"]`)?.remove();
            document.getElementById('active-youtube-player')?.remove();
            window.YT = realYT;
            return { beforeEnsure, afterEnsure };
        });
        report.check('player creates one YouTube iframe on first play',
            singlePlayerCreation.beforeEnsure.hasEntry === false
            && singlePlayerCreation.beforeEnsure.hasPlayerDiv === false
            && singlePlayerCreation.afterEnsure.hasEntry === true
            && singlePlayerCreation.afterEnsure.hasPlayerDiv === true);

        const playerVarsIdentity = await tab.evaluate(() => {
            const calls = [];
            const harness = {
                players: new Map(),
                playerReadyPromises: new Map(),
                addMessage() {}
            };
            PlayerPlaylist.install(harness);
            const realYT = window.YT;
            window.YT = {
                PlayerState: { ENDED: 0 },
                Player: function (id, config) {
                    calls.push({ id, playerVars: config.playerVars });
                    return { destroy() {} };
                }
            };
            const container = document.createElement('div');
            container.id = 'player-identity-container';
            document.getElementById('playlistContainer').appendChild(container);
            const item = {
                id: 4002,
                videoId: 'identity-id',
                name: 'Identity Song',
                artist: 'Identity Artist',
                searchTerm: 'Identity Artist Identity Song'
            };
            harness.createPlaylistPlayer(item);
            return new Promise(resolve => {
                setTimeout(() => {
                    document.getElementById('active-youtube-player')?.remove();
                    container.remove();
                    window.YT = realYT;
                    const playerVars = calls[0]?.playerVars || {};
                    resolve({
                        enablejsapi: playerVars.enablejsapi,
                        playsinline: playerVars.playsinline,
                        originMatches: playerVars.origin === window.location.origin,
                        widgetReferrerMatches: playerVars.widget_referrer === window.location.origin
                    });
                }, 100);
            });
        });
        report.check('player sends YouTube origin and referrer identity',
            playerVarsIdentity.enablejsapi === 1
            && playerVarsIdentity.playsinline === 1
            && playerVarsIdentity.originMatches
            && playerVarsIdentity.widgetReferrerMatches);

        const alternateRetry = await tab.evaluate(async () => {
            const harness = {
                players: new Map(),
                playerReadyPromises: new Map(),
                youtubeAlternateResults: new Map(),
                messages: [],
                status: '',
                settings: { readClaudeResponse: false },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.status = message; },
                truncateForStatus(text) { return String(text || ''); },
                speakText() {}
            };
            PlayerPlaylist.install(harness);
            let recreatedVideoId = '';
            let playedVideoId = '';
            let persisted = false;
            harness.recreatePlaylistPlayer = item => { recreatedVideoId = item.videoId; };
            harness.refreshPlaylistRowVideo = () => {};
            harness.persistPlaylist = () => { persisted = true; };
            harness.playVideo = item => { playedVideoId = item.videoId; return Promise.resolve(); };
            const item = {
                id: 45,
                videoId: 'bad-video',
                name: 'Retry Song',
                artist: 'Retry Artist',
                title: 'Bad Result',
                channelTitle: 'Bad Channel',
                duration: '1:40',
                durationSeconds: 100,
                searchTerm: 'Retry Artist Retry Song',
                lyricsStatus: 'idle',
                lyricsData: null
            };
            harness.youtubeAlternateResults.set(item.id, [{
                videoId: 'good-video',
                title: 'Good Result',
                channelTitle: 'Good Channel',
                duration: '2:00',
                durationSeconds: 120
            }]);
            harness.reportPlayerLoadFailure(item, 'YouTube player error 150');
            return {
                videoId: item.videoId,
                title: item.title,
                remaining: harness.youtubeAlternateResults.get(item.id)?.length || 0,
                recreatedVideoId,
                playedVideoId,
                persisted,
                retryReason: harness.messages.find(message => message.label === 'Retrying video result')?.text || '',
                hasRetryLog: harness.messages.some(message => message.label === 'Retrying video result'),
                hasFailureLog: harness.messages.some(message => message.label === 'Player load failed')
            };
        });
        report.check('player retries alternate video before final load failure',
            alternateRetry.videoId === 'good-video'
            && alternateRetry.title === 'Good Result'
            && alternateRetry.remaining === 0
            && alternateRetry.recreatedVideoId === 'good-video'
            && alternateRetry.playedVideoId === 'good-video'
            && alternateRetry.persisted
            && alternateRetry.retryReason.includes('owner disabled embedded playback')
            && alternateRetry.hasRetryLog
            && !alternateRetry.hasFailureLog);

        const nonVideoSpecificNoRetry = await tab.evaluate(async () => {
            const harness = {
                playerReadyPromises: new Map(),
                youtubeAlternateResults: new Map(),
                messages: [],
                status: '',
                settings: { readClaudeResponse: false },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.status = message; },
                truncateForStatus(text) { return String(text || ''); },
                speakText() {}
            };
            PlayerPlaylist.install(harness);
            let recreated = false;
            let played = false;
            harness.recreatePlaylistPlayer = () => { recreated = true; };
            harness.refreshPlaylistRowVideo = () => {};
            harness.persistPlaylist = () => {};
            harness.playVideo = () => { played = true; return Promise.resolve(); };
            const item = {
                id: 46,
                videoId: 'slow-video',
                name: 'Slow Song',
                artist: 'Slow Artist',
                title: 'Slow Song',
                channelTitle: 'Slow Artist',
                searchTerm: 'Slow Artist Slow Song',
                lyricsStatus: 'idle',
                lyricsData: null
            };
            harness.youtubeAlternateResults.set(item.id, [{
                videoId: 'other-video',
                title: 'Other Result',
                channelTitle: 'Other Channel',
                duration: '2:00',
                durationSeconds: 120
            }]);
            harness.reportPlayerLoadFailure(item, 'Player did not become ready within 8s');
            return {
                videoId: item.videoId,
                recreated,
                played,
                status: harness.status,
                hasRetryLog: harness.messages.some(message => message.label === 'Retrying video result'),
                hasFailureLog: harness.messages.some(message => message.label === 'Player load failed')
            };
        });
        report.check('player does not retry alternates for non-video-specific timeouts',
            nonVideoSpecificNoRetry.videoId === 'slow-video'
            && !nonVideoSpecificNoRetry.recreated
            && !nonVideoSpecificNoRetry.played
            && nonVideoSpecificNoRetry.status.includes('Player load failed')
            && !nonVideoSpecificNoRetry.hasRetryLog
            && nonVideoSpecificNoRetry.hasFailureLog);

        const playerLoadTimeout = await tab.evaluate(async () => {
            const harness = {
                playerReadyPromises: new Map(),
                messages: [],
                status: '',
                settings: { readClaudeResponse: false },
                addMessage(kind, label, text) { this.messages.push({ kind, label, text }); },
                updateStatus(message) { this.status = message; },
                truncateForStatus(text, maxLength = 120) {
                    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
                    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
                },
                speakText() {}
            };
            PlayerPlaylist.install(harness);
            const item = {
                id: 44,
                videoId: 'slow-video',
                name: 'Slow Song',
                artist: 'Slow Artist',
                title: 'Slow Song',
                channelTitle: 'Slow Artist',
                searchTerm: 'Slow Artist Slow Song'
            };
            harness.playerReadyPromises.set(item.id, { promise: new Promise(() => {}), resolve() {} });
            const ready = await harness.waitForPlayerReady(item, 5);
            await harness.reportPlayerLoadFailure(item, ready.error);
            const failureLog = harness.messages.find(message => message.label === 'Player load failed');
            return {
                ok: ready.ok,
                status: harness.status,
                text: failureLog?.text || ''
            };
        });
        report.check('player loading timeout exposes track and search term',
            playerLoadTimeout.ok === false
            && playerLoadTimeout.status.includes('Slow Song')
            && playerLoadTimeout.text.includes('slow-video')
            && playerLoadTimeout.text.includes('Slow Artist Slow Song'));

        // Auto mode: spoken control command executes locally

        playerVoiceErrors
            .filter(e => !e.includes('offline test'))
            .forEach(e => report.errors.push(e));
        await ctx.close();
    }

    await browser.close();
    report.finish();
})();
