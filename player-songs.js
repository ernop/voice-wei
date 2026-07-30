// @ts-check
//-----------------------------------------------------------------------
// PLAYER SONGS
// The single owner of the Song primitive and every shape derived from it.
//
// A Song is: the YouTube videoId (the key that plays it - identity),
// plus always-present descriptive metadata (name, artist, year, album,
// comment, searchTerm, raw YouTube title/channel, duration). No consumer
// builds song-shaped objects by hand; they call the constructors here.
//
// Derived shapes:
// - PlaylistItem  = Song + list membership (id, source) + runtime lyric
//                   state. Built ONLY by createPlaylistItem().
// - Persisted playlist entry = Song + membership, WITHOUT lyric runtime
//                   (lyrics live in the lyrics cache; persisting them per
//                   playlist item is what blew the localStorage quota).
// - FavoriteData  = Song + favoritedAt. Built ONLY by createFavorite().
// - Known-song history record (IndexedDB) = Song + seen timestamps +
//                   sourceKind. Built ONLY by historySongRecord().
//-----------------------------------------------------------------------

const PlayerSongs = (function () {
    'use strict';

    let nextPlaylistItemId = 1;

    /** The complete Song field list - one definition, everywhere. */
    const SONG_FIELDS = Object.freeze([
        'videoId',
        'name',
        'artist',
        'year',
        'album',
        'comment',
        'searchTerm',
        'title',
        'channelTitle',
        'duration',
        'durationSeconds'
    ]);

    /**
     * Canonical "m:ss" / "h:mm:ss" -> seconds conversion.
     * @param {string} value
     */
    function parseDurationToSeconds(value) {
        if (!value) return 0;
        const parts = value.split(':').map(part => Number(part));
        if (parts.some(Number.isNaN)) return 0;
        if (parts.length === 3) {
            return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
        }
        if (parts.length === 2) {
            return (parts[0] * 60) + parts[1];
        }
        return parts[0] || 0;
    }

    /**
     * Build a Song from any song-shaped input (AI item + YouTube data,
     * favorite, history record, persisted entry). Returns null when the
     * input has no videoId - a song without its play key is not a Song.
     * @param {Record<string, any>} raw
     * @returns {Song | null}
     */
    function songFrom(raw) {
        if (!raw || !raw.videoId) return null;
        const duration = String(raw.duration || '');
        return {
            videoId: String(raw.videoId),
            name: String(raw.name || raw.title || ''),
            artist: String(raw.artist || raw.channelTitle || ''),
            year: String(raw.year || ''),
            album: String(raw.album || ''),
            comment: String(raw.comment || ''),
            searchTerm: String(raw.searchTerm || ''),
            title: String(raw.title || raw.name || ''),
            channelTitle: String(raw.channelTitle || raw.artist || ''),
            duration: duration || '--:--',
            durationSeconds: Number(raw.durationSeconds) || parseDurationToSeconds(duration)
        };
    }

    /**
     * The only PlaylistItem constructor: Song + list membership + runtime
     * lyric state (always starting idle; callers hydrate from cache).
     * @param {Record<string, any>} raw song-shaped input
     * @param {{ sourceKind: PlaylistSourceKind, sourceLabel: string, sourceSearchTerm?: string }} source
     * @returns {PlaylistItem | null}
     */
    function createPlaylistItem(raw, source) {
        const song = songFrom(raw);
        if (!song) return null;
        return {
            ...song,
            id: nextPlaylistItemId++,
            sourceKind: source.sourceKind,
            sourceLabel: source.sourceLabel,
            sourceSearchTerm: source.sourceSearchTerm || song.searchTerm,
            lyricsStatus: 'idle',
            lyricsData: null,
            // Seconds added to playback time when choosing which lyric
            // line to show. Missing/0 means no adjustment; timing controls
            // persist the nudge forever on the lyricStates record.
            lyricOffsetSeconds: 0
        };
    }

    /**
     * The durable form of a playlist entry: the Song plus membership,
     * never the lyric runtime (lyricsData/lyricsStatus). Lyrics have one
     * persistent owner - the lyrics cache - and are re-hydrated on load.
     * @param {PlaylistItem} item
     * @returns {PersistedPlaylistEntry}
     */
    function persistedPlaylistEntry(item) {
        const song = /** @type {Song} */ (songFrom(item));
        return {
            ...song,
            sourceKind: item.sourceKind,
            sourceLabel: item.sourceLabel,
            sourceSearchTerm: item.sourceSearchTerm
        };
    }

    /**
     * The only FavoriteData constructor.
     * @param {Record<string, any>} raw
     * @returns {FavoriteData | null}
     */
    function createFavorite(raw) {
        const song = songFrom(raw);
        if (!song) return null;
        return { ...song, favoritedAt: Date.now() };
    }

    /**
     * Canonical search text: case/diacritic insensitive, with apostrophe
     * variants ignored and other punctuation treated as word boundaries.
     * @param {unknown} value
     */
    function normalizeSearchText(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/['\u2018\u2019\u02bc]/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    /** Canonical live-search query. @param {string} value */
    function normalizeSearchQuery(value) {
        return normalizeSearchText(value);
    }

    /**
     * Canonical song-search semantics: every query word may match anywhere
     * across the fields appropriate to the calling surface.
     * @param {unknown[]} fields
     * @param {string} query normalized via normalizeSearchQuery
     */
    function songFieldsMatchQuery(fields, query) {
        if (!query) return true;
        const haystack = normalizeSearchText(fields.join(' '));
        const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
        return tokens.every(token => haystack.includes(token));
    }

    /**
     * Song-shaped search surfaces use the canonical matcher over their
     * descriptive fields.
     * @param {Record<string, any>} song song-shaped input
     * @param {string} query normalized via normalizeSearchQuery
     */
    function songMatchesQuery(song, query) {
        if (!query) return true;
        if (!song) return false;
        return songFieldsMatchQuery([
            song.name, song.artist, song.year, song.album
        ], query);
    }

    /**
     * The known-songs history record (IndexedDB `songs` store): the Song
     * plus seen timestamps and how it arrived. Never lyric blobs.
     * @param {Record<string, any>} raw
     * @param {string} sourceKind
     * @param {string} nowIso
     */
    function historySongRecord(raw, sourceKind, nowIso) {
        const song = songFrom(raw);
        if (!song) return null;
        return {
            ...song,
            sourceKind,
            firstSeenAt: raw.firstSeenAt || nowIso,
            lastSeenAt: nowIso
        };
    }

    return {
        SONG_FIELDS,
        parseDurationToSeconds,
        songFrom,
        createPlaylistItem,
        persistedPlaylistEntry,
        createFavorite,
        historySongRecord,
        normalizeSearchText,
        normalizeSearchQuery,
        songFieldsMatchQuery,
        songMatchesQuery
    };
})();

window.PlayerSongs = PlayerSongs;
