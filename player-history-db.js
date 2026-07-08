// @ts-check
// Durable music-player history and cache storage (IndexedDB).
//
// Persistence principles this module enforces:
// - One owner per concept. IndexedDB owns unbounded/historical data: the log,
//   lookup history, the known-songs catalog, the YouTube-search cache, and the
//   append-only favorite-event audit. The authoritative favorites SET lives in
//   localStorage (PlayerStorage); this module never stores a second copy of it.
// - Bounded by policy, truncated loudly. Every store has a cap; when a store
//   approaches it the user is notified once, then the oldest records are
//   trimmed. "Permanent" means "kept until we warn you and trim".

const PlayerHistoryDB = (function () {
    'use strict';

    const DB_NAME = 'voice-wei-music';
    // v2 drops the legacy `favorites` store: the authoritative favorites set
    // lives in localStorage, so a second IndexedDB copy violated one-owner.
    // v3 adds `lyricStates`: the single permanent owner of per-song lyric
    // state, keyed by videoId (a found record with the lyrics, or an
    // answered "none" with when it was checked).
    const DB_VERSION = 3;
    const LEGACY_FAVORITES_STORE = 'favorites';
    const STORES = Object.freeze({
        LOGS: 'logs',
        LOOKUPS: 'lookups',
        SONGS: 'songs',
        YOUTUBE_SEARCHES: 'youtubeSearches',
        FAVORITE_EVENTS: 'favoriteEvents',
        LYRIC_STATES: 'lyricStates'
    });

    // Per-store record caps. When a store reaches 90% the user is warned once;
    // past 100% the oldest records are trimmed back to the cap.
    const STORE_CAPS = Object.freeze({
        [STORES.LOGS]: 5000,
        [STORES.LOOKUPS]: 2000,
        [STORES.SONGS]: 5000,
        [STORES.YOUTUBE_SEARCHES]: 2000,
        [STORES.FAVORITE_EVENTS]: 5000,
        [STORES.LYRIC_STATES]: 5000
    });

    // Oldest-first ordering for trimming. Keyed stores trim by their time
    // index; autoIncrement stores trim by primary key (monotonic = oldest).
    const ORDER_INDEX = Object.freeze({
        [STORES.SONGS]: 'lastSeenAt',
        [STORES.YOUTUBE_SEARCHES]: 'updatedAt',
        [STORES.LYRIC_STATES]: 'checkedAt'
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
     * Warn once when a store nears its cap, then trim the oldest records back
     * to the cap. Oldest = lowest primary key (autoIncrement) or lowest value
     * on the store's time index (keyed stores).
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
        const source = ORDER_INDEX[storeName]
            ? writable.index(ORDER_INDEX[storeName])
            : writable;
        let toDelete = total - cap;
        await new Promise((resolve, reject) => {
            const cursorRequest = source.openCursor();
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
        await put(STORES.LYRIC_STATES, record);
        capture(enforceCap(STORES.LYRIC_STATES));
    }

    /** @param {string} videoId @returns {Promise<LyricStateRecord | null>} */
    async function getLyricState(videoId) {
        if (!videoId) return null;
        return (await get(STORES.LYRIC_STATES, videoId)) || null;
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
        listLookups,
        listSongs,
        listYouTubeSearches,
        recordFavorite,
        putLyricState,
        getLyricState
    };
})();

window.PlayerHistoryDB = PlayerHistoryDB;
