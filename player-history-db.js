// @ts-check
// Durable music-player history and cache storage (IndexedDB).
//
// Persistence principles this module enforces:
// - One owner per concept. IndexedDB owns unbounded/historical data: the log,
//   lookup history, the known-songs catalog, the YouTube-search cache, the
//   append-only favorite-event audit, per-song lyric states, and generated
//   song reports. The
//   authoritative favorites SET lives in localStorage (PlayerStorage); this
//   module never stores a second copy of it.
// - Time-streams are capped, library entities are not. Event streams (logs,
//   lookups, favorite events) grow with time, so they carry caps and trim
//   loudly. Stores that mirror the LIBRARY (songs, lyric states, reports) are never
//   capped: trimming them would mean partial coverage - some songs with
//   state, some silently without - and the library itself is their natural
//   bound. IndexedDB quota is GB-scale; record counts are not the risk.

const PlayerHistoryDB = (function () {
    'use strict';

    const DB_NAME = 'voice-wei-music';
    // v2 drops the legacy `favorites` store: the authoritative favorites set
    // lives in localStorage, so a second IndexedDB copy violated one-owner.
    // v3 adds `lyricStates`: the single permanent owner of per-song lyric
    // state, keyed by videoId (a found record with the lyrics, or an
    // answered "none" with when it was checked).
    // v4 adds `librarySongs`: imported MIDI/MusicXML songs with their full
    // note arrays - far too bulky for the ~5MB localStorage quota.
    // v5 adds `songReports`: generated listening companions, keyed by the
    // same stable videoId as lyrics so an expensive report survives replay.
    const DB_VERSION = 5;
    const LEGACY_FAVORITES_STORE = 'favorites';
    const STORES = Object.freeze({
        LOGS: 'logs',
        LOOKUPS: 'lookups',
        SONGS: 'songs',
        YOUTUBE_SEARCHES: 'youtubeSearches',
        FAVORITE_EVENTS: 'favoriteEvents',
        LYRIC_STATES: 'lyricStates',
        LIBRARY_SONGS: 'librarySongs',
        SONG_REPORTS: 'songReports'
    });

    // Caps for TIME-STREAM stores only (they grow with use, forever). When
    // one reaches 90% the user is warned once; past 100% the oldest records
    // are trimmed back to the cap. Library-entity stores (songs, lyric
    // states) and the re-fetchable search cache deliberately have no cap:
    // every song the user has must have its state, with no silent partial
    // coverage. All capped stores are autoIncrement, so "oldest" is simply
    // the lowest primary key.
    const STORE_CAPS = Object.freeze({
        [STORES.LOGS]: 5000,
        [STORES.LOOKUPS]: 2000,
        [STORES.FAVORITE_EVENTS]: 5000
    });

    /** @type {Promise<IDBDatabase> | null} */
    let dbPromise = null;
    /** @type {((message: string) => void) | null} */
    let noticeHandler = null;
    /** @type {Set<string>} Stores already warned this session */
    const warnedStores = new Set();

    /** @param {(message: string) => void} handler */
    function setNoticeHandler(handler) {
        noticeHandler = handler;
    }

    /** @param {string} message */
    function notify(message) {
        if (noticeHandler) {
            noticeHandler(message);
        } else {
            console.warn('[voice-wei music history]', message);
        }
    }

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;

                if (db.objectStoreNames.contains(LEGACY_FAVORITES_STORE)) {
                    db.deleteObjectStore(LEGACY_FAVORITES_STORE);
                }

                if (!db.objectStoreNames.contains(STORES.LOGS)) {
                    const store = db.createObjectStore(STORES.LOGS, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('createdAt', 'createdAt');
                }
                if (!db.objectStoreNames.contains(STORES.LOOKUPS)) {
                    const store = db.createObjectStore(STORES.LOOKUPS, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('createdAt', 'createdAt');
                    store.createIndex('requestText', 'requestText');
                }
                if (!db.objectStoreNames.contains(STORES.SONGS)) {
                    const store = db.createObjectStore(STORES.SONGS, { keyPath: 'videoId' });
                    store.createIndex('searchTerm', 'searchTerm');
                    store.createIndex('lastSeenAt', 'lastSeenAt');
                    store.createIndex('sourceKind', 'sourceKind');
                }
                if (!db.objectStoreNames.contains(STORES.YOUTUBE_SEARCHES)) {
                    const store = db.createObjectStore(STORES.YOUTUBE_SEARCHES, { keyPath: 'queryKey' });
                    store.createIndex('updatedAt', 'updatedAt');
                    store.createIndex('query', 'query');
                }
                if (!db.objectStoreNames.contains(STORES.FAVORITE_EVENTS)) {
                    const store = db.createObjectStore(STORES.FAVORITE_EVENTS, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('createdAt', 'createdAt');
                    store.createIndex('videoId', 'videoId');
                }
                if (!db.objectStoreNames.contains(STORES.LYRIC_STATES)) {
                    const store = db.createObjectStore(STORES.LYRIC_STATES, { keyPath: 'videoId' });
                    store.createIndex('checkedAt', 'checkedAt');
                }
                if (!db.objectStoreNames.contains(STORES.LIBRARY_SONGS)) {
                    const store = db.createObjectStore(STORES.LIBRARY_SONGS, { keyPath: 'id' });
                    store.createIndex('importedAt', 'importedAt');
                }
                if (!db.objectStoreNames.contains(STORES.SONG_REPORTS)) {
                    const store = db.createObjectStore(STORES.SONG_REPORTS, { keyPath: 'videoId' });
                    store.createIndex('generatedAt', 'generatedAt');
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Could not open music history database'));
        });
        return dbPromise;
    }

    function nowIso() {
        return new Date().toISOString();
    }

    /** @param {string} query */
    function normalizeQuery(query) {
        return String(query || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    /**
     * @param {string} storeName
     * @param {'readonly' | 'readwrite'} mode
     * @returns {Promise<IDBObjectStore>}
     */
    async function store(storeName, mode) {
        const db = await openDb();
        return db.transaction(storeName, mode).objectStore(storeName);
    }

    /** @param {IDBRequest} request */
    function requestPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        });
    }

    /** @param {string} storeName */
    async function getAll(storeName) {
        const objectStore = await store(storeName, 'readonly');
        return requestPromise(objectStore.getAll());
    }

    /** @param {string} storeName @param {unknown} value */
    async function put(storeName, value) {
        const objectStore = await store(storeName, 'readwrite');
        await requestPromise(objectStore.put(value));
    }

    /** @param {string} storeName @param {unknown} value */
    async function add(storeName, value) {
        const objectStore = await store(storeName, 'readwrite');
        await requestPromise(objectStore.add(value));
    }

    /** @param {string} storeName @param {IDBValidKey} key */
    async function get(storeName, key) {
        const objectStore = await store(storeName, 'readonly');
        return requestPromise(objectStore.get(key));
    }

    /**
     * Warn once when a capped store nears its cap, then trim the oldest
     * records back to the cap (lowest primary key; all capped stores are
     * autoIncrement). Uncapped stores return immediately.
     * @param {string} storeName
     */
    async function enforceCap(storeName) {
        const cap = STORE_CAPS[storeName];
        if (!cap) return;

        const counter = await store(storeName, 'readonly');
        const total = /** @type {number} */ (await requestPromise(counter.count()));

        if (total >= Math.floor(cap * 0.9) && !warnedStores.has(storeName)) {
            warnedStores.add(storeName);
            notify(`History store "${storeName}" is near its limit (${total}/${cap}). Oldest records will be trimmed automatically.`);
        }

        if (total <= cap) return;

        const writable = await store(storeName, 'readwrite');
        let toDelete = total - cap;
        await new Promise((resolve, reject) => {
            const cursorRequest = writable.openCursor();
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor || toDelete <= 0) {
                    resolve(undefined);
                    return;
                }
                cursor.delete();
                toDelete--;
                cursor.continue();
            };
            cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Trim cursor failed'));
        });
    }

    /** @param {Promise<any>} promise */
    function capture(promise) {
        promise.catch(error => {
            console.warn('[voice-wei music history]', error);
        });
    }

    /** @param {string} storeName @param {unknown} value */
    function appendCapped(storeName, value) {
        capture(add(storeName, value).then(() => enforceCap(storeName)));
    }

    /** @param {string} storeName @param {unknown} value */
    function putCapped(storeName, value) {
        capture(put(storeName, value).then(() => enforceCap(storeName)));
    }

    /** @param {{ type: string, label: string, text: string, line: string }} entry */
    function recordLog(entry) {
        appendCapped(STORES.LOGS, {
            createdAt: nowIso(),
            ...entry
        });
    }

    /** @param {any} lookup */
    function recordLookup(lookup) {
        appendCapped(STORES.LOOKUPS, {
            createdAt: nowIso(),
            ...lookup
        });
    }

    /** @param {PlaylistItem | FavoriteData | any} song @param {string} sourceKind */
    function recordSong(song, sourceKind) {
        // Store the Song fields plus seen timestamps - never the runtime
        // lyric state or other per-list baggage a raw playlist item carries.
        const record = PlayerSongs.historySongRecord(song, sourceKind, nowIso());
        if (!record) return;
        putCapped(STORES.SONGS, record);
    }

    /** @param {PlaylistItem[] | FavoriteData[]} songs @param {string} sourceKind */
    function recordSongs(songs, sourceKind) {
        for (const song of songs || []) {
            recordSong(song, sourceKind);
        }
    }

    /** @param {string} query @param {any[]} results @param {Record<string, any>} meta */
    function recordYouTubeSearch(query, results, meta = {}) {
        const normalized = normalizeQuery(query);
        if (!normalized) return;
        putCapped(STORES.YOUTUBE_SEARCHES, {
            queryKey: normalized,
            query,
            results,
            resultCount: Array.isArray(results) ? results.length : 0,
            updatedAt: nowIso(),
            ...meta
        });
    }

    /** @param {string} query @returns {Promise<any | null>} */
    async function getYouTubeSearch(query) {
        const normalized = normalizeQuery(query);
        if (!normalized) return null;
        return (await get(STORES.YOUTUBE_SEARCHES, normalized)) || null;
    }

    /**
     * Every retained log line, oldest first. The store cap is the single
     * owner of the history limit; UI callers must not impose a second limit.
     */
    async function listStoredLogs() {
        return /** @type {any[]} */ (await getAll(STORES.LOGS));
    }

    async function listLookups() {
        const records = /** @type {any[]} */ (await getAll(STORES.LOOKUPS));
        return records.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }

    async function listSongs() {
        const records = /** @type {any[]} */ (await getAll(STORES.SONGS));
        return records.sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
    }

    async function listYouTubeSearches() {
        const records = /** @type {any[]} */ (await getAll(STORES.YOUTUBE_SEARCHES));
        return records.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }

    /**
     * Persist a song's lyric state. This write is AWAITED by callers so the
     * permanent store is updated before the live song object is activated
     * (save first, then activate - the store is the single source of truth).
     * @param {LyricStateRecord} record
     */
    async function putLyricState(record) {
        if (!record || !record.videoId) {
            throw new Error('putLyricState requires a videoId');
        }
        // No cap: lyric states mirror the library, one per song, and every
        // song must keep its state (no silent partial coverage).
        await put(STORES.LYRIC_STATES, record);
    }

    /** @param {string} videoId @returns {Promise<LyricStateRecord | null>} */
    async function getLyricState(videoId) {
        if (!videoId) return null;
        return (await get(STORES.LYRIC_STATES, videoId)) || null;
    }

    /**
     * Persist a generated song report. Reports mirror the song library and
     * have no cap; regeneration deliberately replaces the prior report for
     * that videoId.
     * @param {SongReportRecord} record
     */
    async function putSongReport(record) {
        if (!record || !record.videoId) {
            throw new Error('putSongReport requires a videoId');
        }
        await put(STORES.SONG_REPORTS, record);
    }

    /** @param {string} videoId @returns {Promise<SongReportRecord | null>} */
    async function getSongReport(videoId) {
        if (!videoId) return null;
        return (await get(STORES.SONG_REPORTS, videoId)) || null;
    }

    /**
     * Persist one imported library song (full note array included). No cap:
     * a library entity, naturally bounded by what the user imports.
     * @param {SongLibrarySong} song
     */
    async function putLibrarySong(song) {
        if (!song || !song.id) {
            throw new Error('putLibrarySong requires an id');
        }
        await put(STORES.LIBRARY_SONGS, song);
    }

    /** @returns {Promise<SongLibrarySong[]>} newest import first */
    async function listLibrarySongs() {
        const records = /** @type {SongLibrarySong[]} */ (await getAll(STORES.LIBRARY_SONGS));
        return records.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
    }

    /**
     * Record a favorite toggle as an append-only audit event. The authoritative
     * favorites set lives in localStorage (PlayerStorage); this is history only.
     * @param {FavoriteData | PlaylistItem | any} favorite @param {boolean} active
     */
    function recordFavorite(favorite, active) {
        if (!favorite || !favorite.videoId) return;
        appendCapped(STORES.FAVORITE_EVENTS, {
            createdAt: nowIso(),
            videoId: favorite.videoId,
            active,
            favorite
        });
    }

    return {
        setNoticeHandler,
        recordLog,
        recordLookup,
        recordSong,
        recordSongs,
        recordYouTubeSearch,
        getYouTubeSearch,
        listStoredLogs,
        listLookups,
        listSongs,
        listYouTubeSearches,
        recordFavorite,
        putLyricState,
        getLyricState,
        putSongReport,
        getSongReport,
        putLibrarySong,
        listLibrarySongs
    };
})();

window.PlayerHistoryDB = PlayerHistoryDB;
