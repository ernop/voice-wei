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
            id: Date.now() + Math.random(),
            sourceKind: source.sourceKind,
            sourceLabel: source.sourceLabel,
            sourceSearchTerm: source.sourceSearchTerm || song.searchTerm,
            lyricsStatus: 'idle',
            lyricsData: null
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
            id: item.id,
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

    /** Canonical live-search normalization: trimmed, lowercased. @param {string} value */
    function normalizeSearchQuery(value) {
        return String(value || '').trim().toLowerCase();
    }

    /**
     * The one matcher behind every song search surface (playlist filter,
     * Known Songs search): every whitespace-separated word of the query
     * must appear somewhere in the song's descriptive fields.
     * @param {Record<string, any>} song song-shaped input
     * @param {string} query normalized via normalizeSearchQuery
     */
    function songMatchesQuery(song, query) {
        if (!query) return true;
        if (!song) return false;
        const haystack = [
            song.name, song.artist, song.year, song.album,
            song.comment, song.title, song.channelTitle, song.searchTerm
        ].join(' ').toLowerCase();
        return query.split(/\s+/).every(word => haystack.includes(word));
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
        normalizeSearchQuery,
        songMatchesQuery
    };
})();

window.PlayerSongs = PlayerSongs;
