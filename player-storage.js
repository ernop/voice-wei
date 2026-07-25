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
    'llmMigration',
    'lyricsOnNowPlaying',
    'showSongNotes',
    'playlistTimedOnly',
    'songDisplayMode',
    'songReportIntervalSeconds'
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
        loadLyricsViewSettings,
        saveLyricsViewSettings,
        loadSettings,
        saveSettings,
        loadPlaylist,
        savePlaylist
    };
})();

window.PlayerStorage = PlayerStorage;
