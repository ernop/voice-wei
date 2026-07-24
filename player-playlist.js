// @ts-check
// Playlist DOM, YouTube search/playback, and transport controls.

const SEEK_JUMP_SECONDS = 5;
/** Seconds before the first timed lyric line that "1st" jumps to. */
const FIRST_LYRIC_LEAD_SECONDS = 1;
const DOM_SETTLE_DELAY_MS = 50;
const YOUTUBE_API_TIMEOUT_MS = 10000;
const PLAYER_READY_TIMEOUT_MS = 8000;
const YOUTUBE_SEARCH_CONCURRENCY = 4;

const PlayerPlaylist = (function () {
    'use strict';

    /** @param {VoiceMusicController} controller */
    function install(controller) {
        // All playback state lives in controller.playback (one authoritative
        // location). The constructor creates it; create one here too so test
        // harnesses that install this module in isolation still have it.
        if (!controller.playback) {
            controller.playback = new PlaybackState();
        }

        // Thin read/write views so other modules and existing call sites can
        // keep using this.isPlaying / this.currentPlaylistIndex etc., while the
        // single storage location stays controller.playback. Status fields are
        // read-only here: they only change through playback transitions.
        Object.defineProperties(controller, {
            isPlaying: { configurable: true, get() { return this.playback.isPlaying; } },
            isPaused: { configurable: true, get() { return this.playback.isPaused; } },
            currentPlayingId: { configurable: true, get() { return this.playback.currentPlayingId; } },
            currentPlaylistIndex: {
                configurable: true,
                get() { return this.playback.currentPlaylistIndex; },
                set(value) { this.playback.currentPlaylistIndex = value; }
            },
            wasPlayingBeforeListening: {
                configurable: true,
                get() { return this.playback.resumeAfterListening; },
                set(value) { this.playback.resumeAfterListening = value; }
            }
        });

        Object.assign(controller, /** @type {ThisType<VoiceMusicController>} */ ({
            showPlaylistSurfaces() {
                document.getElementById('playlistContainer').style.display = 'block';
                // Sticky transport is the now-playing surface. The older
                // central player duplicated song/seek controls above it.
                document.getElementById('centralPlayer').style.display = 'none';
                this.showTransportBar();
            },

            /**
             * The one way a song enters the working playlist: append at the
             * end, render its row, and queue its lyric resolution. The
             * bounded queue (player-lyrics.js) keeps big adds polite, and
             * because restore-at-load takes this same path, lyric work
             * interrupted by closing the page resumes on the next open -
             * songs resolved in the permanent store settle from one
             * IndexedDB read, and only the unresolved ones hit the provider.
             */
            appendPlaylistItem(item) {
                this.playlist.push(item);
                this.addPlaylistItemToDOM(item);
                if (this.playlistFilterQuery || this.settings.playlistTimedOnly) this.applyPlaylistFilter();
                this.queueLyricsLookup(item);
            },

            loadFavoritesToPlaylist() {
                const favoritesList = Object.values(this.favorites);
                if (favoritesList.length === 0) {
                    this.updateStatus('No favorites saved');
                    return;
                }

                this.showPlaylistSurfaces();

                let addedCount = 0;
                for (const favData of favoritesList) {
                    if (this.playlist.some(item => item.videoId === favData.videoId)) continue;

                    const playlistItem = PlayerSongs.createPlaylistItem(favData, {
                        sourceKind: 'favorite',
                        sourceLabel: 'Loaded favorites'
                    });
                    if (!playlistItem) continue;
                    if (window.PlayerHistoryDB) {
                        window.PlayerHistoryDB.recordSong(playlistItem, 'favorite-load');
                    }

                    this.appendPlaylistItem(playlistItem);
                    addedCount++;
                }

                this.updatePlaylistLabel();
                this.updateStatus(`Loaded ${addedCount} favorite${addedCount !== 1 ? 's' : ''}`);
                this.addMessage('user', 'Favorites', `Loaded ${addedCount} favorite songs`);
                this.persistPlaylist();
            },

            /** Re-draw every playlist row from the array, preserving the playing highlight. */
            rerenderPlaylistDom() {
                const playlistBody = document.getElementById('playlistBody');
                playlistBody.innerHTML = '';
                for (const item of this.playlist) {
                    this.addPlaylistItemToDOM(item);
                }
                if (this.playlistFilterQuery || this.settings.playlistTimedOnly) this.applyPlaylistFilter();

                // Rebind current index to the currently playing item after reorder
                if (this.currentPlayingId != null) {
                    this.currentPlaylistIndex = this.playlist.findIndex(item => item.id === this.currentPlayingId);
                    const currentItem = this.playlist[this.currentPlaylistIndex];
                    if (currentItem) {
                        this.updateCentralPlayer(currentItem);
                        const row = document.querySelector(`[data-item-id="${currentItem.id}"]`);
                        if (row) row.classList.add('playing');
                    }
                }
                this.persistPlaylist();
            },

            shufflePlaylist() {
                if (this.playlist.length === 0) return;

                // Fisher-Yates shuffle
                for (let i = this.playlist.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
                }

                this.rerenderPlaylistDom();
            },

            /** @param {PlaylistSortKey} key */
            sortPlaylist(key) {
                if (this.playlist.length < 2) return;

                const text = (/** @type {string} */ value) => String(value || '').toLowerCase();
                this.playlist.sort((a, b) => {
                    if (key === 'year') {
                        // Unknown years sort last; ties fall through to artist
                        const yearA = Number(a.year) || Infinity;
                        const yearB = Number(b.year) || Infinity;
                        if (yearA !== yearB) return yearA - yearB;
                    }
                    const artistCompare = text(a.artist).localeCompare(text(b.artist));
                    if (artistCompare !== 0) return artistCompare;
                    return text(a.name).localeCompare(text(b.name));
                });

                this.rerenderPlaylistDom();
                this.updateStatus(key === 'year' ? 'Sorted by year' : 'Sorted by artist');
            },

            async searchAndAddToPlaylist(songList, options = {}) {
                // A new AI search defines a fresh working playlist, but
                // nothing is discarded until the FIRST found song is actually
                // added - a search that finds nothing on YouTube leaves the
                // current playlist untouched. If a song is playing (or paused
                // mid-song) it is carried over as the first entry and keeps
                // playing; when it ends, playback advances into the new
                // songs. Replaced songs stay reloadable from history.
                let replacePending = options.replaceExisting === true && this.playlist.length > 0 && songList.length > 0;

                this.showPlaylistSurfaces();

                this.addMessage('claude', 'Processing', `Searching ${songList.length} songs (${YOUTUBE_SEARCH_CONCURRENCY} at a time)...`);

                const validSongs = songList
                    .map((song, i) => ({ song, index: i }))
                    .filter(({ song, index }) => {
                        if (!song.searchTerm) {
                            this.addMessage('claude', 'Skipped search item', `Song ${index + 1} had no search term: ${JSON.stringify(song).substring(0, 100)}`);
                            return false;
                        }
                        return true;
                    });

                let addedCount = 0;
                const attemptedTerms = validSongs.map(({ song }) => song.searchTerm);
                const skippedTerms = [];
                let skippedCount = songList.length - validSongs.length;

                // Each song is added the moment its search completes (the
                // list fills in while later searches are still running),
                // so rows appear in completion order.
                const handleSearchResult = ({ song, index, videoData, error }) => {
                    if (error) {
                        skippedCount++;
                        skippedTerms.push(song.searchTerm);
                        this.addMessage('claude', `Song ${index + 1} not added`, `${song.searchTerm}: ${error.message}`);
                        return;
                    }
                    if (!videoData) {
                        skippedCount++;
                        skippedTerms.push(song.searchTerm);
                        this.addMessage('claude', `Song ${index + 1} not added`, `No YouTube results for: ${song.searchTerm}`);
                        return;
                    }

                    this.addMessage('claude', `Song ${index + 1}`, `Found: ${videoData.title}`);

                    const alternateVideos = videoData.alternateVideos || [];
                    const primaryVideoData = { ...videoData };
                    delete primaryVideoData.alternateVideos;
                    const playlistItem = PlayerSongs.createPlaylistItem({
                        name: song.name ? this.decodeHtml(song.name) : '',
                        artist: song.artist ? this.decodeHtml(song.artist) : '',
                        year: song.year || '',
                        album: song.album ? this.decodeHtml(song.album) : '',
                        comment: song.comment ? this.decodeHtml(song.comment) : '',
                        searchTerm: song.searchTerm,
                        ...primaryVideoData
                    }, {
                        sourceKind: 'search',
                        sourceLabel: `Search: ${song.searchTerm}`,
                        sourceSearchTerm: song.searchTerm
                    });
                    if (!playlistItem) {
                        skippedCount++;
                        skippedTerms.push(song.searchTerm);
                        return;
                    }

                    if (replacePending) {
                        replacePending = false;
                        const previousCount = this.playlist.length;
                        const keptCurrent = this.replacePlaylistItemsKeepingCurrent();
                        const droppedCount = previousCount - (keptCurrent ? 1 : 0);
                        this.addMessage('claude', 'New search', `Replaced the working playlist (${droppedCount} song${droppedCount === 1 ? '' : 's'} stay in Known Songs history${keptCurrent ? '; current song keeps playing' : ''})`);
                    }

                    if (alternateVideos.length > 0) {
                        this.youtubeAlternateResults.set(playlistItem.id, alternateVideos);
                    }
                    if (window.PlayerHistoryDB) {
                        window.PlayerHistoryDB.recordSong(playlistItem, 'search');
                    }
                    this.appendPlaylistItem(playlistItem);
                    addedCount++;
                    this.updatePlaylistLabel();
                    this.persistPlaylist();
                };

                await this.searchSongsWithConcurrency(validSongs, { onResult: handleSearchResult });

                this.updatePlaylistLabel();
                this.addMessage('claude', 'Complete', `Added ${addedCount} of ${songList.length} songs`);

                this.persistPlaylist();
                return { addedCount, skippedCount, requestedCount: songList.length, attemptedTerms, skippedTerms };
            },

            /**
             * Replace the working playlist while a song is bound to the
             * player: every entry EXCEPT the current one is dropped (they
             * stay in the durable history) and the current song keeps
             * playing as entry 0, so the new songs queue up behind it.
             * With no current song this is a plain clear.
             * @returns {boolean} whether the current song was carried over
             */
            replacePlaylistItemsKeepingCurrent() {
                const current = this.playlist.find(entry => entry.id === this.currentPlayingId);
                const keep = current && (this.isPlaying || this.isPaused) ? current : null;
                if (!keep) {
                    this.clearPlaylistItems();
                    return false;
                }

                for (const item of this.playlist) {
                    if (item !== keep) this.youtubeAlternateResults.delete(item.id);
                }
                this.playlist = [keep];
                document.querySelectorAll('#playlistBody .playlist-row').forEach(row => {
                    if (/** @type {HTMLElement} */ (row).dataset.itemId !== String(keep.id)) row.remove();
                });
                this.currentPlaylistIndex = 0;
                this.currentLyricsItemId = keep.id;
                // Queued lyric lookups for dropped rows skip at dequeue
                // (they are no longer in the playlist).
                this.updatePlaylistLabel();
                this.persistPlaylist();
                return true;
            },

            async searchSongsWithConcurrency(validSongs, { onResult = null, concurrency = YOUTUBE_SEARCH_CONCURRENCY } = {}) {
                const results = new Array(validSongs.length);
                let nextIndex = 0;
                let completed = 0;

                const workerCount = Math.min(concurrency, validSongs.length);
                const workers = Array.from({ length: workerCount }, async () => {
                    while (nextIndex < validSongs.length) {
                        const queueIndex = nextIndex++;
                        const { song, index } = validSongs[queueIndex];
                        this.addMessage('claude', `Song ${index + 1}`, `Searching: ${song.searchTerm}`);
                        try {
                            const videoData = await this.searchYouTube(song.searchTerm, { artist: song.artist || '', name: song.name || '' });
                            results[queueIndex] = { song, index, videoData, error: null };
                        } catch (error) {
                            results[queueIndex] = { song, index, videoData: null, error };
                        }
                        completed++;
                        this.updateStatus(`Searched ${completed}/${validSongs.length} YouTube term${validSongs.length === 1 ? '' : 's'}...`);
                        if (onResult) {
                            onResult(results[queueIndex]);
                        }
                    }
                });

                await Promise.all(workers);
                return results;
            },

            updatePlaylistLabel() {
                const label = document.getElementById('playlistLabel');
                if (label) {
                    const count = this.playlist.length;
                    label.textContent = `Playlist (${count})`;
                }
            },

            /**
             * Live view filter over the working playlist. Purely visual:
             * rows that do not match are hidden, the array and playback
             * order are untouched (next/previous still traverse the full
             * list). Text query and "Timed only" combine: both must pass.
             * The status line names the active constraints and counts so
             * a filtered view is never mistaken for the whole playlist.
             * @param {string} value raw input text
             */
            setPlaylistFilter(value) {
                this.playlistFilterQuery = PlayerSongs.normalizeSearchQuery(value);
                this.applyPlaylistFilter();
            },

            clearPlaylistFilter() {
                const input = /** @type {HTMLInputElement | null} */ (document.getElementById('playlistFilterInput'));
                if (input) input.value = '';
                this.playlistFilterQuery = '';
                if (this.settings.playlistTimedOnly) {
                    this.settings.playlistTimedOnly = false;
                    this.saveSettings();
                    const timedToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('playlistTimedOnlyToggle'));
                    if (timedToggle) timedToggle.checked = false;
                }
                this.applyPlaylistFilter();
            },

            /** @param {PlaylistItem} item */
            itemHasTimedLyrics(item) {
                return !!item
                    && item.lyricsStatus === 'ready'
                    && !!item.lyricsData
                    && Array.isArray(item.lyricsData.syncedLines)
                    && item.lyricsData.syncedLines.length > 0;
            },

            /** Re-apply the current filter to every row and refresh the status line. */
            applyPlaylistFilter() {
                const query = this.playlistFilterQuery || '';
                const timedOnly = !!this.settings.playlistTimedOnly;
                let shownCount = 0;
                for (const item of this.playlist) {
                    const row = /** @type {HTMLElement | null} */ (document.querySelector(`.playlist-row[data-item-id="${item.id}"]`));
                    if (!row) continue;
                    const matchesQuery = PlayerSongs.songMatchesQuery(item, query);
                    const matchesTimed = !timedOnly || this.itemHasTimedLyrics(item);
                    const matches = matchesQuery && matchesTimed;
                    row.hidden = !matches;
                    if (matches) shownCount++;
                }

                const status = document.getElementById('playlistFilterStatus');
                const statusText = document.getElementById('playlistFilterStatusText');
                const filtering = !!(query || timedOnly);
                if (status) status.style.display = filtering ? 'flex' : 'none';
                if (statusText && filtering) {
                    const parts = [];
                    if (timedOnly) parts.push('timed lyrics only');
                    if (query) parts.push(`"${query}"`);
                    statusText.textContent = `Filtering for ${parts.join(' + ')} - ${shownCount} of ${this.playlist.length} shown`;
                }
            },

            /**
             * Song notes (the per-song comments) are a display option:
             * one class on the container, CSS does the rest - toggling is
             * instant, no re-render.
             */
            applySongNotesVisibility() {
                const container = document.getElementById('playlistContainer');
                if (container) {
                    container.classList.toggle('playlist-notes-on', !!this.settings.showSongNotes);
                }
            },

            /**
             * Version markers that make a video the WRONG recording for a
             * normal request (the lyrics replay is timed against the studio
             * track). A marker is only penalized when the search itself did
             * not ask for it ("shins live kexp" keeps live versions).
             */
            unwantedVersionMarkers() {
                return [
                    /\blive\b|\bconcert\b|\bunplugged\b/i,
                    /\bcover(s|ed)?\b|\btribute\b/i,
                    /\bremix(es|ed)?\b|\bmashup\b/i,
                    /\bkaraoke\b|\binstrumental\b/i,
                    /\breacts?\b|\breaction\b/i,
                    /\bsped.?up\b|\bslowed\b|\bnightcore\b|\b8d\b/i,
                    /\bacoustic\b/i,
                    /\bdemo\b|\brehearsal\b/i,
                    /\bsessions?\b/i,
                    /\bmedley\b/i,
                    /\bfull (album|concert|set|show|performance)\b/i
                ];
            },

            /** Lowercased, punctuation-free, whitespace-collapsed text for title/channel comparison. @param {string} value */
            simplifyVideoText(value) {
                return String(value || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
            },

            /**
             * Title words that describe the upload format rather than the
             * recording: a plain studio track's title is the song name plus
             * (at most) the artist and these words. Anything else left over
             * is a version signal - a live date, a venue, a festival, a
             * "(Solstice Version)" - even when no explicit live/cover
             * marker appears.
             */
            neutralTitleWords() {
                return new Set([
                    'official', 'video', 'audio', 'music', 'lyric', 'lyrics',
                    'visualizer', 'visualiser', 'hd', '4k', 'hq',
                    'remaster', 'remastered', 'stereo', 'mono', 'album',
                    // Connective filler carries no version information.
                    'a', 'an', 'the', 'at', 'in', 'on', 'of', 'and', 'from', 'with', 'by'
                ]);
            },

            /**
             * How many title words remain after removing the song name, the
             * artist, what the search itself asked for, and neutral format
             * words. 0 for "White Winter Hymnal" or "Artist - Song (OFFICIAL
             * VIDEO)"; positive for date-stamped concert uploads and renamed
             * re-recordings.
             * @param {string} simplifiedTitle @param {string} songName
             * @param {string} artist @param {string} requested
             */
            countExtraneousTitleWords(simplifiedTitle, songName, artist, requested) {
                const known = new Set([
                    ...songName.split(' '),
                    ...artist.split(' '),
                    ...requested.split(' '),
                    ...this.neutralTitleWords()
                ]);
                return simplifiedTitle.split(' ').filter(word => word && !known.has(word)).length;
            },

            /**
             * How much this search result looks like the original studio
             * recording of the requested song. Signals, not guesses:
             * the video must actually BE the requested song (its title
             * contains the song name - the dominant term, so an artist's
             * official upload of a DIFFERENT song can never outrank the
             * right track), auto-generated album tracks ("Provided to
             * YouTube by" / " - Topic") are the studio version by
             * construction, Vevo/official uploads are next best,
             * live/cover/remix/reaction markers are strong negatives unless
             * the request asked for them, leftover title words (dates,
             * venues, version names) score down, and a result that names
             * neither the artist in its channel nor its title is likely
             * someone else's recording of the song.
             * @param {YouTubeVideoCandidate} video
             * @param {{ searchTerm?: string, artist?: string, name?: string }} context
             */
            scoreVideoCandidate(video, context) {
                const title = String(video.title || '');
                const channel = String(video.channelTitle || '');
                const simplify = (/** @type {string} */ value) => this.simplifyVideoText(value);

                // Marker words inside the song's own name ("Cover Me Up",
                // "Live and Let Die") are not version requests: strip the
                // name before reading what the search itself asked for.
                const songName = simplify(context.name || '');
                const requested = songName
                    ? simplify(context.searchTerm || '').replace(songName, ' ')
                    : simplify(context.searchTerm || '');
                let score = 0;

                for (const marker of this.unwantedVersionMarkers()) {
                    if (!marker.test(title)) continue;
                    // An explicitly requested version dominates: "shins live
                    // kexp" must rank live recordings above the studio track
                    // channel signals would otherwise prefer.
                    score += marker.test(requested) ? 1.2 : -0.6;
                }

                // The strongest studio signal in the data: YouTube's own
                // auto-generated album track (detected by the proxy).
                if (video.isAlbumTrack) score += 0.6;
                if (/- topic$/i.test(channel.trim())) score += 0.5;
                if (/vevo/i.test(channel)) score += 0.35;
                if (/official audio/i.test(title)) score += 0.3;
                else if (/official (music )?video/i.test(title)) score += 0.2;

                const artist = simplify(context.artist || '');
                if (artist) {
                    if (simplify(channel).includes(artist)) score += 0.2;
                    else if (!simplify(title).includes(artist)) score -= 0.3;
                }

                if (songName) {
                    const simplifiedTitle = simplify(title);
                    if (simplifiedTitle.includes(songName)) {
                        score += 0.5;
                        const extraneous = this.countExtraneousTitleWords(simplifiedTitle, songName, artist, requested);
                        score -= Math.min(extraneous * 0.15, 0.45);
                    } else {
                        // Not the requested song. Outweighs every positive
                        // channel/format signal a wrong-song upload can earn.
                        score -= 1.0;
                    }
                }

                // A known song is a few minutes long: a 12-minute-plus hit
                // for it is a full set, album, or compilation, not the track.
                if (songName && Number(video.durationSeconds) > 720) score -= 0.4;
                return score;
            },

            /**
             * Order search results studio-version-first (stable: the
             * proxy's relevance order breaks ties).
             * @param {YouTubeVideoCandidate[]} videos
             * @param {{ searchTerm?: string, artist?: string }} context
             */
            rankYouTubeResults(videos, context) {
                return videos
                    .map((video, index) => ({ video, index, score: this.scoreVideoCandidate(video, context) }))
                    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
                    .map(entry => entry.video);
            },

            async searchYouTube(query, context = {}) {
                // Use server-side proxy (proxy.php) which calls Piped/Invidious directly
                // Server-side avoids CORS issues and doesn't need third-party CORS proxies
                const proxyUrl = `proxy.php?q=${encodeURIComponent(query)}`;

                this.addMessage('claude', 'Search', `Searching for: ${query}`);

                let data;
                try {
                    const response = await fetch(proxyUrl);

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        const errorMsg = errorData.error || `HTTP ${response.status}`;
                        this.addMessage('error', 'Search Failed', errorMsg);
                        throw new Error(`Search failed: ${errorMsg}`);
                    }

                    data = await response.json();
                } catch (error) {
                    const cached = window.PlayerHistoryDB ? await window.PlayerHistoryDB.getYouTubeSearch(query) : null;
                    if (cached && Array.isArray(cached.results)) {
                        this.addMessage('claude', 'Search Cache', `Using cached YouTube results for: ${query}`);
                        data = { results: cached.results, source: cached.source || 'cache', instance: cached.instance || 'indexeddb-cache' };
                    } else {
                        throw error;
                    }
                }

                // Check for error response
                if (data.error) {
                    this.addMessage('error', 'Search Error', data.error);
                    throw new Error(data.error);
                }

                // Get results from our standardized proxy response
                const results = data.results || [];
                if (window.PlayerHistoryDB && results.length > 0) {
                    window.PlayerHistoryDB.recordYouTubeSearch(query, results, {
                        source: data.source || '',
                        instance: data.instance || ''
                    });
                }

                const searchContext = { searchTerm: query, ...context };
                const videos = this.rankYouTubeResults(
                    results
                        .filter(result => result.videoId)
                        .map(result => this.formatYouTubeResult(result)),
                    searchContext
                );
                if (videos.length > 0) {
                    // The best available result always plays, but the retry
                    // chain (embed disabled/removed) only holds candidates
                    // that are plausibly the same recording: an alternate
                    // scoring below zero is a wrong song, a live take, or a
                    // cover, and swapping one in silently is worse than
                    // reporting the failure.
                    const [firstVideo, ...rankedRest] = videos;
                    const alternateVideos = rankedRest.filter(video =>
                        this.scoreVideoCandidate(video, searchContext) >= 0);
                    this.addMessage('claude', 'Found', `${firstVideo.title} (via ${data.source || 'proxy'})`);
                    return {
                        ...firstVideo,
                        alternateVideos
                    };
                }

                this.addMessage('claude', 'No Results', `No videos found for: ${query}`);
                return null;
            },

            formatYouTubeResult(video) {
                return {
                    videoId: video.videoId,
                    title: video.title || 'Unknown',
                    channelTitle: video.channelTitle || 'Unknown Artist',
                    duration: this.formatSeconds(video.duration),
                    durationSeconds: Number(video.duration) || 0,
                    isAlbumTrack: !!video.isAlbumTrack
                };
            },

            formatSeconds(totalSeconds) {
                if (!totalSeconds || isNaN(totalSeconds)) return '--:--';
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;

                if (hours > 0) {
                    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                }
                return `${minutes}:${seconds.toString().padStart(2, '0')}`;
            },

            // One compact data line per song, Excel-tight - every datum in a
            // fixed slot on the SAME line:
            //   [star][lyric marker] Name  Artist - Year - Album  3:59 [x]
            // The AI note is a second line only when the Notes toggle is on.
            // Star + lyric marker sit in a padded leading gutter so a near
            // miss on the star favorites instead of starting the song.
            addPlaylistItemToDOM(item) {
                const playlistBody = document.getElementById('playlistBody');
                const row = document.createElement('div');
                row.className = 'playlist-row';
                row.dataset.itemId = String(item.id);
                row.dataset.videoId = item.videoId;

                const isFav = this.isFavorite(item.videoId);
                const marker = this.lyricsRowMarker(item);

                row.innerHTML = `
                    <div class="playlist-row-leading">
                        <button class="favorite-btn ${isFav ? 'favorited' : ''}" data-video-id="${item.videoId}" aria-label="Toggle favorite">${isFav ? '\u2605' : '\u2606'}</button>
                        <button class="lyrics-row-btn ${marker.className}" data-item-id="${item.id}" aria-label="${marker.aria}" title="${marker.aria}">${marker.label}</button>
                    </div>
                    <span class="playlist-song-name">${this.escapeHtml(item.name)}</span>
                    <span class="playlist-row-meta">
                        <span class="playlist-song-artist">${this.escapeHtml(item.artist)}</span>${item.year ? `<span class="playlist-song-year">${this.escapeHtml(item.year)}</span>` : ''}${item.album ? `<span class="playlist-song-album">${this.escapeHtml(item.album)}</span>` : ''}
                    </span>
                    <span class="playlist-song-duration">${item.duration || '--:--'}</span>
                    <button class="playlist-remove-btn" aria-label="Remove from playlist">\u00d7</button>
                    ${item.comment ? `<div class="playlist-song-comment">${this.escapeHtml(item.comment)}</div>` : ''}
                `;

                // Favorite button click - pass full song data
                const favBtn = /** @type {HTMLButtonElement | null} */ (row.querySelector('.favorite-btn'));
                if (favBtn) {
                    favBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const videoId = favBtn.dataset.videoId || '';
                        const isNowFavorited = this.toggleFavorite(videoId, item);
                        favBtn.classList.toggle('favorited', isNowFavorited);
                        favBtn.textContent = isNowFavorited ? '\u2605' : '\u2606';
                    });
                }

                const lyricsBtn = /** @type {HTMLButtonElement | null} */ (row.querySelector('.lyrics-row-btn'));
                if (lyricsBtn) {
                    lyricsBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        void this.showLyricsForItem(item);
                    });
                }

                const removeBtn = /** @type {HTMLButtonElement | null} */ (row.querySelector('.playlist-remove-btn'));
                if (removeBtn) {
                    removeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.removePlaylistItem(item.id);
                    });
                }

                // Leading gutter (star + lyric marker): taps here never play.
                const leading = row.querySelector('.playlist-row-leading');
                if (leading) {
                    leading.addEventListener('click', (e) => {
                        e.stopPropagation();
                    });
                }

                // Tap/click to play (on the row body, not leading controls)
                row.addEventListener('click', (e) => {
                    const target = /** @type {HTMLElement} */ (e.target);
                    if (target.closest('button, .playlist-row-leading')) return;
                    this.playVideo(item);
                });

                playlistBody.appendChild(row);

                // YouTube iframes are created on first play. Creating one for
                // every playlist row up front is expensive on mobile and can
                // leave hidden players stuck before onReady fires.
            },

            removePlaylistItem(itemId) {
                const index = this.playlist.findIndex(entry => entry.id === itemId);
                if (index < 0) return;

                const item = this.playlist[index];
                const wasCurrent = this.currentPlayingId === itemId;
                const wasActivelyPlaying = wasCurrent && this.isPlaying && !this.isPaused;
                if (wasCurrent) {
                    this.stopPlayback();
                }

                this.playlist.splice(index, 1);
                const row = document.querySelector(`.playlist-row[data-item-id="${itemId}"]`);
                if (row) row.remove();
                this.youtubeAlternateResults.delete(itemId);
                if (this.currentLyricsItemId === itemId) {
                    this.currentLyricsItemId = null;
                    this.renderLyricsStateForItem(null);
                }

                if (this.playlist.length === 0) {
                    this.clearPlaylist();
                    this.updateStatus('Removed last song; playlist cleared');
                    return;
                }

                if (index < this.currentPlaylistIndex) {
                    this.currentPlaylistIndex--;
                } else if (index === this.currentPlaylistIndex) {
                    // The cursor slides onto the song that took this slot
                    this.currentPlaylistIndex = Math.min(index, this.playlist.length - 1);
                    if (wasActivelyPlaying) {
                        void this.playVideo(this.playlist[this.currentPlaylistIndex]);
                    } else if (wasCurrent) {
                        this.updateCentralPlayer(null);
                    }
                }

                this.updatePlaylistLabel();
                if (this.playlistFilterQuery || this.settings.playlistTimedOnly) this.applyPlaylistFilter();
                this.persistPlaylist();
                this.updateStatus(`Removed: ${this.truncateForStatus(this.describePlaylistItem(item), 80)}`);
            },

            createPlaylistPlayer(item) {
                if (this.playback.ready && this.playback.player) {
                    this.playback.setActiveItem(item.id);
                    return;
                }

                // Create one active player container outside the table. All
                // playlist items load into this player instead of creating
                // many hidden YouTube iframes.
                const playlistContainer = document.getElementById('playlistContainer');
                let playerDiv = document.getElementById('active-youtube-player');
                if (!playerDiv) {
                    playerDiv = document.createElement('div');
                    playerDiv.id = 'active-youtube-player';
                    playerDiv.className = 'youtube-player';
                    playerDiv.style.display = 'none';
                    playlistContainer.appendChild(playerDiv);
                }

                // Create readiness promise before player construction
                const playerId = 'active-youtube-player';
                let readyResolve;
                const readyPromise = new Promise(resolve => { readyResolve = resolve; });
                this.playerReadyPromises.clear();
                this.playerReadyPromises.set(item.id, { promise: readyPromise, resolve: readyResolve });
                this.playback.setActiveMedia(item.id, item.videoId);
                const settleReady = (result) => {
                    const entry = this.playerReadyPromises.get(item.id);
                    if (!entry || entry.settled) return;
                    entry.settled = true;
                    entry.resolve(result);
                };

                const createPlayer = () => {
                    if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
                        console.error('YouTube API not loaded yet');
                        settleReady({ ok: false, error: 'YouTube API not loaded' });
                        return;
                    }

                    const playerElement = document.getElementById(playerId);
                    if (!playerElement) {
                        console.error('Player element not found:', playerId);
                        settleReady({ ok: false, error: `Player element not found: ${playerId}` });
                        return;
                    }

                    try {
                        const player = new YT.Player(playerId, /** @type {YT.PlayerOptions} */ ({
                            height: '200',
                            width: '100%',
                            videoId: item.videoId,
                            playerVars: {
                                autoplay: 0,
                                controls: 1,
                                enablejsapi: 1,
                                modestbranding: 1,
                                origin: window.location.origin,
                                playsinline: 1,
                                widget_referrer: window.location.origin,
                                rel: 0
                            },
                            events: {
                                onReady: (event) => {
                                    console.log('Player ready for:', item.videoId);
                                    this.playback.markPlayerReady(event.target);
                                    settleReady({ ok: true, player: event.target });
                                },
                                onStateChange: (event) => {
                                    // Auto-advance to next when video ends
                                    if (event.data === YT.PlayerState.ENDED) {
                                        if (this.playback.shouldSuppressAutoAdvance()) {
                                            return;
                                        }
                                        this.playNext();
                                    }
                                },
                                onError: (event) => {
                                    console.error('Player error:', event.data);
                                    const detail = this.describeYouTubePlayerError(event.data);
                                    const activeItem = this.playlist.find(candidate => candidate.id === this.playback.activeItemId) || item;
                                    const entry = this.playerReadyPromises.get(activeItem.id);
                                    const reportNow = !entry || entry.settled;
                                    settleReady({ ok: false, error: detail, errorCode: event.data });
                                    if (reportNow) {
                                        void this.reportPlayerLoadFailure(activeItem, { error: detail, errorCode: event.data });
                                    }
                                }
                            }
                        }));

                        // Hold the handle, but leave playback.ready false until
                        // onReady confirms it can be used (playVideo gates on it).
                        this.playback.player = player;
                    } catch (error) {
                        console.error('Error creating YouTube player:', error);
                        settleReady({ ok: false, error: error.message || String(error) });
                    }
                };

                // Wait a tick for the DOM to settle, then create the player on a
                // single deterministic readiness path: await the one shared
                // YouTube-API-ready promise, bounded by a timeout. No polling
                // loop and no parallel callback queue - exactly one mechanism
                // decides when the player is built.
                setTimeout(() => {
                    if (!document.getElementById(playerId)) {
                        return; // playlist cleared before we could create
                    }
                    const apiTimeout = new Promise(resolve => setTimeout(() => resolve('timeout'), YOUTUBE_API_TIMEOUT_MS));
                    Promise.race([this.ensureYouTubeApi(), apiTimeout]).then(() => {
                        if (!document.getElementById(playerId)) {
                            return; // playlist cleared while waiting
                        }
                        if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
                            settleReady({ ok: false, error: `YouTube API did not load within ${YOUTUBE_API_TIMEOUT_MS / 1000}s` });
                            return;
                        }
                        createPlayer();
                    });
                }, DOM_SETTLE_DELAY_MS);
            },

            ensurePlaylistPlayer(item) {
                if (this.playback.ready && this.playback.player) {
                    this.playback.setActiveItem(item.id);
                    return;
                }

                if (this.playerReadyPromises.has(item.id)) {
                    return;
                }
                this.createPlaylistPlayer(item);
            },

            recreatePlaylistPlayer(item) {
                // The single player handle is reused; just repoint it at the new
                // item so the next play loads its (changed) video id.
                this.playback.setActiveItem(item.id);
            },

            applyVideoDataToPlaylistItem(item, videoData) {
                item.videoId = videoData.videoId;
                item.title = videoData.title;
                item.channelTitle = videoData.channelTitle;
                item.duration = videoData.duration;
                item.durationSeconds = videoData.durationSeconds;
                item.lyricsStatus = 'idle';
                item.lyricsData = null;
                item.lyricOffsetSeconds = 0;
            },

            refreshPlaylistRowVideo(item) {
                const row = /** @type {HTMLElement | null} */ (document.querySelector(`[data-item-id="${item.id}"]`));
                if (!row) return;

                row.dataset.videoId = item.videoId;
                const favBtn = /** @type {HTMLElement | null} */ (row.querySelector('.favorite-btn'));
                if (favBtn) {
                    favBtn.dataset.videoId = item.videoId;
                    const favorited = this.isFavorite(item.videoId);
                    favBtn.classList.toggle('favorited', favorited);
                    favBtn.textContent = favorited ? '\u2605' : '\u2606';
                }

                const lyricsBtn = row.querySelector('.lyrics-row-btn');
                if (lyricsBtn) {
                    lyricsBtn.classList.remove('ready');
                    lyricsBtn.textContent = 'Get';
                    lyricsBtn.setAttribute('aria-label', 'Get lyrics');
                }

                const durationEl = row.querySelector('.playlist-song-duration');
                if (durationEl) {
                    durationEl.textContent = item.duration || '--:--';
                }
            },

            describeYouTubePlayerError(code) {
                const numericCode = Number(code);
                switch (numericCode) {
                    case 2:
                        return 'YouTube player error 2: invalid video ID or player parameter';
                    case 5:
                        return 'YouTube player error 5: this video cannot be played in the HTML5 player';
                    case 100:
                        return 'YouTube player error 100: video removed, private, or not found';
                    case 101:
                    case 150:
                        return `YouTube player error ${numericCode}: owner disabled embedded playback`;
                    case 153:
                        return 'YouTube player error 153: missing referrer or client identity for the embed request';
                    default:
                        return `YouTube player error ${numericCode || code}`;
                }
            },

            playerLoadFailureInfo(failure) {
                if (typeof failure === 'object' && failure !== null) {
                    return {
                        detail: failure.error || failure.message || 'Unknown player load failure',
                        errorCode: Number(failure.errorCode) || null
                    };
                }

                const detail = failure || 'Unknown player load failure';
                const match = String(detail).match(/YouTube player error\s+(\d+)/i);
                const errorCode = match ? Number(match[1]) : null;
                return {
                    detail: errorCode ? this.describeYouTubePlayerError(errorCode) : detail,
                    errorCode
                };
            },

            shouldRetryWithAlternateVideo(errorCode) {
                return [5, 100, 101, 150].includes(Number(errorCode));
            },

            tryNextVideoResult(item, failure) {
                const { detail, errorCode } = this.playerLoadFailureInfo(failure);
                if (!this.shouldRetryWithAlternateVideo(errorCode)) {
                    return false;
                }

                const alternates = this.youtubeAlternateResults.get(item.id) || [];
                const nextVideo = alternates.shift();
                if (!nextVideo) {
                    return false;
                }
                if (alternates.length === 0) {
                    this.youtubeAlternateResults.delete(item.id);
                }

                const previousVideoId = item.videoId;
                this.addMessage('claude', 'Retrying video result',
                    `Track: ${this.describePlaylistItem(item)}\nSearch term: ${item.searchTerm || '(none)'}\nPrevious video ID: ${previousVideoId}\nReason: ${detail}\nNext video ID: ${nextVideo.videoId}\nNext title: ${nextVideo.title}`);
                this.applyVideoDataToPlaylistItem(item, nextVideo);
                this.refreshPlaylistRowVideo(item);
                this.recreatePlaylistPlayer(item);
                this.persistPlaylist();
                return true;
            },

            describePlaylistItem(item) {
                const title = item.name || item.title || item.searchTerm || 'Unknown track';
                const artist = item.artist || item.channelTitle || '';
                return artist ? `${title} by ${artist}` : title;
            },

            waitForPlayerReady(item, timeoutMs = PLAYER_READY_TIMEOUT_MS) {
                const entry = this.playerReadyPromises.get(item.id);
                if (!entry) {
                    return Promise.resolve({ ok: false, error: 'No player readiness entry exists' });
                }

                const timeout = new Promise(resolve => {
                    setTimeout(() => {
                        resolve({ ok: false, error: `Player did not become ready within ${timeoutMs / 1000}s` });
                    }, timeoutMs);
                });

                return Promise.race([entry.promise, timeout]);
            },

            /**
             * Alternate video candidates only live in session memory, so a
             * playlist restored after a reload has none. When a video turns
             * out unplayable (embed disabled, removed), re-run the YouTube
             * search for the song's search term once and stock fresh
             * alternates, excluding the video that just failed.
             * @param {PlaylistItem} item
             * @returns {Promise<boolean>} whether alternates were stocked
             */
            async refreshAlternatesFromSearch(item) {
                if (!item.searchTerm) return false;
                if (this.alternateVideoSearchAttempts.has(item.id)) return false;
                this.alternateVideoSearchAttempts.add(item.id);
                try {
                    const videoData = await this.searchYouTube(item.searchTerm, { artist: item.artist || '', name: item.name || '' });
                    if (!videoData) return false;
                    const candidates = [videoData, ...(videoData.alternateVideos || [])]
                        .filter(video => video.videoId && video.videoId !== item.videoId)
                        .map(video => {
                            const candidate = { ...video };
                            delete candidate.alternateVideos;
                            return candidate;
                        });
                    if (!candidates.length) return false;
                    this.youtubeAlternateResults.set(item.id, candidates);
                    this.addMessage('claude', 'Fresh video candidates', `${candidates.length} alternate video${candidates.length === 1 ? '' : 's'} for: ${this.describePlaylistItem(item)}`);
                    return true;
                } catch (error) {
                    // External search failure; the load-failure report stands.
                    return false;
                }
            },

            async reportPlayerLoadFailure(item, failure) {
                const description = this.describePlaylistItem(item);
                const { detail, errorCode } = this.playerLoadFailureInfo(failure);
                let retrying = this.tryNextVideoResult(item, failure);
                if (!retrying && this.shouldRetryWithAlternateVideo(errorCode)) {
                    this.updateStatus(`Finding an alternate video for: ${this.truncateForStatus(description, 80)}`);
                    if (await this.refreshAlternatesFromSearch(item)) {
                        retrying = this.tryNextVideoResult(item, failure);
                    }
                }
                if (retrying) {
                    this.updateStatus(`Retrying another video for: ${this.truncateForStatus(description, 80)}`);
                    void this.playVideo(item);
                    return;
                }

                this.addMessage('error', 'Player load failed', `Track: ${description}\nVideo ID: ${item.videoId}\nSearch term: ${item.searchTerm || '(none)'}\nReason: ${detail}`);
                this.updateStatus(`Player load failed: ${this.truncateForStatus(description, 80)}. Try next.`);
                if (this.settings.readClaudeResponse) {
                    this.speakText(`Player load failed for ${description}. Try next.`);
                }
            },

            async playVideo(item) {
                this.ensurePlaylistPlayer(item);

                // Stop currently playing video
                if (this.currentPlayingId && this.currentPlayingId !== item.id) {
                    const currentPlayer = this.playback.player;
                    if (currentPlayer && typeof currentPlayer.pauseVideo === 'function') {
                        try {
                            currentPlayer.pauseVideo();
                        } catch (e) {
                            console.error('Error pausing video:', e);
                        }
                    }
                    // Remove playing class from all rows
                    document.querySelectorAll('#playlistBody .playlist-row').forEach(el => {
                        el.classList.remove('playing');
                    });
                }

                // Play new video. The player is only exposed once ready; until
                // then we fall through to the loading branch below.
                const player = this.playback.ready ? this.playback.player : null;
                if (player && typeof player.playVideo === 'function') {
                    try {
                        if (this.playback.activeVideoId !== item.videoId && typeof player.loadVideoById === 'function') {
                            this.playback.setActiveMedia(item.id, item.videoId);
                            player.loadVideoById(item.videoId);
                        } else {
                            this.playback.setActiveMedia(item.id, item.videoId);
                            player.playVideo();
                        }
                        this.playback.markPlaying(item.id);

                        // Update playlist index
                        this.playback.currentPlaylistIndex = this.playlist.findIndex(song => song.id === item.id);

                        // Update central player display
                        this.updateCentralPlayer(item);
                        this.updateMediaSessionForItem(item);

                        this.currentLyricsItemId = item.id;
                        this.currentLyricsLineIndex = -1;
                        if (!this.lyricsPanelDismissed) {
                            this.setLyricsPanelVisible(true);
                        } else {
                            this.renderLyricsStateForItem(item);
                        }
                        void this.ensureLyricsForItem(item);

                        // Update UI to show which is playing in playlist
                        const itemEl = document.querySelector(`[data-item-id="${item.id}"]`);
                        if (itemEl) {
                            itemEl.classList.add('playing');
                        }

                        // Update play/pause button
                        this.updatePlayPauseButton();

                        // Start progress bar updates
                        this.startProgressUpdates();
                        void this.startPrebufferProbeFor(item);

                        // Log the play action; the status line gets fresh
                        // truth on every track so stale "Player loading"
                        // text can never outlive the load it described.
                        const songTitle = item.name || item.title || 'Unknown';
                        this.addMessage('user', 'Now Playing', `${songTitle}`);
                        this.updateStatus(`Playing: ${this.truncateForStatus(this.describePlaylistItem(item), 100)}`);
                        this.persistPlaylist();
                    } catch (e) {
                        console.error('Error playing video:', e);
                        this.logError('Playback Error', e);
                        this.updateStatus('Error playing video. Try again.');
                    }
                } else {
                    this.playback.markLoading();
                    const description = this.describePlaylistItem(item);
                    this.updateStatus(`Player loading: ${this.truncateForStatus(description, 100)}`);
                    this.addMessage('claude', 'Player loading', `Waiting for player: ${description}\nVideo ID: ${item.videoId}\nSearch term: ${item.searchTerm || '(none)'}`);
                    const loadingVideoId = item.videoId;
                    const ready = await this.waitForPlayerReady(item);
                    if (ready.ok) {
                        const readyPlayer = ready.player || this.playback.player;
                        if (readyPlayer) {
                            this.playback.markPlayerReady(readyPlayer);
                        }
                        return this.playVideo(item);
                    }
                    if (item.videoId !== loadingVideoId) {
                        return;
                    }
                    void this.reportPlayerLoadFailure(item, ready.error);
                }
            },

            updateCentralPlayer(item) {
                const titleEl = document.getElementById('playerSongTitle');
                const artistEl = document.getElementById('playerSongArtist');
                const transportInfo = document.getElementById('transportBarInfo');

                if (item) {
                    const songTitle = item.name || item.title || '';
                    const artistName = item.artist || item.channelTitle || '';
                    titleEl.textContent = songTitle;
                    artistEl.textContent = artistName;
                    if (transportInfo) {
                        transportInfo.textContent = artistName ? `${artistName} - ${songTitle}` : songTitle;
                    }
                } else {
                    titleEl.textContent = '';
                    artistEl.textContent = '';
                    if (transportInfo) transportInfo.textContent = 'No song playing';
                }
                // Song change or clear: the bar lyric belongs to the previous
                // song until this song's synced position writes its own.
                this.updateTransportBarLyric('');
                this.updateBigLyricsAvailability();
                this.updateFirstLyricButton();
            },

            /** Bring the current song's row into view (the bar's song line). */
            scrollToCurrentSong() {
                const item = this.playlist.find(entry => entry.id === this.currentPlayingId)
                    || this.currentPlaylistItem();
                if (!item) return;
                const row = document.querySelector(`.playlist-row[data-item-id="${item.id}"]`);
                if (!row) return;
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            },

            updateMediaSessionForItem(item) {
                if (!item) return;

                // Stable song identity is a separate channel from the lyric
                // title. A changed videoId is a real media boundary; lyric
                // lines within it are not.
                this.nowPlayingShowsLyric = false;
                // Every play intent must wait for a fresh YouTube sample.
                // This also covers a one-song playlist looping the same id.
                MediaSessionCore.clearPosition();
                MediaSessionCore.setTrackIdentity({
                    id: item.videoId,
                    title: item.name || item.title || 'Unknown song',
                    artist: this.describeNowPlayingArtist(item),
                    album: item.album || '',
                    artwork: [{
                        src: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                        sizes: '480x360',
                        type: 'image/jpeg'
                    }]
                });
                // A new play intent starts at song identity, even when the
                // same videoId is replayed after its previous final lyric.
                MediaSessionCore.clearDisplayLine();
                MediaSessionCore.setPlaybackState('playing');
                if (!this.mediaActionHandlersSet) {
                    this.mediaActionHandlersSet = true;
                    MediaSessionCore.setActionHandlers([
                        ['play', () => this.playPlaylist()],
                        ['pause', () => this.pausePlayback()],
                        ['previoustrack', () => this.playPrevious()],
                        ['nexttrack', () => this.playNext()],
                        ['seekbackward', details => this.seekBy(-(details.seekOffset || 10))],
                        ['seekforward', details => this.seekBy(details.seekOffset || 10)],
                        ['seekto', details => {
                            if (typeof details.seekTime === 'number') {
                                this.seekToTime(details.seekTime);
                            }
                        }]
                    ]);
                }
            },

            stopPlayback() {
                if (!this.currentPlayingId) return;
                const player = this.playback.player;
                if (player && typeof player.stopVideo === 'function') {
                    try {
                        this.playback.suppressAutoAdvanceFor(1500);
                        player.stopVideo();
                    } catch (e) {
                        console.error('Error stopping video:', e);
                    }
                }
                this.playback.markStopped();
                this.nowPlayingShowsLyric = false;
                MediaSessionCore.clearTrack();
                this.updatePlayPauseButton();
                this.stopProgressUpdates();
                this.updateProgressBar(0, 1);
            },

            playPlaylist() {
                if (this.playlist.length === 0) {
                    this.updateStatus('Playlist is empty');
                    return;
                }

                if (this.isPaused && this.currentPlayingId) {
                    // Resume current
                    const player = this.playback.player;
                    if (player && typeof player.playVideo === 'function') {
                        const currentItem = this.playlist.find(item => item.id === this.currentPlayingId) || null;
                        player.playVideo();
                        this.playback.markPlaying(this.playback.currentPlayingId);
                        MediaSessionCore.setPlaybackState('playing');
                        this.updatePlayPauseButton();
                        this.startProgressUpdates();
                        this.relayLyricToNowPlaying(this.currentLyricsLineIndex);
                        if (currentItem) {
                            this.currentPlaylistIndex = this.playlist.findIndex(item => item.id === currentItem.id);
                            this.currentLyricsItemId = currentItem.id;
                            this.renderLyricsStateForItem(currentItem);
                            void this.ensureLyricsForItem(currentItem);
                        }
                    }
                } else if (this.currentPlaylistIndex >= 0 && this.currentPlaylistIndex < this.playlist.length) {
                    // Continue from current position
                    this.playVideo(this.playlist[this.currentPlaylistIndex]);
                } else {
                    // Start from beginning
                    this.currentPlaylistIndex = 0;
                    this.playVideo(this.playlist[0]);
                }
            },

            pausePlayback() {
                if (this.currentPlayingId) {
                    const player = this.playback.player;
                    if (player && typeof player.pauseVideo === 'function') {
                        player.pauseVideo();
                        // Freeze the receiver at the real YouTube position
                        // before stopping the deadline clock.
                        this.renderPlaybackPosition();
                        this.playback.markPaused();
                        MediaSessionCore.setPlaybackState('paused');
                        this.updatePlayPauseButton();
                        this.stopProgressUpdates();
                    }
                }
            },

            togglePlayPause() {
                if (this.isPlaying && !this.isPaused) {
                    this.pausePlayback();
                } else {
                    this.playPlaylist();
                }
            },

            playNext() {
                if (this.playlist.length === 0) return;

                let nextIndex = this.currentPlaylistIndex + 1;
                if (nextIndex >= this.playlist.length) {
                    nextIndex = 0; // Loop to beginning
                }

                this.currentPlaylistIndex = nextIndex;
                this.playVideo(this.playlist[nextIndex]);
            },

            playPrevious() {
                if (this.playlist.length === 0) return;

                let prevIndex = this.currentPlaylistIndex - 1;
                if (prevIndex < 0) {
                    prevIndex = this.playlist.length - 1; // Loop to end
                }

                this.currentPlaylistIndex = prevIndex;
                this.playVideo(this.playlist[prevIndex]);
            },

            /** @param {number} seconds positive = forward, negative = back */
            seekBy(seconds) {
                if (!this.currentPlayingId) return;
                const player = this.playback.player;
                if (player && typeof player.getCurrentTime === 'function' && typeof player.seekTo === 'function') {
                    try {
                        const currentTime = player.getCurrentTime();
                        player.seekTo(Math.max(0, currentTime + seconds), true);
                        this.resyncProgressClock();
                    } catch (e) {
                        console.error('Error seeking:', e);
                    }
                }
            },

            /**
             * Jump to just before the first timed lyric line of the
             * current song. No-op when the playing item has no synced lines.
             */
            seekToFirstLyric() {
                if (!this.currentPlayingId) return;
                const item = this.currentPlaylistItem();
                if (!item || !this.itemHasTimedLyrics(item) || !item.lyricsData) return;
                const firstLine = item.lyricsData.syncedLines.find(line => String(line.text || '').trim());
                if (!firstLine) return;
                // First sung moment is the file timestamp shifted by the
                // per-song lyric offset (positive offset = lyrics delayed).
                const seekAt = firstLine.time - this.lyricOffsetForItem(item) - FIRST_LYRIC_LEAD_SECONDS;
                const player = this.playback.player;
                if (player && typeof player.seekTo === 'function') {
                    try {
                        player.seekTo(Math.max(0, seekAt), true);
                        this.resyncProgressClock();
                    } catch (e) {
                        console.error('Error seeking to first lyric:', e);
                    }
                }
            },

            /** Show "1st" only while the playing track has timed lyrics. */
            updateFirstLyricButton() {
                const item = this.currentPlaylistItem();
                const show = !!this.currentPlayingId && !!item && this.itemHasTimedLyrics(item)
                    && item.id === this.currentPlayingId;
                const btn = document.getElementById('transportFirstLyricBtn');
                if (btn) btn.style.display = show ? '' : 'none';
            },

            fastForward() {
                this.seekBy(SEEK_JUMP_SECONDS);
            },

            rewind() {
                this.seekBy(-SEEK_JUMP_SECONDS);
            },

            updateTransportPauseLabel() {
                const btn = document.getElementById('lyricsTransportPause');
                if (btn) btn.innerHTML = (this.isPlaying && !this.isPaused) ? '&#9208;' : '&#9654;';
            },

            restartCurrentTrack() {
                if (this.currentPlayingId) {
                    const player = this.playback.player;
                    if (player && typeof player.seekTo === 'function') {
                        player.seekTo(0, true);
                        this.resyncProgressClock();
                    }
                }
            },

            updatePlayPauseButton() {
                const btn = document.getElementById('playPauseBtn');
                const transportBtn = document.getElementById('lyricsTransportPause');
                const barBtn = document.getElementById('transportPlayPauseBtn');
                if (this.isPlaying && !this.isPaused) {
                    btn.textContent = '⏸';
                    btn.setAttribute('aria-label', 'Pause');
                    if (transportBtn) transportBtn.innerHTML = '&#9208;';
                    if (barBtn) { barBtn.innerHTML = '&#9208;'; barBtn.setAttribute('aria-label', 'Pause'); }
                } else {
                    btn.textContent = '▶';
                    btn.setAttribute('aria-label', 'Play');
                    if (transportBtn) transportBtn.innerHTML = '&#9654;';
                    if (barBtn) { barBtn.innerHTML = '&#9654;'; barBtn.setAttribute('aria-label', 'Play'); }
                }
            },

            /**
             * Empty the working playlist and its playback machinery (rows,
             * the reused YouTube player, lyric state) WITHOUT hiding the
             * player surfaces - the piece a replace-on-new-search reuses.
             */
            clearPlaylistItems() {
                this.cleanupPrebufferProbe();
                // Stop any playing video
                if (this.currentPlayingId) {
                    const player = this.playback.player;
                    if (player && typeof player.stopVideo === 'function') {
                        try {
                            this.playback.suppressAutoAdvanceFor(1500);
                            player.stopVideo();
                        } catch (e) {
                            // Ignore
                        }
                    }
                }

                this.stopProgressUpdates();
                this.playlist = [];
                document.getElementById('playlistBody').innerHTML = '';
                this.clearPlaylistFilter();

                // Remove any player divs that were appended to the container
                const container = document.getElementById('playlistContainer');
                const playerDivs = container.querySelectorAll('.youtube-player');
                playerDivs.forEach(div => div.remove());

                if (this.playback.player) {
                    try {
                        this.playback.player.destroy();
                    } catch (e) {
                        // Ignore errors
                    }
                }
                this.playerReadyPromises.clear();
                this.youtubeAlternateResults.clear();
                this.alternateVideoSearchAttempts.clear();
                // Drop queued lookups for the discarded rows; detached
                // backfill items are not playlist-bound and keep going.
                this.lyricsFetchQueue = this.lyricsFetchQueue.filter(item => item.sourceKind === 'backfill');
                this.playback.reset();
                this.nowPlayingShowsLyric = false;
                MediaSessionCore.clearTrack();
                this.updatePlayPauseButton();
                this.updateCentralPlayer(null);
                this.updatePlaylistLabel();
                this.currentLyricsItemId = null;
                this.currentLyricsLineIndex = -1;
                this.renderLyricsStateForItem(null);
                this.persistPlaylist();
            },

            clearPlaylist() {
                this.clearPlaylistItems();

                document.getElementById('playlistContainer').style.display = 'none';
                document.getElementById('centralPlayer').style.display = 'none';
                this.hideTransportBar();
                this.setLyricsPanelVisible(false);
                this.lyricsPanelDismissed = false;
                this.closeLyricsOverlay();

                // Also hide transcript/response containers
                this.hideClaudeResponse();
                this.hidePrompt();
                const transcriptContainer = document.getElementById('transcriptContainer');
                if (transcriptContainer) {
                    transcriptContainer.style.display = 'none';
                }
            },

            persistPlaylist() {
                // Persist the Songs + membership only, never the lyric
                // runtime: full lyrics per item is what exceeded the
                // localStorage quota. Lyrics re-hydrate from their one
                // owner (the lyrics cache) at load.
                const entries = this.playlist.map(item => PlayerSongs.persistedPlaylistEntry(item));
                PlayerStorage.savePlaylist(entries, this.currentPlaylistIndex);
            },

            restoreSavedPlaylist() {
                const saved = PlayerStorage.loadPlaylist();
                if (!saved.items.length) {
                    return;
                }

                this.showPlaylistSurfaces();

                for (const entry of saved.items) {
                    const item = PlayerSongs.createPlaylistItem(entry, {
                        sourceKind: 'restored',
                        sourceLabel: 'Known at load'
                    });
                    if (!item) continue;
                    this.appendPlaylistItem(item);
                }
                if (window.PlayerHistoryDB) {
                    window.PlayerHistoryDB.recordSongs(this.playlist, 'restored-at-load');
                }
                this.currentPlaylistIndex = Math.min(saved.currentPlaylistIndex, this.playlist.length - 1);
                this.updatePlaylistLabel();

                if (this.currentPlaylistIndex >= 0) {
                    const current = this.playlist[this.currentPlaylistIndex];
                    this.updateCentralPlayer(current);
                    const row = document.querySelector(`[data-item-id="${current.id}"]`);
                    if (row) row.classList.add('playing');
                }
            },

            escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            },

            decodeHtml(text) {
                // YouTube API returns HTML-encoded titles (e.g., &amp; instead of &)
                // Decode them before storing to avoid double-encoding when displayed
                const div = document.createElement('div');
                div.innerHTML = text;
                return div.textContent;
            },

            currentPlaylistItem() {
                if (this.currentPlaylistIndex < 0 || this.currentPlaylistIndex >= this.playlist.length) {
                    return null;
                }
                return this.playlist[this.currentPlaylistIndex];
            },

            showTransportBar() {
                const bar = document.getElementById('playlistTransportBar');
                if (bar) bar.style.display = 'flex';
            },

            hideTransportBar() {
                const bar = document.getElementById('playlistTransportBar');
                if (bar) bar.style.display = 'none';
            },

            // Two seek surfaces, one behavior: the central player's track
            // and the sticky bar's strip both click/drag-seek through
            // seekToPercentage.
            setupProgressBar() {
                const strips = [
                    document.getElementById('progressBarTrack'),
                    document.getElementById('transportProgressTrack')
                ].filter(strip => strip !== null);

                /** @param {HTMLElement} strip @param {number} clientX */
                const seekAt = (strip, clientX) => {
                    const rect = strip.getBoundingClientRect();
                    const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                    this.seekToPercentage(percentage);
                };

                for (const strip of strips) {
                    strip.addEventListener('mousedown', (e) => {
                        this.isDraggingProgress = true;
                        this.activeSeekStrip = strip;
                        strip.classList.add('dragging');
                        seekAt(strip, e.clientX);
                    });

                    strip.addEventListener('touchstart', (e) => {
                        this.isDraggingProgress = true;
                        this.activeSeekStrip = strip;
                        strip.classList.add('dragging');
                        seekAt(strip, e.touches[0]?.clientX || 0);
                    });

                    strip.addEventListener('touchmove', (e) => {
                        if (this.isDraggingProgress && this.activeSeekStrip === strip) {
                            e.preventDefault();
                            seekAt(strip, e.touches[0]?.clientX || 0);
                        }
                    });

                    strip.addEventListener('touchend', () => {
                        this.isDraggingProgress = false;
                        this.activeSeekStrip = null;
                        strip.classList.remove('dragging');
                    });

                    strip.addEventListener('click', (e) => seekAt(strip, e.clientX));
                }

                document.addEventListener('mousemove', (e) => {
                    if (this.isDraggingProgress && this.activeSeekStrip) {
                        seekAt(this.activeSeekStrip, e.clientX);
                    }
                });

                document.addEventListener('mouseup', () => {
                    if (this.isDraggingProgress) {
                        this.isDraggingProgress = false;
                        this.activeSeekStrip?.classList.remove('dragging');
                        this.activeSeekStrip = null;
                    }
                });
            },

            seekToPercentage(percentage) {
                if (!this.currentPlayingId) return;

                const player = this.playback.player;
                if (player && typeof player.getDuration === 'function' && typeof player.seekTo === 'function') {
                    const duration = player.getDuration();
                    if (duration && duration > 0) {
                        const seekTime = duration * percentage;
                        player.seekTo(seekTime, true);
                        this.updateProgressBar(seekTime, duration);
                        this.resyncProgressClock();
                    }
                }
            },

            /** @param {number} seconds */
            seekToTime(seconds) {
                if (!this.currentPlayingId) return;
                const player = this.playback.player;
                if (!player || typeof player.getDuration !== 'function'
                    || typeof player.seekTo !== 'function') return;
                const duration = Number(player.getDuration());
                if (!Number.isFinite(duration) || duration <= 0) return;
                player.seekTo(Math.min(Math.max(Number(seconds) || 0, 0), duration), true);
                this.resyncProgressClock();
            },

            // Deadline scheduling, not polling: everything these surfaces
            // show changes at KNOWN media times - the next synced lyric
            // moment (line time, and line time minus the title lead) and
            // the next whole second of the mm:ss display. So render once
            // from the player's actual time, then sleep until the
            // earliest upcoming deadline. Every wake re-reads the real
            // time and renders idempotently, so early timers, buffering
            // stalls, and drift self-correct instead of accumulating.
            startProgressUpdates() {
                this.scheduleNextProgressRender();
            },

            stopProgressUpdates() {
                if (this.progressUpdateTimer !== null) {
                    clearTimeout(this.progressUpdateTimer);
                    this.progressUpdateTimer = null;
                }
            },

            /** Re-derive the surfaces and the wake-up from truth, now. */
            resyncProgressClock() {
                if (this.isPlaying) {
                    this.scheduleNextProgressRender();
                } else {
                    this.renderPlaybackPosition();
                }
            },

            scheduleNextProgressRender() {
                this.stopProgressUpdates();
                const currentTime = this.renderPlaybackPosition();
                if (!this.isPlaying) return; // pause/stop freeze the surfaces; transitions re-arm
                let delaySec;
                if (currentTime === null || this.isDraggingProgress) {
                    delaySec = 0.25; // player not readable yet / drag in progress
                } else if (currentTime === this.lastRenderedMediaTime) {
                    delaySec = 0.5; // stalled (buffering): check back, don't spin
                } else {
                    const nextSecond = Math.floor(currentTime) + 1;
                    const deadline = Math.min(nextSecond, this.nextLyricDeadline(currentTime));
                    delaySec = Math.max(deadline - currentTime, 0.025);
                }
                this.lastRenderedMediaTime = currentTime;
                this.progressUpdateTimer = setTimeout(() => this.scheduleNextProgressRender(), delaySec * 1000);
            },

            /**
             * The one idempotent render of playback position: progress
             * bar, time text, lyric highlight, and the now-playing title
             * relay all re-derive from the player's actual current time.
             * @returns {number | null} that time, if readable
             */
            renderPlaybackPosition() {
                if (!this.currentPlayingId || this.isDraggingProgress) return null;

                const player = this.playback.player;
                if (player && typeof player.getCurrentTime === 'function' && typeof player.getDuration === 'function') {
                    const currentTime = player.getCurrentTime();
                    const duration = player.getDuration();
                    if (duration && duration > 0) {
                        const playbackRate = (typeof player.getPlaybackRate === 'function')
                            ? Number(player.getPlaybackRate()) || 1
                            : 1;
                        MediaSessionCore.setPosition({ duration, playbackRate, position: currentTime });
                        this.updateProgressBar(currentTime, duration);
                        return currentTime;
                    }
                }
                return null;
            },

            updateProgressBar(currentTime, duration) {
                if (!this.progressDiff) this.progressDiff = new ValueDiff();
                const percentage = `${(currentTime / duration) * 100}%`;

                const fill = document.getElementById('progressBarFill');
                const handle = document.getElementById('progressBarHandle');
                const currentTimeEl = document.getElementById('currentTime');
                const totalTimeEl = document.getElementById('totalTime');
                if (fill && handle && currentTimeEl && totalTimeEl) {
                    this.progressDiff.style('fillWidth', fill, 'width', percentage);
                    this.progressDiff.style('handleLeft', handle, 'left', percentage);
                    this.progressDiff.text('currentTime', currentTimeEl, this.formatTime(currentTime));
                    this.progressDiff.text('totalTime', totalTimeEl, this.formatTime(duration));
                }

                // The sticky bar's strip mirrors the same truth.
                const barFill = document.getElementById('transportProgressFill');
                const barCurrent = document.getElementById('transportBarTimeCurrent');
                const barTotal = document.getElementById('transportBarTimeTotal');
                if (barFill && barCurrent && barTotal) {
                    this.progressDiff.style('barFillWidth', barFill, 'width', percentage);
                    this.progressDiff.text('barTimeCurrent', barCurrent, this.formatTime(currentTime));
                    this.progressDiff.text('barTimeTotal', barTotal, this.formatTime(duration));
                }

                this.updateSyncedLyricsPosition(currentTime);
            },

            formatTime(seconds) {
                if (!seconds || isNaN(seconds)) return '0:00';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            },

            // One shared promise is the single source of "the YouTube IFrame
            // API is ready". ensureYouTubeApi() resolves immediately if the API
            // is already present, otherwise it resolves when the global ready
            // callback fires. Player creation awaits this - no polling, no queue.
            ensureYouTubeApi() {
                if (typeof YT !== 'undefined' && typeof YT.Player !== 'undefined') {
                    return Promise.resolve();
                }
                if (!this.youtubeApiReadyPromise) {
                    this.youtubeApiReadyPromise = new Promise(resolve => {
                        this.resolveYouTubeApiReady = resolve;
                    });
                }
                return this.youtubeApiReadyPromise;
            },

            setupYouTubeAPI() {
                if (typeof YT !== 'undefined' && typeof YT.Player !== 'undefined') {
                    this.playerReady();
                    return;
                }
                // The IFrame API calls this global once it finishes loading.
                window.onYouTubeIframeAPIReady = () => {
                    this.playerReady();
                };
            },

            playerReady() {
                console.log('YouTube API ready');
                if (this.resolveYouTubeApiReady) {
                    this.resolveYouTubeApiReady();
                    this.resolveYouTubeApiReady = null;
                }
            },

            loadDemoSongIfRequested() {
                const params = new URLSearchParams(window.location.search);
                if (params.get('demoLyrics') !== '1' || this.playlist.length > 0) {
                    return;
                }

                const demoItem = PlayerSongs.createPlaylistItem({
                    videoId: 'dQw4w9WgXcQ',
                    name: 'Never Gonna Give You Up',
                    artist: 'Rick Astley',
                    year: '1987',
                    album: 'Whenever You Need Somebody',
                    title: 'Rick Astley - Never Gonna Give You Up',
                    channelTitle: 'Rick Astley',
                    duration: '3:34',
                    durationSeconds: 214,
                    comment: 'Demo lyrics item',
                    searchTerm: 'Rick Astley Never Gonna Give You Up'
                }, {
                    sourceKind: 'demo',
                    sourceLabel: 'Demo song'
                });
                if (!demoItem) return;

                this.showPlaylistSurfaces();
                this.appendPlaylistItem(demoItem);
                this.currentPlaylistIndex = 0;
                this.currentLyricsItemId = demoItem.id;
                this.updateCentralPlayer(demoItem);
                this.updatePlaylistLabel();
                this.setLyricsPanelVisible(true);
                this.renderLyricsStateForItem(demoItem);
                this.updateStatus('Demo lyrics song loaded');
            },

            parseDurationToSeconds(value) {
                return PlayerSongs.parseDurationToSeconds(value);
            }
        }));
    }

    return { install };
})();

window.PlayerPlaylist = PlayerPlaylist;
