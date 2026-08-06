// @ts-check
//-----------------------------------------------------------------------
// STORAGE KEYS
// Namespaced localStorage keys for voice-wei. Legacy unprefixed keys are
// migrated automatically on first read (see settings-store.js).
//-----------------------------------------------------------------------

const StorageKeys = Object.freeze({
    SCALES_SETTINGS: 'voice-wei:scales-settings',
    SCALES_PRESETS: 'voice-wei:scales-presets',
    INTERVALS_SETTINGS: 'voice-wei:intervals-settings',
    INTERVALS_EAR_STATS: 'voice-wei:intervals-ear-stats',
    PHRASES_SETTINGS: 'voice-wei:phrases-settings',
    STAFF_SETTINGS: 'voice-wei:staff-settings',
    STAFF_SESSIONS: 'voice-wei:staff-sessions',
    TRACE_SETTINGS: 'voice-wei:trace-settings',
    PITCH_METER_SETTINGS: 'voice-wei:pitch-meter-settings',
    PLAYER_SETTINGS: 'voice-wei:player-settings',
    PLAYER_PLAYLIST: 'voice-wei:player-playlist',
    PLAYER_LIFECYCLE: 'voice-wei:player-lifecycle',
    PLAYER_FAVORITES: 'voice-wei:player-favorites',
    PLAYER_SONG_LIBRARY: 'voice-wei:player-song-library',
    // Retired: per-song lyric state moved to IndexedDB (voice-wei-music
    // `lyricStates`, keyed by videoId). The key remains registered so the
    // name stays reserved; nothing reads or writes it anymore.
    PLAYER_LYRICS_CACHE: 'voice-wei:player-lyrics-cache',
    PLAYER_LYRICS_VIEW: 'voice-wei:player-lyrics-view',
    EBOOK_SETTINGS: 'voice-wei:ebook-settings',
    PRACTICE_PROGRESS: 'voice-wei:practice-progress',
    API_CLAUDE: 'voice-wei:api-key:claude',
    API_OPENAI: 'voice-wei:api-key:openai',
    COOLNESS_LAB: 'voice-wei:coolness-lab',
    PANEL_SCALES_SING: 'voice-wei:panel:scales-sing',
    PANEL_INTERVALS_SING: 'voice-wei:panel:intervals-sing',
    PANEL_PHRASES_TEST: 'voice-wei:panel:phrases-test',
    // Retired: the Staff page dropped its Sing dock (the sung line and
    // pitch band on the staff itself replaced it). The key remains
    // registered so the name stays reserved; nothing reads or writes
    // it anymore.
    PANEL_STAFF_SING: 'voice-wei:panel:staff-sing'
});

/** @type {Readonly<Record<string, string>>} new key -> legacy key */
const LegacyStorageKeys = Object.freeze({
    [StorageKeys.SCALES_SETTINGS]: 'scales-settings',
    [StorageKeys.SCALES_PRESETS]: 'scales-presets-v1',
    [StorageKeys.INTERVALS_SETTINGS]: 'intervals-settings',
    [StorageKeys.INTERVALS_EAR_STATS]: 'ears-stats',
    [StorageKeys.PHRASES_SETTINGS]: 'phrases-settings',
    [StorageKeys.TRACE_SETTINGS]: 'trace-settings',
    [StorageKeys.PITCH_METER_SETTINGS]: 'pitch-meter-settings',
    [StorageKeys.PLAYER_SETTINGS]: 'voiceMusicSettings',
    [StorageKeys.PLAYER_FAVORITES]: 'voiceMusicFavorites',
    [StorageKeys.PLAYER_SONG_LIBRARY]: 'voiceMusicSongLibrary',
    [StorageKeys.PLAYER_LYRICS_CACHE]: 'voiceMusicLyricsCache',
    [StorageKeys.PLAYER_LYRICS_VIEW]: 'voiceMusicLyricsViewSettings',
    [StorageKeys.EBOOK_SETTINGS]: 'ebookSettings',
    [StorageKeys.PRACTICE_PROGRESS]: 'practice-progress',
    [StorageKeys.API_CLAUDE]: 'claudeApiKey',
    [StorageKeys.API_OPENAI]: 'openaiApiKey',
    [StorageKeys.PANEL_SCALES_SING]: 'scales-sing-panel',
    [StorageKeys.PANEL_INTERVALS_SING]: 'intervals-sing-panel',
    [StorageKeys.PANEL_PHRASES_TEST]: 'phrases-test-panel',
    // Legacy UI-only keys folded into scales-settings on migration
    'voice-wei:scales-settings:legacy-show-sequence': 'scales-show-sequence',
    'voice-wei:scales-settings:legacy-use-abbrev': 'scales-use-abbrev',
    'voice-wei:scales-settings:legacy-instruction': 'scales-instruction-dismissed',
    // Legacy ears settings blob
    'voice-wei:intervals-settings:legacy-ears': 'ears-settings'
});

window.StorageKeys = StorageKeys;
window.LegacyStorageKeys = LegacyStorageKeys;
