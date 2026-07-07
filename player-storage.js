// @ts-check
//-----------------------------------------------------------------------
// PLAYER STORAGE
// All player persistence via StorageKeys + SettingsStore (no direct
// localStorage in player modules).
//-----------------------------------------------------------------------

/** @type {string[]} */
const PLAYER_SETTINGS_KEYS = [
    'readClaudeResponse',
    'autoSubmitMode',
    'claudeModel',
    'openaiModel',
    'aiProvider',
    'lyricsOnNowPlaying'
];

/** @type {LyricsViewSettings} */
const LYRICS_VIEW_DEFAULTS = {
    fontScale: 1,
    widthMode: 'wide',
    align: 'center',
    spacing: 'roomy',
    backdrop: 'dim'
};

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is Record<string, FavoriteData>} */
function isFavoritesRecord(value) {
    return isPlainObject(value);
}

/** @param {unknown} value @returns {value is LyricsCacheStore} */
function isLyricsCacheStore(value) {
    return isPlainObject(value)
        && isPlainObject(/** @type {{ records?: unknown }} */(value).records)
        && isPlainObject(/** @type {{ aliases?: unknown }} */(value).aliases);
}

/**
 * The `misses` map (remembered not-founds) arrived after records+aliases;
 * stores saved without it get an empty one.
 * @param {LyricsCacheStore} store
 * @returns {LyricsCacheStore}
 */
function withLyricsMisses(store) {
    if (!isPlainObject(/** @type {{ misses?: unknown }} */(store).misses)) {
        store.misses = {};
    }
    return store;
}

/**
 * Convert the legacy flat lyrics cache ({ [key]: LyricsResult }) into the
 * deduplicated records+aliases shape. Duplicate copies of the same lyrics
 * (same track/artist/duration) collapse to one record; every old key
 * becomes an alias so existing lookups keep hitting.
 * @param {Record<string, any>} flat
 * @returns {LyricsCacheStore}
 */
function migrateFlatLyricsCache(flat) {
    /** @type {LyricsCacheStore} */
    const store = { records: {}, aliases: {}, misses: {} };
    /** @type {Map<string, string>} lyrics identity -> canonical key */
    const canonicalByIdentity = new Map();
    const now = Date.now();
    for (const [key, lyrics] of Object.entries(flat)) {
        if (!isPlainObject(lyrics)) continue;
        const identity = [
            lyrics.provider || '',
            lyrics.trackName || '',
            lyrics.artistName || '',
            Math.round(Number(lyrics.duration) || 0)
        ].join('|').toLowerCase();
        let canonical = canonicalByIdentity.get(identity);
        if (!canonical) {
            canonical = key;
            canonicalByIdentity.set(identity, canonical);
            store.records[canonical] = { lyrics: /** @type {LyricsResult} */ (lyrics), cachedAt: now };
        }
        store.aliases[key] = canonical;
    }
    return store;
}

/** @param {unknown} value @returns {value is SongLibraryStore} */
function isSongLibraryStore(value) {
    return isPlainObject(value) && Array.isArray(/** @type {{ songs?: unknown }} */ (value).songs);
}

/** @param {unknown} value @returns {value is Partial<LyricsViewSettings>} */
function isLyricsViewSettings(value) {
    return isPlainObject(value);
}

/** @param {unknown} value @returns {value is { items: PersistedPlaylistEntry[], currentPlaylistIndex: number }} */
function isPlaylistEnvelope(value) {
    return isPlainObject(value) && Array.isArray(/** @type {{ items?: unknown }} */ (value).items);
}

