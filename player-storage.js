// @ts-check
//-----------------------------------------------------------------------
// PLAYER STORAGE
// All player persistence via StorageKeys + SettingsStore (no direct
// localStorage in player modules).
//-----------------------------------------------------------------------

const PLAYER_SETTINGS_KEYS = Object.freeze([
    'readClaudeResponse',
    'autoSubmitMode',
    'claudeModel',
    'openaiModel',
    'aiProvider'
]);

const LYRICS_VIEW_DEFAULTS = Object.freeze({
    fontScale: 1,
    widthMode: 'wide',
    align: 'center',
    spacing: 'roomy',
    backdrop: 'dim'
});

/** @param {unknown} value */
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is Record<string, FavoriteData>} */
function isFavoritesRecord(value) {
    return isPlainObject(value);
}

/** @param {unknown} value @returns {value is LyricsCacheStore} */
function isLyricsCacheRecord(value) {
    return isPlainObject(value);
}

/** @param {unknown} value */
function isLyricsViewSettings(value) {
    return isPlainObject(value);
}

/** @param {unknown} value */
function isPlaylistEnvelope(value) {
    return isPlainObject(value) && Array.isArray(value.items);
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

    function loadLyricsCache() {
        return SettingsStore.loadJson(StorageKeys.PLAYER_LYRICS_CACHE, {}, isLyricsCacheRecord);
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

    /** @param {typeof LYRICS_VIEW_DEFAULTS & Record<string, string | number>} settings */
    function saveLyricsViewSettings(settings) {
        SettingsStore.saveJson(StorageKeys.PLAYER_LYRICS_VIEW, settings);
    }

    /**
     * @param {Record<string, unknown>} defaults
     * @returns {Record<string, unknown>}
     */
    function loadSettings(defaults) {
        const state = { ...defaults };
        SettingsStore.load(StorageKeys.PLAYER_SETTINGS, state, PLAYER_SETTINGS_KEYS);
        return state;
    }

    /** @param {Record<string, unknown>} settings */
    function saveSettings(settings) {
        SettingsStore.save(StorageKeys.PLAYER_SETTINGS, settings, PLAYER_SETTINGS_KEYS);
    }

    /** @returns {{ items: PlaylistItem[], currentPlaylistIndex: number }} */
    function loadPlaylist() {
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

    /** @param {PlaylistItem[]} items @param {number} currentPlaylistIndex */
    function savePlaylist(items, currentPlaylistIndex) {
        SettingsStore.saveJson(StorageKeys.PLAYER_PLAYLIST, { items, currentPlaylistIndex });
    }

    return {
        loadFavorites,
        saveFavorites,
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
