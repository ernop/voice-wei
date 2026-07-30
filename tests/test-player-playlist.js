// @ts-check
// player playlist and lyric store product behavior, extracted from the retired tab-functions monolith.

const { BASE_URL, launchWithMic, collectErrors, instrumentVoices, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('player playlist and lyric store');
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

        const playlistSourceGroups = await tab.evaluate(() => {
            const harness = {
                favorites: {},
                isFavorite() { return false; },
                escapeHtml(value) { return String(value || ''); },
                showLyricsForItem() {},
                lyricsRowMarker(item) {
                    return item.lyricsStatus === 'ready'
                        ? { label: '\u2713', className: 'timed', aria: 'Timed lyrics (line-synced) - tap to view' }
                        : { label: '\u00b7', className: '', aria: 'Get lyrics' };
                }
            };
            PlayerPlaylist.install(harness);
            const body = document.getElementById('playlistBody');
            body.innerHTML = '';
            harness.addPlaylistItemToDOM({
                id: 501,
                videoId: 'restored-video',
                name: 'Restored Song',
                artist: 'Restored Artist',
                year: '',
                album: '',
                title: 'Restored Song',
                channelTitle: 'Restored Artist',
                duration: '1:00',
                comment: 'Loaded before this page session',
                searchTerm: 'Restored Artist Restored Song',
                sourceKind: 'restored',
                sourceLabel: 'Known at load'
            });
            harness.addPlaylistItemToDOM({
                id: 502,
                videoId: 'search-video',
                name: 'Search Song',
                artist: 'Search Artist',
                year: '',
                album: '',
                title: 'Search Song',
                channelTitle: 'Search Artist',
                duration: '1:00',
                comment: 'Included because it matches the requested search',
                searchTerm: 'Search Artist Search Song',
                sourceKind: 'search',
                sourceLabel: 'Search: Search Artist Search Song',
                sourceSearchTerm: 'Search Artist Search Song'
            });
            const rows = Array.from(body.querySelectorAll('.playlist-row'));
            const dataRows = rows.map(row => row.dataset.itemId);
            // One flat data line per row: leading gutter (star + lyric
            // marker), name, meta, duration, and remove; the note is the
            // only extra element (own line, Notes toggle).
            const slots = rows.map(row => ({
                name: row.querySelector(':scope > .playlist-song-name')?.textContent || '',
                duration: row.querySelector(':scope > .playlist-song-duration')?.textContent || '',
                artist: row.querySelector(':scope > .playlist-row-meta .playlist-song-artist')?.textContent || '',
                hasLeading: !!row.querySelector(':scope > .playlist-row-leading'),
                hasStar: !!row.querySelector('.playlist-row-leading > .favorite-btn'),
                hasMarker: !!row.querySelector('.playlist-row-leading > .lyrics-row-btn'),
                hasRemove: !!row.querySelector(':scope > .playlist-remove-btn'),
                nestedWrappers: row.querySelectorAll(':scope > div:not(.playlist-song-comment):not(.playlist-row-leading)').length
            }));
            const comments = Array.from(body.querySelectorAll('.playlist-song-comment')).map(el => el.textContent);
            body.innerHTML = '';
            return { dataRows, slots, comments };
        });
        report.check('player playlist rows are one flat data line with fixed slots',
            playlistSourceGroups.dataRows.includes('501')
            && playlistSourceGroups.dataRows.includes('502')
            && playlistSourceGroups.slots.every(slot => slot.name && slot.duration && slot.artist
                && slot.hasLeading && slot.hasStar && slot.hasMarker && slot.hasRemove && slot.nestedWrappers === 0)
            && playlistSourceGroups.comments.some(comment =>
                comment.includes('Included because it matches the requested search')));

        // Leading gutter (star + lyric marker): taps there must not start
        // playback; only the row body plays. Markers: ✓ timed, ~ non-timed.
        const starGutterAndMarkers = await tab.evaluate(() => {
            const harness = {
                favorites: {},
                playlist: [],
                playedIds: /** @type {number[]} */ ([]),
                isFavorite() { return false; },
                escapeHtml(value) { return String(value || ''); },
                showLyricsForItem() {},
                playVideo(item) { this.playedIds.push(item.id); },
                lyricsRowMarker(item) {
                    if (item.lyricsStatus === 'ready' && item.lyricsData?.syncedLines?.length) {
                        return { label: '\u2713', className: 'timed', aria: 'Timed lyrics (line-synced) - tap to view' };
                    }
                    if (item.lyricsStatus === 'ready') {
                        return { label: '~', className: 'simple', aria: 'Simple lyrics (text only) - tap to view' };
                    }
                    return { label: '\u00b7', className: '', aria: 'Get lyrics' };
                }
            };
            PlayerPlaylist.install(harness);
            harness.playVideo = item => harness.playedIds.push(item.id);
            const body = document.getElementById('playlistBody');
            body.innerHTML = '';
            const timed = {
                id: 701, videoId: 'v-sync', name: 'Sync Song', artist: 'A', year: '', album: '',
                title: 'Sync Song', channelTitle: 'A', duration: '1:00', comment: '', searchTerm: '',
                lyricsStatus: 'ready', lyricsData: { syncedLines: [{ time: 1, text: 'hi' }], plainLyrics: '' }
            };
            const simple = {
                id: 702, videoId: 'v-text', name: 'Text Song', artist: 'B', year: '', album: '',
                title: 'Text Song', channelTitle: 'B', duration: '1:00', comment: '', searchTerm: '',
                lyricsStatus: 'ready', lyricsData: { syncedLines: [], plainLyrics: 'hi' }
            };
            harness.playlist.push(timed, simple);
            harness.addPlaylistItemToDOM(timed);
            harness.addPlaylistItemToDOM(simple);
            const row1 = document.querySelector('.playlist-row[data-item-id="701"]');
            const leading = row1.querySelector('.playlist-row-leading');
            leading.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const afterLeading = harness.playedIds.slice();
            row1.querySelector('.playlist-song-name').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const afterName = harness.playedIds.slice();
            const markers = Array.from(body.querySelectorAll('.lyrics-row-btn')).map(btn => btn.textContent);
            body.innerHTML = '';
            return { afterLeading, afterName, markers };
        });
        report.check('player star gutter taps do not play; row body does',
            starGutterAndMarkers.afterLeading.length === 0
            && starGutterAndMarkers.afterName.length === 1
            && starGutterAndMarkers.afterName[0] === 701);
        report.check('player lyric markers are check for timed and tilde for simple',
            starGutterAndMarkers.markers.includes('\u2713')
            && starGutterAndMarkers.markers.includes('~'));

        const lyricsStoreChecks = await tab.evaluate(async () => {
            const run = Date.now();
            const makeHarness = (favorites = {}) => {
                const harness = {
                    playlist: [],
                    favorites,
                    youtubeAlternateResults: new Map(),
                    lyricsLookupCache: new Map(),
                    lyricsFetchQueue: [],
                    lyricsFetchActive: 0,
                    lyricsLookupsInFlight: new Map(),
                    currentLyricsItemId: null,
                    currentLyricsLineIndex: -1,
                    lyricsPanelVisible: false,
                    lyricsPanelDismissed: false,
                    nowPlayingShowsText: false,
                    settings: { lyricsOnNowPlaying: false, songDisplayMode: 'identity', songReportIntervalSeconds: 8 },
                    isFavorite() { return false; },
                    escapeHtml(value) { return String(value || ''); },
                    truncateForStatus(value) { return String(value || ''); },
                    addMessage() {},
                    updateStatus() {},
                    persistPlaylist() {},
                    updatePlaylistLabel() {},
                    showPlaylistSurfaces() {}
                };
                PlayerPlaylist.install(harness);
                PlayerSongReport.install(harness);
                PlayerLyrics.install(harness);
                harness.addPlaylistItemToDOM = () => {};
                harness.addPlaylistItemsToDOM = () => {};
                harness.lookups = 0;
                harness.inFlight = 0;
                harness.maxInFlight = 0;
                harness.lookupLyrics = async (item) => {
                    harness.lookups++;
                    harness.inFlight++;
                    harness.maxInFlight = Math.max(harness.maxInFlight, harness.inFlight);
                    await new Promise(resolve => setTimeout(resolve, 30));
                    harness.inFlight--;
                    if (item.name.startsWith('Missing')) return null;
                    return {
                        provider: 'LRCLIB', trackName: item.name, artistName: item.artist,
                        albumName: '', duration: 100, instrumental: false,
                        plainLyrics: 'la la', syncedLyrics: null, syncedLines: []
                    };
                };
                return harness;
            };
            const makeItem = (name) => PlayerSongs.createPlaylistItem({
                videoId: `lyr-${run}-${name.replace(/\s+/g, '-')}`,
                name, artist: 'Queue Artist', duration: '1:40', durationSeconds: 100,
                searchTerm: `Queue Artist ${name}`
            }, { sourceKind: 'search', sourceLabel: 'test' });
            const drain = async (harness) => {
                for (let i = 0; i < 200; i++) {
                    if (harness.lyricsFetchActive === 0 && harness.lyricsFetchQueue.length === 0
                        && harness.lyricsLookupsInFlight.size === 0
                        && harness.playlist.every(item => item.lyricsStatus !== 'idle' && item.lyricsStatus !== 'loading')) {
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, 25));
                }
                return false;
            };

            // Session 1: six songs added at once resolve through the bounded
            // queue; each answer is saved to the permanent store (IndexedDB
            // lyricStates) as it arrives.
            const first = makeHarness();
            ['Song One', 'Song Two', 'Song Three', 'Song Four', 'Song Five', 'Missing Song']
                .forEach(name => first.appendPlaylistItem(makeItem(name)));
            const firstSettled = await drain(first);
            const missingState = await PlayerHistoryDB.getLyricState(`lyr-${run}-Missing-Song`);
            const foundState = await PlayerHistoryDB.getLyricState(`lyr-${run}-Song-One`);
            const storedPerSong = !!missingState && missingState.status === 'none'
                && !!foundState && foundState.status === 'found'
                && !!foundState.lyrics && foundState.lyrics.plainLyrics === 'la la';

            // Session 2 (interrupted-then-reopened): fresh page state, same
            // permanent store. Resolved songs settle from the store with
            // ZERO provider lookups; only the never-seen song hits it.
            const second = makeHarness();
            second.appendPlaylistItem(makeItem('Song One'));
            second.appendPlaylistItem(makeItem('Missing Song'));
            await drain(second);
            const resumedFromStore = second.playlist[0].lyricsStatus === 'ready'
                && !!second.playlist[0].lyricsData
                && second.playlist[1].lyricsStatus === 'not_found'
                && second.lookups === 0;
            second.appendPlaylistItem(makeItem('Song Never Seen'));
            const secondSettled = await drain(second);
            const newSongLookups = second.lookups;

            // Tapping the chip on a stored "none" forces a provider recheck.
            const missingItem = second.playlist[1];
            await second.showLyricsForItem(missingItem);
            const chipRetried = second.lookups === 2 && missingItem.lyricsStatus === 'not_found';
            second.setLyricsPanelVisible(false);

            return {
                firstSettled,
                maxInFlight: first.maxInFlight,
                firstLookups: first.lookups,
                storedPerSong,
                resumedFromStore,
                secondSettled,
                newSongLookups,
                chipRetried
            };
        });
        report.check(`player lyric queue is bounded and resumes from the store after reload (max in-flight ${lyricsStoreChecks.maxInFlight}, resume lookups ${lyricsStoreChecks.newSongLookups})`,
            lyricsStoreChecks.firstSettled
            && lyricsStoreChecks.maxInFlight === 2
            && lyricsStoreChecks.firstLookups === 6
            && lyricsStoreChecks.storedPerSong
            && lyricsStoreChecks.resumedFromStore
            && lyricsStoreChecks.secondSettled
            && lyricsStoreChecks.newSongLookups === 1
            && lyricsStoreChecks.chipRetried);

        const lyricsIntegrityChecks = await tab.evaluate(async () => {
            const run = Date.now();
            const makeHarness = (favorites = {}) => {
                const harness = {
                    playlist: [],
                    favorites,
                    youtubeAlternateResults: new Map(),
                    lyricsLookupCache: new Map(),
                    lyricsFetchQueue: [],
                    lyricsFetchActive: 0,
                    lyricsLookupsInFlight: new Map(),
                    currentLyricsItemId: null,
                    currentLyricsLineIndex: -1,
                    lyricsPanelVisible: false,
                    lyricsPanelDismissed: false,
                    nowPlayingShowsText: false,
                    settings: { lyricsOnNowPlaying: false, songDisplayMode: 'identity', songReportIntervalSeconds: 8 },
                    isFavorite() { return false; },
                    escapeHtml(value) { return String(value || ''); },
                    truncateForStatus(value) { return String(value || ''); },
                    addMessage() {},
                    updateStatus() {},
                    persistPlaylist() {},
                    updatePlaylistLabel() {},
                    showPlaylistSurfaces() {}
                };
                PlayerPlaylist.install(harness);
                PlayerSongReport.install(harness);
                PlayerLyrics.install(harness);
                harness.addPlaylistItemToDOM = () => {};
                harness.addPlaylistItemsToDOM = () => {};
                return harness;
            };
            const makeItem = (name) => PlayerSongs.createPlaylistItem({
                videoId: `int-${run}-${name.replace(/\s+/g, '-')}`,
                name, artist: 'Integrity Artist', duration: '1:40', durationSeconds: 100,
                searchTerm: `Integrity Artist ${name}`
            }, { sourceKind: 'search', sourceLabel: 'test' });
            const drain = async (harness) => {
                for (let i = 0; i < 200; i++) {
                    if (harness.lyricsFetchActive === 0 && harness.lyricsFetchQueue.length === 0
                        && harness.lyricsLookupsInFlight.size === 0) return true;
                    await new Promise(resolve => setTimeout(resolve, 25));
                }
                return false;
            };

            // Provider FAILURE saves nothing and lands in 'error' (retried
            // on next use); an ANSWERED empty saves a durable 'none'.
            const failing = makeHarness();
            failing.searchLyricsProvider = async () => { throw new Error('HTTP 429'); };
            const failedItem = makeItem('Rate Limited Song');
            failing.playlist.push(failedItem);
            await failing.ensureLyricsForItem(failedItem);
            const failedState = await PlayerHistoryDB.getLyricState(failedItem.videoId);
            const failureIsError = failedItem.lyricsStatus === 'error' && failedState === null;
            failing.searchLyricsProvider = async () => [];
            failing.lyricsLookupCache.clear();
            const emptyItem = makeItem('Truly Missing Song');
            failing.playlist.push(emptyItem);
            await failing.ensureLyricsForItem(emptyItem);
            const emptyState = await PlayerHistoryDB.getLyricState(emptyItem.videoId);
            const answeredEmptyIsNone = emptyItem.lyricsStatus === 'not_found'
                && !!emptyState && emptyState.status === 'none';

            // Save-then-activate: at the moment the store write happens the
            // live item must NOT yet be activated (status still 'loading').
            const ordering = makeHarness();
            ordering.lookupLyrics = async (item) => ({
                provider: 'LRCLIB', trackName: item.name, artistName: item.artist,
                albumName: '', duration: 100, instrumental: false,
                plainLyrics: 'order', syncedLyrics: null, syncedLines: []
            });
            const orderedItem = makeItem('Ordering Song');
            ordering.playlist.push(orderedItem);
            const realPut = PlayerHistoryDB.putLyricState;
            let statusAtSaveTime = '';
            PlayerHistoryDB.putLyricState = async (record) => {
                statusAtSaveTime = orderedItem.lyricsStatus;
                return realPut(record);
            };
            await ordering.ensureLyricsForItem(orderedItem);
            PlayerHistoryDB.putLyricState = realPut;
            const savedBeforeActivated = statusAtSaveTime === 'loading'
                && orderedItem.lyricsStatus === 'ready';

            // Reconcile is per song against the store: first pass resolves
            // both favorites at the provider; a later pass with one new
            // favorite looks up exactly that one.
            const fav = (name) => ({
                videoId: `int-${run}-fav-${name}`,
                name: `Favorite ${name}`, artist: 'Integrity Artist',
                title: `Integrity Artist - Favorite ${name}`,
                duration: '1:40', durationSeconds: 100, searchTerm: name
            });
            const reconcile = makeHarness({ a: fav('A'), b: fav('B') });
            reconcile.lookups = 0;
            reconcile.lookupLyrics = async (item) => {
                reconcile.lookups++;
                await new Promise(resolve => setTimeout(resolve, 20));
                return {
                    provider: 'LRCLIB', trackName: item.name, artistName: item.artist,
                    albumName: '', duration: 100, instrumental: false,
                    plainLyrics: 'la', syncedLyrics: null, syncedLines: []
                };
            };
            reconcile.reconcileLibraryLyrics();
            await drain(reconcile);
            const firstPassLookups = reconcile.lookups;
            const nextLoad = makeHarness({ a: fav('A'), b: fav('B'), c: fav('C') });
            nextLoad.lookups = 0;
            nextLoad.lookupLyrics = reconcile.lookupLyrics;
            nextLoad.reconcileLibraryLyrics();
            await drain(nextLoad);
            const secondPassLookups = reconcile.lookups - firstPassLookups;

            return { failureIsError, answeredEmptyIsNone, savedBeforeActivated, firstPassLookups, secondPassLookups };
        });
        report.check(`player lyric store integrity: failures unsaved, save-before-activate, per-song reconcile (${lyricsIntegrityChecks.firstPassLookups}+${lyricsIntegrityChecks.secondPassLookups} lookups)`,
            lyricsIntegrityChecks.failureIsError
            && lyricsIntegrityChecks.answeredEmptyIsNone
            && lyricsIntegrityChecks.savedBeforeActivated
            && lyricsIntegrityChecks.firstPassLookups === 2
            && lyricsIntegrityChecks.secondPassLookups === 1);

        const sharedVideoLyricJob = await tab.evaluate(async () => {
            const run = Date.now();
            const makeItem = (videoId, sourceKind) => PlayerSongs.createPlaylistItem({
                videoId,
                name: 'Shared Song',
                artist: 'Shared Artist',
                title: 'Shared Artist - Shared Song',
                channelTitle: 'Shared Artist',
                duration: '2:00',
                durationSeconds: 120
            }, { sourceKind, sourceLabel: 'Shared lyric test' });
            const harness = {
                playlist: [],
                settings: { playlistTimedOnly: false },
                lyricsFetchQueue: [],
                lyricsFetchActive: 0,
                lyricsLookupsInFlight: new Map(),
                currentLyricsItemId: null,
                currentPlayingId: null,
                itemAwaitsFavoriteVideoIdentityRepair() { return false; },
                refreshLyricsRowButton() {},
                renderLyricsStateForItem() {},
                updateLyricOffsetControls() {},
                resyncProgressClock() {},
                addMessage() {},
                describePlaylistItem(item) { return item.name; }
            };
            PlayerLyrics.install(harness);
            const drain = async () => {
                for (let index = 0; index < 200; index++) {
                    if (harness.lyricsFetchActive === 0
                        && harness.lyricsFetchQueue.length === 0
                        && harness.lyricsLookupsInFlight.size === 0) return;
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                throw new Error('Shared lyric job did not settle');
            };

            const videoId = `shared-success-${run}`;
            const live = makeItem(videoId, 'favorite');
            const backfill = makeItem(videoId, 'backfill');
            harness.playlist = [live];
            let successLookups = 0;
            harness.lookupLyrics = async item => {
                successLookups++;
                await new Promise(resolve => setTimeout(resolve, 20));
                return {
                    provider: 'LRCLIB',
                    trackName: item.name,
                    artistName: item.artist,
                    albumName: '',
                    duration: 120,
                    instrumental: false,
                    plainLyrics: 'shared',
                    syncedLyrics: '[00:01.00]shared',
                    syncedLines: [{ time: 1, text: 'shared' }]
                };
            };
            harness.queueLyricsLookup(backfill);
            harness.queueLyricsLookup(live);
            await drain();

            const failedVideoId = `shared-failure-${run}`;
            const failedA = makeItem(failedVideoId, 'favorite');
            const failedB = makeItem(failedVideoId, 'history');
            harness.playlist = [failedA, failedB];
            let failedLookups = 0;
            harness.lookupLyrics = async () => {
                failedLookups++;
                await new Promise(resolve => setTimeout(resolve, 20));
                throw new Error('provider unavailable');
            };
            harness.queueLyricsLookup(failedA);
            harness.queueLyricsLookup(failedB);
            await drain();

            const simpleVideoId = `shared-simple-${run}`;
            const simpleA = makeItem(simpleVideoId, 'favorite');
            const simpleB = makeItem(simpleVideoId, 'history');
            const simpleLyrics = {
                provider: 'LRCLIB',
                trackName: 'Shared Song',
                artistName: 'Shared Artist',
                albumName: '',
                duration: 120,
                instrumental: false,
                plainLyrics: 'simple baseline',
                syncedLyrics: null,
                syncedLines: []
            };
            simpleA.lyricsStatus = 'ready';
            simpleA.lyricsData = simpleLyrics;
            harness.playlist = [simpleA, simpleB];
            let simpleUpgradeLookups = 0;
            harness.lookupLyrics = async () => {
                simpleUpgradeLookups++;
                throw new Error('upgrade unavailable');
            };
            await harness.ensureLyricsForItem(simpleA);

            const directVideoId = `shared-direct-${run}`;
            const direct = makeItem(directVideoId, 'favorite');
            harness.playlist = [direct];
            await PlayerHistoryDB.putLyricState({
                videoId: directVideoId,
                status: 'none',
                checkedAt: Date.now(),
                searchVersion: 3
            });
            const realPump = harness.pumpLyricsQueue;
            harness.pumpLyricsQueue = () => {};
            harness.queueLyricsLookup(direct);
            const directQueuedBefore = harness.lyricsQueuedVideoIds.has(directVideoId);
            let directForceLookups = 0;
            harness.lookupLyrics = async item => {
                directForceLookups++;
                return {
                    ...simpleLyrics,
                    trackName: item.name,
                    artistName: item.artist,
                    syncedLyrics: '[00:01.00]forced',
                    syncedLines: [{ time: 1, text: 'forced' }]
                };
            };
            await harness.ensureLyricsForItem(direct, { forceLookup: true });
            harness.pumpLyricsQueue = realPump;
            harness.pumpLyricsQueue();
            await drain();

            const stale = makeItem(`shared-stale-old-${run}`, 'favorite');
            harness.playlist = [stale];
            harness.pumpLyricsQueue = () => {};
            harness.queueLyricsLookup(stale);
            const staleOldVideoId = stale.videoId;
            stale.videoId = `shared-stale-new-${run}`;
            harness.queueLyricsLookup(stale);
            const staleCapturedIds = harness.lyricsFetchQueue.map(entry => entry.videoId);
            let staleLookups = 0;
            harness.lookupLyrics = async item => {
                staleLookups++;
                return { ...simpleLyrics, trackName: item.name, artistName: item.artist };
            };
            harness.pumpLyricsQueue = realPump;
            harness.pumpLyricsQueue();
            await drain();

            const keptBackfill = makeItem(`shared-clear-backfill-${run}`, 'backfill');
            const droppedPlaylist = makeItem(`shared-clear-playlist-${run}`, 'favorite');
            harness.lyricsFetchQueue = [
                { videoId: keptBackfill.videoId, item: keptBackfill },
                { videoId: droppedPlaylist.videoId, item: droppedPlaylist }
            ];
            harness.lyricsQueuedVideoIds = new Set([keptBackfill.videoId, droppedPlaylist.videoId]);
            harness.dropPlaylistLyricsQueueEntries();

            return {
                successLookups,
                liveStatus: live.lyricsStatus,
                backfillStatus: backfill.lyricsStatus,
                sameLyrics: live.lyricsData === backfill.lyricsData,
                failedLookups,
                failedStatuses: [failedA.lyricsStatus, failedB.lyricsStatus],
                simpleUpgradeLookups,
                simpleStatuses: [simpleA.lyricsStatus, simpleB.lyricsStatus],
                simpleShared: simpleA.lyricsData === simpleB.lyricsData,
                directQueuedBefore,
                directForceLookups,
                directStatus: direct.lyricsStatus,
                directQueueCleared: !harness.lyricsQueuedVideoIds.has(directVideoId),
                staleOldVideoId,
                staleCapturedIds,
                staleLookups,
                staleStatus: stale.lyricsStatus,
                clearQueueIds: harness.lyricsFetchQueue.map(entry => entry.videoId),
                clearSetIds: [...harness.lyricsQueuedVideoIds]
            };
        });
        report.check('player lyric queue coordinates one job and broadcasts success per video',
            sharedVideoLyricJob.successLookups === 1
            && sharedVideoLyricJob.liveStatus === 'ready'
            && sharedVideoLyricJob.backfillStatus === 'ready'
            && sharedVideoLyricJob.sameLyrics);
        report.check('player lyric queue broadcasts one retryable failure to every live row',
            sharedVideoLyricJob.failedLookups === 1
            && sharedVideoLyricJob.failedStatuses.every(status => status === 'error'));
        report.check('player simple-lyrics upgrade failure preserves one shared simple baseline',
            sharedVideoLyricJob.simpleUpgradeLookups === 1
            && sharedVideoLyricJob.simpleStatuses.every(status => status === 'ready')
            && sharedVideoLyricJob.simpleShared);
        report.check('player direct force lookup consumes its queued job without duplicate work',
            sharedVideoLyricJob.directQueuedBefore
            && sharedVideoLyricJob.directForceLookups === 1
            && sharedVideoLyricJob.directStatus === 'ready'
            && sharedVideoLyricJob.directQueueCleared);
        report.check('player lyric queue skips captured stale video identity and resolves replacement once',
            sharedVideoLyricJob.staleCapturedIds.length === 2
            && sharedVideoLyricJob.staleCapturedIds[0] === sharedVideoLyricJob.staleOldVideoId
            && sharedVideoLyricJob.staleLookups === 1
            && sharedVideoLyricJob.staleStatus === 'ready');
        report.check('player playlist clear keeps queue and queued-ID Set aligned for backfills',
            sharedVideoLyricJob.clearQueueIds.length === 1
            && sharedVideoLyricJob.clearQueueIds[0] === sharedVideoLyricJob.clearSetIds[0]);

        const lyricProviderIdentityEvidence = await tab.evaluate(async () => {
            const makeHarness = () => {
                const harness = {
                    lyricsLookupCache: new Map(),
                    addMessage() {}
                };
                PlayerLyrics.install(harness);
                return harness;
            };
            const item = {
                name: 'Sun', artist: 'Right Artist', album: 'Right Album',
                title: '', channelTitle: '', duration: '3:00', durationSeconds: 180
            };
            const record = (trackName, artistName, synced = true) => ({
                trackName, artistName, albumName: 'Right Album', duration: 180,
                plainLyrics: 'words',
                syncedLyrics: synced ? '[00:01.00]words' : null
            });

            const wrongArtist = makeHarness();
            wrongArtist.searchLyricsProvider = async () => [record('Sun', 'Different Artist')];
            const wrongArtistPick = await wrongArtist.lookupLyrics(item);

            const wrongTitle = makeHarness();
            wrongTitle.searchLyricsProvider = async () => [record('Sun It Rises', 'Right Artist')];
            const wrongTitlePick = await wrongTitle.lookupLyrics(item);

            const timedPreference = makeHarness();
            timedPreference.searchLyricsProvider = async () => [
                record('Sun', 'Right Artist', false),
                record('Sun', 'Different Artist', true)
            ];
            const timedPreferencePick = await timedPreference.lookupLyrics(item);

            const albumConstrained = makeHarness();
            const albumCalls = [];
            albumConstrained.searchLyricsProvider = async (title, artist, album) => {
                albumCalls.push({ title, artist, album });
                return album ? [] : [record('Sun', 'Right Artist')];
            };
            const albumConstrainedPick = await albumConstrained.lookupLyrics(item);

            return {
                wrongArtistRejected: wrongArtistPick === null,
                wrongTitleRejected: wrongTitlePick === null,
                validSimplePreferredOverWrongTimed:
                    timedPreferencePick?.artistName === 'Right Artist'
                    && timedPreferencePick.syncedLines.length === 0,
                albumIndependentFound: albumConstrainedPick?.artistName === 'Right Artist',
                albumCalls
            };
        });
        report.check('player lyric matching rejects title and known-artist mismatches independently',
            lyricProviderIdentityEvidence.wrongArtistRejected
            && lyricProviderIdentityEvidence.wrongTitleRejected);
        report.check('player timed-lyrics preference cannot cross song identity',
            lyricProviderIdentityEvidence.validSimplePreferredOverWrongTimed);
        report.check('player lyric provider search does not constrain results by album',
            lyricProviderIdentityEvidence.albumIndependentFound
            && lyricProviderIdentityEvidence.albumCalls.length === 1
            && lyricProviderIdentityEvidence.albumCalls.every(call => call.album === undefined));

        const lyricProviderTransport = await tab.evaluate(async () => {
            const harness = { lyricsLookupCache: new Map(), addMessage() {} };
            PlayerLyrics.install(harness);
            const realFetch = window.fetch;
            const calls = [];
            let active = 0;
            let maxActive = 0;
            window.fetch = async (url, options = {}) => {
                const href = String(url);
                if (!href.includes('lyrics=search')) return realFetch(url, options);
                active++;
                maxActive = Math.max(maxActive, active);
                calls.push({ href, hasSignal: options.signal instanceof AbortSignal });
                await new Promise(resolve => setTimeout(resolve, 15));
                active--;
                const status = href.includes('HTTP+Failure') ? 504 : 200;
                return new Response(status === 200 ? '[]' : '{"error":"Lyrics provider timed out"}', {
                    status,
                    headers: { 'Content-Type': 'application/json' }
                });
            };

            try {
                await harness.searchLyricsProvider('Song + One', 'AC/DC & Friend');
                const items = [1, 2].map(index => ({
                    name: `Canonical ${index}`,
                    artist: `Primary ${index}`,
                    title: `Parsed ${index} - Upload ${index}`,
                    channelTitle: `Channel ${index}`,
                    duration: '3:00',
                    durationSeconds: 180
                }));
                const candidateCounts = items.map(item => harness.buildLyricsLookupCandidates(item).length);
                await Promise.all(items.map(item => harness.lookupLyrics(item)));

                let errorMessage = '';
                try {
                    await harness.searchLyricsProvider('HTTP Failure', 'Error Artist');
                } catch (error) {
                    errorMessage = error instanceof Error ? error.message : String(error);
                }

                const urls = calls.map(call => new URL(call.href, location.href));
                return {
                    firstTrack: urls[0]?.searchParams.get('track_name') || '',
                    firstArtist: urls[0]?.searchParams.get('artist_name') || '',
                    allSameOrigin: urls.every(url => url.origin === location.origin),
                    noDirectProvider: calls.every(call => !call.href.includes('lrclib.net')),
                    allTimed: calls.every(call => call.hasSignal),
                    candidateCounts,
                    maxActive,
                    errorMessage
                };
            } finally {
                window.fetch = realFetch;
            }
        });
        report.check('player sends lyric identity through the same-origin keyless proxy',
            lyricProviderTransport.firstTrack === 'Song + One'
            && lyricProviderTransport.firstArtist === 'AC/DC & Friend'
            && lyricProviderTransport.allSameOrigin
            && lyricProviderTransport.noDirectProvider
            && lyricProviderTransport.allTimed);
        report.check(`player lyric candidate fan-out stays within the two-song network bound (max ${lyricProviderTransport.maxActive})`,
            lyricProviderTransport.candidateCounts.every(count => count === 3)
            && lyricProviderTransport.maxActive <= 2);
        report.check('player keeps proxied provider failures retryable',
            lyricProviderTransport.errorMessage === 'Lyrics search failed: HTTP 504');

        const staleTimedLyricUpgrade = await tab.evaluate(async () => {
            const run = Date.now();
            const makeItem = (kind) => ({
                id: kind === 'wrong' ? 9401 : 9402,
                videoId: `lyric-v3-${kind}-${run}`,
                name: 'Sun',
                artist: 'Right Artist',
                album: 'Right Album',
                title: '',
                channelTitle: '',
                duration: '3:00',
                durationSeconds: 180,
                lyricsStatus: 'idle',
                lyricsData: null,
                lyricOffsetSeconds: 0
            });
            const lyricRecord = (artistName, words) => ({
                provider: 'LRCLIB',
                trackName: 'Sun',
                artistName,
                albumName: 'Right Album',
                duration: 180,
                instrumental: false,
                plainLyrics: words,
                syncedLyrics: `[00:01.00]${words}`,
                syncedLines: [{ time: 1, text: words }]
            });
            const wrong = makeItem('wrong');
            const valid = makeItem('valid');
            await PlayerHistoryDB.putLyricState({
                videoId: wrong.videoId,
                status: 'found',
                checkedAt: Date.now(),
                searchVersion: 2,
                lyricOffsetSeconds: 1.5,
                lyrics: lyricRecord('Different Artist', 'wrong words')
            });
            await PlayerHistoryDB.putLyricState({
                videoId: valid.videoId,
                status: 'found',
                checkedAt: Date.now(),
                searchVersion: 2,
                lyrics: lyricRecord('Right Artist', 'valid stored words')
            });

            const harness = {
                playlist: [wrong, valid],
                lyricsLookupCache: new Map(),
                lyricsLookupsInFlight: new Map(),
                currentLyricsItemId: null,
                currentPlayingId: null,
                lookupNames: [],
                refreshLyricsRowButton() {},
                renderLyricsStateForItem() {},
                updateLyricOffsetControls() {},
                resyncProgressClock() {},
                addMessage() {},
                describePlaylistItem(item) { return item.name; }
            };
            PlayerLyrics.install(harness);
            harness.lookupLyrics = async (item) => {
                harness.lookupNames.push(item.name + ':' + item.videoId);
                return item.videoId === wrong.videoId
                    ? lyricRecord('Right Artist', 'correct replacement')
                    : null;
            };

            const realPut = PlayerHistoryDB.putLyricState;
            const statusAtSave = {};
            PlayerHistoryDB.putLyricState = async (record) => {
                const item = record.videoId === wrong.videoId ? wrong : valid;
                statusAtSave[record.videoId] = item.lyricsStatus;
                return realPut(record);
            };
            await harness.ensureLyricsForItem(wrong);
            await harness.ensureLyricsForItem(valid);
            PlayerHistoryDB.putLyricState = realPut;

            const wrongStored = await PlayerHistoryDB.getLyricState(wrong.videoId);
            const validStored = await PlayerHistoryDB.getLyricState(valid.videoId);
            return {
                lookupCount: harness.lookupNames.length,
                wrong: {
                    videoId: wrongStored?.videoId,
                    searchVersion: wrongStored?.searchVersion,
                    artist: wrongStored?.lyrics?.artistName,
                    words: wrongStored?.lyrics?.plainLyrics,
                    offset: wrongStored?.lyricOffsetSeconds,
                    liveWords: wrong.lyricsData?.plainLyrics,
                    statusAtSave: statusAtSave[wrong.videoId]
                },
                valid: {
                    videoId: validStored?.videoId,
                    searchVersion: validStored?.searchVersion,
                    words: validStored?.lyrics?.plainLyrics,
                    liveWords: valid.lyricsData?.plainLyrics,
                    statusAtSave: statusAtSave[valid.videoId]
                }
            };
        });
        report.check('player stale timed lyrics revalidate identity under search v3',
            staleTimedLyricUpgrade.lookupCount === 2
            && staleTimedLyricUpgrade.wrong.videoId.startsWith('lyric-v3-wrong-')
            && staleTimedLyricUpgrade.wrong.searchVersion === 3
            && staleTimedLyricUpgrade.wrong.artist === 'Right Artist'
            && staleTimedLyricUpgrade.wrong.words === 'correct replacement'
            && staleTimedLyricUpgrade.wrong.liveWords === 'correct replacement'
            && staleTimedLyricUpgrade.wrong.offset === 1.5);
        report.check('player stale valid timed lyrics survive empty revalidation and remain save-then-activate',
            staleTimedLyricUpgrade.valid.videoId.startsWith('lyric-v3-valid-')
            && staleTimedLyricUpgrade.valid.searchVersion === 3
            && staleTimedLyricUpgrade.valid.words === 'valid stored words'
            && staleTimedLyricUpgrade.valid.liveWords === 'valid stored words'
            && staleTimedLyricUpgrade.wrong.statusAtSave === 'loading'
            && staleTimedLyricUpgrade.valid.statusAtSave === 'loading');

        const favoritesScaleContract = await tab.evaluate(() => {
            const favoriteCount = 900;
            const alreadyLoaded = 17;
            const favorites = Object.fromEntries(Array.from({ length: favoriteCount }, (_, index) => {
                const videoId = `scale-favorite-${index}`;
                const favorite = PlayerSongs.createFavorite({
                    videoId,
                    name: `Scale Song ${index}`,
                    artist: `Scale Artist ${index}`,
                    year: String(1980 + (index % 40)),
                    album: `Scale Album ${index % 12}`,
                    title: index === favoriteCount - 1
                        ? 'Unrelated Artist - Wrong Recording'
                        : `Scale Artist ${index} - Scale Song ${index}`,
                    channelTitle: `Scale Artist ${index}`,
                    duration: '3:00',
                    durationSeconds: 180,
                    searchTerm: `Scale Artist ${index} Scale Song ${index}`
                });
                return [videoId, favorite];
            }));
            const harness = {
                favorites,
                playlist: [],
                settings: { showSongNotes: false, playlistTimedOnly: false },
                playlistFilterQuery: '',
                lyricsFetchQueue: [],
                lyricsFetchActive: 0,
                lyricsLookupsInFlight: new Map(),
                youtubeAlternateResults: new Map(),
                isFavorite(videoId) { return !!this.favorites[videoId]; },
                escapeHtml(value) { return String(value || ''); },
                showLyricsForItem() {},
                lyricsRowMarker() { return { label: '\u00b7', className: '', aria: 'Get lyrics' }; },
                updateStatus() {},
                addMessage() {},
                persistPlaylist() {},
                updatePlaylistLabel() {},
                showPlaylistSurfaces() {},
                saveSettings() {}
            };
            PlayerPlaylist.install(harness);
            PlayerLyrics.install(harness);
            harness.pumpLyricsQueue = () => {};
            const body = document.getElementById('playlistBody');
            body.innerHTML = '';
            for (let index = 0; index < alreadyLoaded; index++) {
                harness.playlist.push(PlayerSongs.createPlaylistItem(favorites[`scale-favorite-${index}`], {
                    sourceKind: 'favorite',
                    sourceLabel: 'Already loaded'
                }));
            }
            harness.addPlaylistItemsToDOM(harness.playlist);
            harness.reconcileLibraryLyrics();

            const realAdd = harness.addPlaylistItemsToDOM;
            const batchSizes = [];
            harness.addPlaylistItemsToDOM = items => {
                batchSizes.push(items.length);
                realAdd.call(harness, items);
            };
            const realRecordSong = PlayerHistoryDB.recordSong;
            PlayerHistoryDB.recordSong = () => {};
            harness.loadFavoritesToPlaylist();
            PlayerHistoryDB.recordSong = realRecordSong;

            const ids = harness.playlist.map(item => item.id);
            const persisted = PlayerSongs.persistedPlaylistEntry(harness.playlist[0]);
            const migrated = PlayerSongs.createPlaylistItem({
                ...persisted,
                id: 987654321
            }, {
                sourceKind: 'restored',
                sourceLabel: 'Legacy persisted ID'
            });
            const queuedVideoIds = harness.lyricsFetchQueue.map(entry => entry.videoId);
            body.innerHTML = '';
            return {
                playlistCount: harness.playlist.length,
                uniqueIds: new Set(ids).size,
                batchSizes,
                queuedCount: queuedVideoIds.length,
                queuedUnique: new Set(queuedVideoIds).size,
                wrongIdentityQueued: queuedVideoIds.includes(`scale-favorite-${favoriteCount - 1}`),
                persistedHasId: Object.hasOwn(persisted, 'id'),
                migratedReusedLegacyId: migrated.id === 987654321
            };
        });
        report.check('900-favorite load uses unique runtime IDs and one 883-row transaction',
            favoritesScaleContract.playlistCount === 900
            && favoritesScaleContract.uniqueIds === 900
            && favoritesScaleContract.batchSizes.length === 1
            && favoritesScaleContract.batchSizes[0] === 883);
        report.check('playlist persistence drops disposable IDs and migrates old entries by regeneration',
            !favoritesScaleContract.persistedHasId
            && !favoritesScaleContract.migratedReusedLegacyId);
        report.check('favorite lyrics queue has one job per valid video and gates identity repair',
            favoritesScaleContract.queuedCount === 899
            && favoritesScaleContract.queuedUnique === 899
            && !favoritesScaleContract.wrongIdentityQueued);

        // Live playlist filter: as-you-type hides non-matching rows, the
        // status line names the query and counts, Cancel restores all.
        // Timed only hides rows without synced lyrics. Song notes are a
        // CSS display toggle on the container.
        const playlistFilterAndNotes = await tab.evaluate(() => {
            const harness = {
                favorites: {},
                playlist: [],
                settings: { showSongNotes: false, playlistTimedOnly: false },
                isFavorite() { return false; },
                escapeHtml(value) { return String(value || ''); },
                showLyricsForItem() {},
                lyricsRowMarker() { return { label: '\u00b7', className: '', aria: 'Get lyrics' }; },
                saveSettings() {}
            };
            PlayerPlaylist.install(harness);
            const body = document.getElementById('playlistBody');
            const container = document.getElementById('playlistContainer');
            const savedDisplay = container.style.display;
            container.style.display = 'block';
            body.innerHTML = '';
            const items = [
                {
                    id: 601, videoId: 'v-sunset', name: 'Sunset Drive', artist: 'Evening Band', year: '1984', album: '',
                    title: 'Sunset Drive', channelTitle: 'Evening Band', duration: '3:00', comment: 'A sunset note',
                    searchTerm: 'Evening Band Sunset Drive',
                    lyricsStatus: 'ready',
                    lyricsData: { syncedLines: [{ time: 12, text: 'sunset line' }], plainLyrics: '' }
                },
                {
                    id: 602, videoId: 'v-morning', name: 'Morning Run', artist: 'Dawn Crew', year: '2001', album: '',
                    title: 'Morning Run', channelTitle: 'Dawn Crew', duration: '2:30', comment: 'A morning note',
                    searchTerm: 'Dawn Crew Morning Run',
                    lyricsStatus: 'ready',
                    lyricsData: { syncedLines: [], plainLyrics: 'simple only' }
                },
                {
                    id: 603, videoId: 'v-unicode', name: 'Don’t Stop', artist: 'Beyoncé', year: '2004', album: 'Déjà Vu',
                    title: 'Hidden raw title', channelTitle: 'Hidden channel', duration: '3:30', comment: '',
                    searchTerm: '',
                    lyricsStatus: 'idle',
                    lyricsData: null
                },
                {
                    id: 604, videoId: 'v-hidden', name: 'Unrelated Song', artist: 'Other Artist', year: '', album: '',
                    title: 'needle upload', channelTitle: 'harbor channel', duration: '3:30', comment: 'needle',
                    searchTerm: 'harbor',
                    lyricsStatus: 'idle',
                    lyricsData: null
                }
            ];
            for (const item of items) {
                harness.playlist.push(item);
                harness.addPlaylistItemToDOM(item);
            }

            const rowHidden = id => document.querySelector(`.playlist-row[data-item-id="${id}"]`).hidden;
            const status = document.getElementById('playlistFilterStatus');
            const statusText = document.getElementById('playlistFilterStatusText');

            harness.setPlaylistFilter('sunset');
            const filtered = {
                sunsetShown: !rowHidden(601),
                morningHidden: rowHidden(602),
                statusVisible: status.style.display !== 'none',
                statusText: statusText.textContent
            };
            // Year matching too: "1984" should match the sunset song only
            harness.setPlaylistFilter('1984');
            const yearFiltered = { sunsetShown: !rowHidden(601), morningHidden: rowHidden(602) };

            harness.setPlaylistFilter('evening sunset');
            const distributedAnd = { sunsetShown: !rowHidden(601), morningHidden: rowHidden(602) };

            harness.setPlaylistFilter('sunset absentword');
            const strictAnd = { sunsetHidden: rowHidden(601) };

            harness.setPlaylistFilter("don't stop beyonce deja");
            const unicodeFolded = {
                unicodeShown: !rowHidden(603),
                sunsetHidden: rowHidden(601),
                hiddenMetadataRowHidden: rowHidden(604)
            };

            harness.setPlaylistFilter('needle harbor');
            const hiddenMetadataExcluded = rowHidden(604);

            harness.clearPlaylistFilter();
            items[1].lyricsStatus = 'idle';
            items[1].lyricsData = null;
            harness.settings.playlistTimedOnly = true;
            harness.applyPlaylistFilter();
            const timedOnly = {
                sunsetShown: !rowHidden(601),
                morningHidden: rowHidden(602),
                statusVisible: status.style.display !== 'none',
                statusText: statusText.textContent,
                waitingReported: statusText.textContent.includes('3 text-matching rows are still waiting for lyric resolution')
            };

            harness.clearPlaylistFilter();
            const cancelled = {
                bothShown: !rowHidden(601) && !rowHidden(602),
                statusHidden: status.style.display === 'none',
                timedOnlyOff: harness.settings.playlistTimedOnly === false
            };

            // Notes toggle: comments hidden by default, instantly shown by class
            const comment = body.querySelector('.playlist-song-comment');
            const hiddenByDefault = getComputedStyle(comment).display === 'none';
            harness.settings.showSongNotes = true;
            harness.applySongNotesVisibility();
            const shownWhenOn = getComputedStyle(comment).display !== 'none';
            harness.settings.showSongNotes = false;
            harness.applySongNotesVisibility();
            const hiddenWhenOff = getComputedStyle(comment).display === 'none';

            body.innerHTML = '';
            container.style.display = savedDisplay;
            return {
                filtered, yearFiltered, distributedAnd, strictAnd, unicodeFolded, hiddenMetadataExcluded,
                timedOnly, cancelled, hiddenByDefault, shownWhenOn, hiddenWhenOff
            };
        });
        report.check(`player playlist filter live-hides rows ("${playlistFilterAndNotes.filtered.statusText}")`,
            playlistFilterAndNotes.filtered.sunsetShown
            && playlistFilterAndNotes.filtered.morningHidden
            && playlistFilterAndNotes.filtered.statusVisible
            && playlistFilterAndNotes.filtered.statusText.includes('"sunset"')
            && playlistFilterAndNotes.filtered.statusText.includes('1 of 4')
            && playlistFilterAndNotes.yearFiltered.sunsetShown
            && playlistFilterAndNotes.yearFiltered.morningHidden
            && playlistFilterAndNotes.distributedAnd.sunsetShown
            && playlistFilterAndNotes.distributedAnd.morningHidden
            && playlistFilterAndNotes.strictAnd.sunsetHidden
            && playlistFilterAndNotes.unicodeFolded.unicodeShown
            && playlistFilterAndNotes.unicodeFolded.sunsetHidden
            && playlistFilterAndNotes.unicodeFolded.hiddenMetadataRowHidden
            && playlistFilterAndNotes.hiddenMetadataExcluded);
        report.check(`player timed-only filter hides non-timed rows ("${playlistFilterAndNotes.timedOnly.statusText}")`,
            playlistFilterAndNotes.timedOnly.sunsetShown
            && playlistFilterAndNotes.timedOnly.morningHidden
            && playlistFilterAndNotes.timedOnly.statusVisible
            && playlistFilterAndNotes.timedOnly.statusText.includes('timed lyrics only')
            && playlistFilterAndNotes.timedOnly.waitingReported);
        report.check('player playlist filter cancel restores the full list',
            playlistFilterAndNotes.cancelled.bothShown
            && playlistFilterAndNotes.cancelled.statusHidden
            && playlistFilterAndNotes.cancelled.timedOnlyOff);
        report.check('player song notes toggle shows/hides comments instantly',
            playlistFilterAndNotes.hiddenByDefault
            && playlistFilterAndNotes.shownWhenOn
            && playlistFilterAndNotes.hiddenWhenOff);

        const importedLibraryFilter = await tab.evaluate(() => {
            const harness = {
                songLibrary: {
                    songs: [{
                        id: 'library-sunset',
                        title: 'Sunset Drive',
                        sourceType: 'midi',
                        sourceName: 'Evening Band.mid',
                        importedAt: Date.now(),
                        favorite: false,
                        tempoBpm: 120,
                        durationMs: 180000,
                        noteCount: 1,
                        lyricsText: '',
                        lyricLines: [],
                        notes: [{ midi: 60, startMs: 0, endMs: 1000 }]
                    }, {
                        id: 'library-unicode',
                        title: 'Don’t Stop — Beyoncé',
                        sourceType: 'musicxml',
                        sourceName: 'Déjà Vu.musicxml',
                        importedAt: Date.now(),
                        favorite: false,
                        tempoBpm: 110,
                        durationMs: 200000,
                        noteCount: 1,
                        lyricsText: '',
                        lyricLines: [],
                        notes: [{ midi: 62, startMs: 0, endMs: 1000 }]
                    }]
                },
                escapeHtml(value) { return String(value || ''); }
            };
            PlayerSongLibrary.install(harness);
            const input = document.getElementById('songLibrarySearch');
            const list = document.getElementById('songLibraryList');
            input.value = 'evening sunset';
            harness.renderSongLibrary();
            const result = {
                query: input.value,
                shownCards: list.querySelectorAll('.song-library-card').length,
                text: list.textContent.trim()
            };
            input.value = "don't stop beyonce deja";
            harness.renderSongLibrary();
            const unicodeShownCards = list.querySelectorAll('.song-library-card').length;
            const unicodeText = list.textContent.trim();
            input.value = '';
            list.innerHTML = '';
            return { ...result, unicodeShownCards, unicodeText };
        });
        report.check('player imported-library filter applies AND semantics across fields',
            importedLibraryFilter.shownCards === 1
            && importedLibraryFilter.unicodeShownCards === 1
            && importedLibraryFilter.unicodeText.includes('Don’t Stop'));

        const lyricOffsetNudge = await tab.evaluate(async () => {
            const videoId = `offset-nudge-${Date.now()}`;
            const item = {
                id: 88, videoId, name: 'Offset Song', artist: 'Offset Artist',
                lyricsStatus: 'ready',
                lyricOffsetSeconds: 0,
                lyricsData: {
                    provider: 'LRCLIB', trackName: 'Offset Song', artistName: 'Offset Artist',
                    albumName: '', duration: 100, instrumental: false, plainLyrics: '',
                    syncedLyrics: '[00:05.00]early line\n[00:15.00]later line',
                    syncedLines: [
                        { time: 5, text: 'early line' },
                        { time: 15, text: 'later line' }
                    ]
                }
            };
            await window.PlayerHistoryDB.putLyricState({
                videoId,
                status: 'found',
                checkedAt: Date.now(),
                searchVersion: 2,
                lyrics: item.lyricsData
            });
            const harness = {
                settings: { lyricsOnNowPlaying: true, songDisplayMode: 'identity', songReportIntervalSeconds: 8 },
                playlist: [item],
                playback: { player: null },
                currentLyricsItemId: item.id,
                currentLyricsLineIndex: -1,
                nowPlayingShowsText: false,
                isPlaying: true,
                isPaused: false,
                currentPlayingId: item.id,
                currentPlaylistItem() { return item; },
                itemHasTimedLyrics(candidate) {
                    return !!(candidate && candidate.lyricsData && candidate.lyricsData.syncedLines
                        && candidate.lyricsData.syncedLines.length > 0);
                },
                updateTransportPauseLabel() {},
                resyncProgressClock() {}
            };
            PlayerSongReport.install(harness);
            PlayerLyrics.install(harness);
            harness.updateListeningTextPosition(10);
            const before = {
                highlightIndex: harness.currentLyricsLineIndex,
                barLyric: document.getElementById('transportBarLyric')?.textContent || '',
                offset: item.lyricOffsetSeconds
            };
            await harness.nudgeLyricOffset(5);
            harness.updateListeningTextPosition(10);
            const afterFf = {
                highlightIndex: harness.currentLyricsLineIndex,
                barLyric: document.getElementById('transportBarLyric')?.textContent || '',
                offset: item.lyricOffsetSeconds
            };
            await harness.nudgeLyricOffset(-10);
            harness.updateListeningTextPosition(10);
            const afterRew = {
                highlightIndex: harness.currentLyricsLineIndex,
                barLyric: document.getElementById('transportBarLyric')?.textContent || '',
                offset: item.lyricOffsetSeconds
            };
            const stored = await window.PlayerHistoryDB.getLyricState(videoId);
            const deadlineAtZero = harness.nextListeningTextDeadline(0);
            const reloaded = {
                id: 99, videoId, name: 'Offset Song', artist: 'Offset Artist',
                lyricsStatus: 'idle', lyricsData: null, lyricOffsetSeconds: 0
            };
            harness.applyLyricStateToItem(reloaded, stored);
            item.lyricOffsetSeconds = 0;
            harness.updateLyricOffsetControls();
            const initialDisplay = document.getElementById('transportLyricOffset')?.textContent || '';
            await harness.lyricsTooSlow();
            const tooSlowDisplay = {
                normal: document.getElementById('transportLyricOffset')?.textContent || '',
                overlay: document.getElementById('lyricsOverlayOffset')?.textContent || '',
                offset: item.lyricOffsetSeconds
            };
            await harness.lyricsTooFast();
            await harness.lyricsTooFast();
            const tooFastDisplay = {
                normal: document.getElementById('transportLyricOffset')?.textContent || '',
                overlay: document.getElementById('lyricsOverlayOffset')?.textContent || '',
                offset: item.lyricOffsetSeconds
            };
            const semanticStored = await window.PlayerHistoryDB.getLyricState(videoId);
            const inViewport = (ids) => ids.every(id => {
                const rect = document.getElementById(id)?.getBoundingClientRect();
                return !!rect && rect.width > 0 && rect.height > 0
                    && rect.left >= 0 && rect.right <= window.innerWidth
                    && rect.top >= 0 && rect.bottom <= window.innerHeight;
            });
            document.getElementById('playlistTransportBar').style.display = 'block';
            harness.updateLyricOffsetControls();
            const normalMobileFits = inViewport([
                'transportLyricsTooFastBtn', 'transportLyricOffset', 'transportLyricsTooSlowBtn'
            ]);
            harness.openLyricsOverlay();
            const overlayMobileFits = inViewport([
                'lyricsOverlayTooFastBtn', 'lyricsOverlayOffset', 'lyricsOverlayTooSlowBtn'
            ]);
            harness.closeLyricsOverlay();
            return {
                before, afterFf, afterRew,
                storedOffset: stored?.lyricOffsetSeconds,
                reloadedOffset: reloaded.lyricOffsetSeconds,
                deadlineAtZero,
                initialDisplay,
                tooSlowDisplay,
                tooFastDisplay,
                semanticStoredOffset: semanticStored?.lyricOffsetSeconds,
                normalMobileFits,
                overlayMobileFits,
                buttonLabels: [
                    document.getElementById('transportLyricsTooFastBtn')?.textContent || '',
                    document.getElementById('transportLyricsTooSlowBtn')?.textContent || '',
                    document.getElementById('lyricsOverlayTooFastBtn')?.textContent || '',
                    document.getElementById('lyricsOverlayTooSlowBtn')?.textContent || ''
                ]
            };
        });
        report.check(`player lyric offset nudges display and persists (${lyricOffsetNudge.afterFf.offset}s -> ${lyricOffsetNudge.afterRew.offset}s)`,
            lyricOffsetNudge.before.highlightIndex === 0
            && lyricOffsetNudge.before.barLyric === 'early line'
            && lyricOffsetNudge.before.offset === 0
            && lyricOffsetNudge.afterFf.highlightIndex === 1
            && lyricOffsetNudge.afterFf.barLyric === 'later line'
            && lyricOffsetNudge.afterFf.offset === 5
            && lyricOffsetNudge.afterRew.highlightIndex === 0
            && lyricOffsetNudge.afterRew.barLyric === 'early line'
            && lyricOffsetNudge.afterRew.offset === -5
            && lyricOffsetNudge.storedOffset === -5
            && lyricOffsetNudge.reloadedOffset === -5
            // With offset -5, first line (file t=5) appears at wall-clock 10;
            // led window opens 0.75s earlier at 9.25.
            && lyricOffsetNudge.deadlineAtZero === 9.25);
        report.check(`player lyric timing controls use 0.5s steps and fit 400px (${lyricOffsetNudge.initialDisplay} -> ${lyricOffsetNudge.tooSlowDisplay.normal} -> ${lyricOffsetNudge.tooFastDisplay.normal})`,
            lyricOffsetNudge.initialDisplay === 'Offset 0.0s'
            && lyricOffsetNudge.tooSlowDisplay.offset === 0.5
            && lyricOffsetNudge.tooSlowDisplay.normal === 'Offset +0.5s'
            && lyricOffsetNudge.tooSlowDisplay.overlay === 'Offset +0.5s'
            && lyricOffsetNudge.tooFastDisplay.offset === -0.5
            && lyricOffsetNudge.tooFastDisplay.normal === 'Offset -0.5s'
            && lyricOffsetNudge.tooFastDisplay.overlay === 'Offset -0.5s'
            && lyricOffsetNudge.semanticStoredOffset === -0.5
            && lyricOffsetNudge.normalMobileFits
            && lyricOffsetNudge.overlayMobileFits
            && lyricOffsetNudge.buttonLabels.join('|') === 'Lyrics too fast|Lyrics too slow|Lyrics too fast|Lyrics too slow');
        await tab.setViewportSize({ width: 1280, height: 720 });
        // Deadline clock, not polling: the progress/lyric renderer sleeps
        // until the next known media-time boundary (whole display second
        // or lyric moment) instead of ticking every 100ms, and the lyric
        // transition still lands on time.
        const storeWriteFailure = await tab.evaluate(async () => {
            const item = PlayerSongs.createPlaylistItem({
                videoId: `store-fail-${Date.now()}`,
                name: 'Store Fail Song', artist: 'Store Artist',
                duration: '1:30', durationSeconds: 90, searchTerm: 'x'
            }, { sourceKind: 'search', sourceLabel: 'test' });
            const harness = {
                settings: { lyricsOnNowPlaying: true, songDisplayMode: 'identity', songReportIntervalSeconds: 8 },
                playlist: [item],
                currentLyricsItemId: null,
                currentLyricsLineIndex: -1,
                nowPlayingShowsText: false,
                isPlaying: false,
                isPaused: false,
                currentPlayingId: null,
                lyricsLookupCache: new Map(),
                lyricsFetchQueue: [],
                lyricsFetchActive: 0,
                lyricsLookupsInFlight: new Map(),
                currentPlaylistItem() { return item; },
                refreshLyricsRowButton() {},
                resyncProgressClock() {},
                renderLyricsStateForItem() {},
                describePlaylistItem() { return 'Store Fail Song'; },
                parseDurationToSeconds() { return 90; },
                addMessage() {}
            };
            PlayerSongReport.install(harness);
            PlayerLyrics.install(harness);
            harness.lookupLyrics = async () => ({
                provider: 'LRCLIB', trackName: 'Store Fail Song', artistName: 'Store Artist',
                albumName: '', duration: 90, instrumental: false, plainLyrics: 'la la',
                syncedLyrics: '[00:01.00]la la', syncedLines: [{ time: 1, text: 'la la' }]
            });
            const realPut = PlayerHistoryDB.putLyricState;
            PlayerHistoryDB.putLyricState = async () => { throw new Error('IndexedDB write failed (simulated)'); };
            await harness.ensureLyricsForItem(item);
            const afterFailure = {
                status: item.lyricsStatus,
                hasData: !!item.lyricsData,
                stored: await PlayerHistoryDB.getLyricState(item.videoId)
            };
            PlayerHistoryDB.putLyricState = realPut;
            await harness.ensureLyricsForItem(item);
            const afterRetry = {
                status: item.lyricsStatus,
                storedStatus: (await PlayerHistoryDB.getLyricState(item.videoId))?.status || 'absent'
            };
            return { afterFailure, afterRetry };
        });
        report.check(`player store write failure leaves song unresolved, retry heals (then ${storeWriteFailure.afterRetry.status})`,
            storeWriteFailure.afterFailure.status === 'error'
            && storeWriteFailure.afterFailure.hasData === false
            && storeWriteFailure.afterFailure.stored === null
            && storeWriteFailure.afterRetry.status === 'ready'
            && storeWriteFailure.afterRetry.storedStatus === 'found');

        // Imported library songs (bulky note arrays) live in IndexedDB;
        // hydration migrates anything stranded in the legacy localStorage
        // blob and leaves that blob empty.
        const songLibraryMigration = await tab.evaluate(async () => {
            const legacySong = {
                id: 'song_test_migrate', title: 'Migrate Me', sourceType: 'midi',
                sourceName: 'migrate.mid', importedAt: Date.now(), favorite: false,
                tempoBpm: 120, durationMs: 2000, noteCount: 2, lyricsText: '',
                lyricLines: [],
                notes: [
                    { midi: 60, startMs: 0, endMs: 500 },
                    { midi: 64, startMs: 500, endMs: 1000 }
                ]
            };
            PlayerStorage.saveSongLibrary({ songs: [legacySong] });
            const harness = {
                songLibrary: { songs: [] },
                addMessage() {}
            };
            PlayerSongLibrary.install(harness);
            harness.renderSongLibrary = () => {}; // display is not under test
            await harness.hydrateSongLibrary();
            const inIdb = (await PlayerHistoryDB.listLibrarySongs())
                .some(song => song.id === 'song_test_migrate');
            const blob = SettingsStore.peekData(StorageKeys.PLAYER_SONG_LIBRARY);
            const blobEmpty = !blob || !blob.songs || blob.songs.length === 0;
            const inMemory = harness.songLibrary.songs.some(song => song.id === 'song_test_migrate');
            return { inIdb, blobEmpty, inMemory };
        });
        report.check(`player imported songs migrate to IndexedDB (idb: ${songLibraryMigration.inIdb}, blob empty: ${songLibraryMigration.blobEmpty})`,
            songLibraryMigration.inIdb && songLibraryMigration.blobEmpty && songLibraryMigration.inMemory);

        // Media Session treats lyric/report changes as scalar updates on one
        // installed metadata object. Position advances independently and is
        // never cleared or rewritten by a line transition.

        playerVoiceErrors
            .filter(e => !e.includes('offline test'))
            .forEach(e => report.errors.push(e));
        await ctx.close();
    }

    await browser.close();
    report.finish();
})();
