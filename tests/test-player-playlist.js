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

            harness.clearPlaylistFilter();
            harness.settings.playlistTimedOnly = true;
            harness.applyPlaylistFilter();
            const timedOnly = {
                sunsetShown: !rowHidden(601),
                morningHidden: rowHidden(602),
                statusVisible: status.style.display !== 'none',
                statusText: statusText.textContent
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
            return { filtered, yearFiltered, timedOnly, cancelled, hiddenByDefault, shownWhenOn, hiddenWhenOff };
        });
        report.check(`player playlist filter live-hides rows ("${playlistFilterAndNotes.filtered.statusText}")`,
            playlistFilterAndNotes.filtered.sunsetShown
            && playlistFilterAndNotes.filtered.morningHidden
            && playlistFilterAndNotes.filtered.statusVisible
            && playlistFilterAndNotes.filtered.statusText.includes('"sunset"')
            && playlistFilterAndNotes.filtered.statusText.includes('1 of 2')
            && playlistFilterAndNotes.yearFiltered.sunsetShown
            && playlistFilterAndNotes.yearFiltered.morningHidden);
        report.check(`player timed-only filter hides non-timed rows ("${playlistFilterAndNotes.timedOnly.statusText}")`,
            playlistFilterAndNotes.timedOnly.sunsetShown
            && playlistFilterAndNotes.timedOnly.morningHidden
            && playlistFilterAndNotes.timedOnly.statusVisible
            && playlistFilterAndNotes.timedOnly.statusText.includes('timed lyrics only'));
        report.check('player playlist filter cancel restores the full list',
            playlistFilterAndNotes.cancelled.bothShown
            && playlistFilterAndNotes.cancelled.statusHidden
            && playlistFilterAndNotes.cancelled.timedOnlyOff);
        report.check('player song notes toggle shows/hides comments instantly',
            playlistFilterAndNotes.hiddenByDefault
            && playlistFilterAndNotes.shownWhenOn
            && playlistFilterAndNotes.hiddenWhenOff);

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
