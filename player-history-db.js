// @ts-check
// Durable music-player history and cache storage.

const PlayerHistoryDB = (function () {
    'use strict';

    const DB_NAME = 'voice-wei-music';
    const DB_VERSION = 1;
    const STORES = Object.freeze({
        LOGS: 'logs',
        LOOKUPS: 'lookups',
        SONGS: 'songs',
        YOUTUBE_SEARCHES: 'youtubeSearches',
        FAVORITES: 'favorites',
        FAVORITE_EVENTS: 'favoriteEvents'
    });

    /** @type {Promise<IDBDatabase> | null} */
    let dbPromise = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;

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
                if (!db.objectStoreNames.contains(STORES.FAVORITES)) {
                    const store = db.createObjectStore(STORES.FAVORITES, { keyPath: 'videoId' });
                    store.createIndex('updatedAt', 'updatedAt');
                }
                if (!db.objectStoreNames.contains(STORES.FAVORITE_EVENTS)) {
                    const store = db.createObjectStore(STORES.FAVORITE_EVENTS, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('createdAt', 'createdAt');
                    store.createIndex('videoId', 'videoId');
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

    function capture(promise) {
        promise.catch(error => {
            console.warn('[voice-wei music history]', error);
        });
    }

    /** @param {{ type: string, label: string, text: string, line: string }} entry */
    function recordLog(entry) {
        capture(add(STORES.LOGS, {
            createdAt: nowIso(),
            ...entry
        }));
    }

    /** @param {any} lookup */
    function recordLookup(lookup) {
        capture(add(STORES.LOOKUPS, {
            createdAt: nowIso(),
            ...lookup
        }));
    }

    /** @param {PlaylistItem | FavoriteData | any} song @param {string} sourceKind */
    function recordSong(song, sourceKind) {
        if (!song || !song.videoId) return;
        capture(put(STORES.SONGS, {
            ...song,
            sourceKind,
            videoId: song.videoId,
            firstSeenAt: song.firstSeenAt || nowIso(),
            lastSeenAt: nowIso()
        }));
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
        capture(put(STORES.YOUTUBE_SEARCHES, {
            queryKey: normalized,
            query,
            results,
            resultCount: Array.isArray(results) ? results.length : 0,
            updatedAt: nowIso(),
            ...meta
        }));
    }

    /** @param {string} query @returns {Promise<any | null>} */
    async function getYouTubeSearch(query) {
        const normalized = normalizeQuery(query);
        if (!normalized) return null;
        return (await get(STORES.YOUTUBE_SEARCHES, normalized)) || null;
    }

    /** @param {FavoriteData | PlaylistItem | any} favorite @param {boolean} active */
    function recordFavorite(favorite, active) {
        if (!favorite || !favorite.videoId) return;
        const event = {
            createdAt: nowIso(),
            videoId: favorite.videoId,
            active,
            favorite
        };
        capture(add(STORES.FAVORITE_EVENTS, event));
        capture(put(STORES.FAVORITES, {
            ...favorite,
            videoId: favorite.videoId,
            active,
            updatedAt: nowIso()
        }));
    }

    return {
        recordLog,
        recordLookup,
        recordSong,
        recordSongs,
        recordYouTubeSearch,
        getYouTubeSearch,
        recordFavorite
    };
})();

window.PlayerHistoryDB = PlayerHistoryDB;