const PlayerStorage = (function () {
    'use strict';

    function loadFavorites() {
        return SettingsStore.loadJson(StorageKeys.PLAYER_FAVORITES, {}, isFavoritesRecord);
    }

    /** @param {Record<string, FavoriteData>} favorites */
    function saveFavorites(favorites) {
        SettingsStore.saveJson(StorageKeys.PLAYER_FAVORITES, favorites);
    }

    function loadSongLibrary() {
        return SettingsStore.loadJson(StorageKeys.PLAYER_SONG_LIBRARY, { songs: [] }, isSongLibraryStore);
    }

    /** @param {SongLibraryStore} library */
    function saveSongLibrary(library) {
        SettingsStore.saveJson(StorageKeys.PLAYER_SONG_LIBRARY, library);
    }

    /** @returns {LyricsCacheStore} */
    function loadLyricsCache() {
        /** @type {LyricsCacheStore} */
        const empty = { records: {}, aliases: {}, misses: {} };
        const raw = SettingsStore.loadJson(
            StorageKeys.PLAYER_LYRICS_CACHE,
            /** @type {Record<string, any>} */(empty),
            isPlainObject
        );
        if (isLyricsCacheStore(raw)) {
            return withLyricsMisses(raw);
        }
        // Legacy flat shape: one full lyrics copy per lookup key. Collapse to
        // the deduplicated store and re-save so the duplication never returns.
        SettingsStore.logPersistence(`${StorageKeys.PLAYER_LYRICS_CACHE}: migrating flat lyrics cache to deduplicated records+aliases`);
        const migrated = migrateFlatLyricsCache(/** @type {Record<string, any>} */(raw));
        saveLyricsCache(migrated);
        return migrated;
    }

    /** @param {LyricsCacheStore} cache */
    function saveLyricsCache(cache) {
        SettingsStore.saveJson(StorageKeys.PLAYER_LYRICS_CACHE, cache);
    }

    function loadLyricsViewSettings() {
        const saved = SettingsStore.loadJson(
            StorageKeys.PLAYER_LYRICS_VIEW,
            LYRICS_VIEW_DEFAULTS,
            isLyricsViewSettings
        );
        return { ...LYRICS_VIEW_DEFAULTS, ...saved };
    }

    /** @param {LyricsViewSettings} settings */
    function saveLyricsViewSettings(settings) {
        SettingsStore.saveJson(StorageKeys.PLAYER_LYRICS_VIEW, settings);
    }

    /**
     * @param {PlayerAppSettings} defaults
     * @returns {PlayerAppSettings}
     */
    function loadSettings(defaults) {
        const state = { ...defaults };
        SettingsStore.load(StorageKeys.PLAYER_SETTINGS, state, PLAYER_SETTINGS_KEYS);
        return state;
    }

    /** @param {PlayerAppSettings} settings */
    function saveSettings(settings) {
        SettingsStore.save(StorageKeys.PLAYER_SETTINGS, settings, PLAYER_SETTINGS_KEYS);
    }

    /** @returns {{ items: PersistedPlaylistEntry[], currentPlaylistIndex: number }} */
    function loadPlaylist() {
        /** @type {{ items: PersistedPlaylistEntry[], currentPlaylistIndex: number }} */
        const empty = { items: [], currentPlaylistIndex: -1 };
        const data = SettingsStore.loadJson(StorageKeys.PLAYER_PLAYLIST, empty, isPlaylistEnvelope);
        if (!data || !Array.isArray(data.items)) {
            return empty;
        }
        return {
            items: data.items,
            currentPlaylistIndex: typeof data.currentPlaylistIndex === 'number'
                ? data.currentPlaylistIndex
                : -1
        };
    }

    /** @param {PersistedPlaylistEntry[]} items @param {number} currentPlaylistIndex */
    function savePlaylist(items, currentPlaylistIndex) {
        SettingsStore.saveJson(StorageKeys.PLAYER_PLAYLIST, { items, currentPlaylistIndex });
    }

    return {
        loadFavorites,
        saveFavorites,
        loadSongLibrary,
        saveSongLibrary,
        loadLyricsCache,
        saveLyricsCache,
        loadLyricsViewSettings,
        saveLyricsViewSettings,
        loadSettings,
        saveSettings,
        loadPlaylist,
        savePlaylist
    };
})();

window.PlayerStorage = PlayerStorage;
