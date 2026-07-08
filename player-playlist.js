// @ts-check
// Playlist DOM, YouTube search/playback, and transport controls.

const SEEK_JUMP_SECONDS = 10;
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
                document.getElementById('centralPlayer').style.display = 'block';
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
                // A new AI search starts a fresh working playlist. Nothing is
                // lost: the lookup and every song already live in the durable
                // history (IndexedDB) and can be reloaded from the History
                // panel. Explicit loads (favorites, history) append instead.
                if (options.replaceExisting && this.playlist.length > 0 && songList.length > 0) {
                    const previousCount = this.playlist.length;
                    this.clearPlaylistItems();
                    this.addMessage('claude', 'New search', `Replaced the working playlist (${previousCount} song${previousCount === 1 ? '' : 's'} stay in Known Songs history)`);
                }

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

                const results = await this.searchSongsWithConcurrency(validSongs);

                // Add to playlist in the AI's order (appendPlaylistItem keeps it)
                let addedCount = 0;
                const attemptedTerms = validSongs.map(({ song }) => song.searchTerm);
                const skippedTerms = [];
                let skippedCount = songList.length - validSongs.length;
                for (const { song, index, videoData, error } of results) {
                    if (error) {
                        console.error(`Error searching for "${song.searchTerm}":`, error);
                        skippedCount++;
                        skippedTerms.push(song.searchTerm);
                        this.addMessage('claude', `Song ${index + 1} not added`, `${song.searchTerm}: ${error.message}`);
                        continue;
                    }
                    if (!videoData) {
                        skippedCount++;
                        skippedTerms.push(song.searchTerm);
                        this.addMessage('claude', `Song ${index + 1} not added`, `No YouTube results for: ${song.searchTerm}`);
                        continue;
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
                        continue;
                    }
                    if (alternateVideos.length > 0) {
                        this.youtubeAlternateResults.set(playlistItem.id, alternateVideos);
                    }
                    if (window.PlayerHistoryDB) {
                        window.PlayerHistoryDB.recordSong(playlistItem, 'search');
                    }
                    this.appendPlaylistItem(playlistItem);
                    addedCount++;
                }

                this.updatePlaylistLabel();
                this.addMessage('claude', 'Complete', `Added ${addedCount} of ${songList.length} songs`);

                if (addedCount === 0 && songList.length > 0) {
                    this.speakText('Could not find any of those songs on YouTube');
                }
                this.persistPlaylist();
                return { addedCount, skippedCount, requestedCount: songList.length, attemptedTerms, skippedTerms };
            },

            async searchSongsWithConcurrency(validSongs, concurrency = YOUTUBE_SEARCH_CONCURRENCY) {
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
                            const videoData = await this.searchYouTube(song.searchTerm);
                            results[queueIndex] = { song, index, videoData, error: null };
                        } catch (error) {
                            results[queueIndex] = { song, index, videoData: null, error };
                        }
                        completed++;
                        this.updateStatus(`Searched ${completed}/${validSongs.length} YouTube term${validSongs.length === 1 ? '' : 's'}...`);
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

            async searchYouTube(query) {
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

                const videos = results
                    .filter(result => result.videoId)
                    .map(result => this.formatYouTubeResult(result));
                if (videos.length > 0) {
                    const [firstVideo, ...alternateVideos] = videos;
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
                    durationSeconds: Number(video.duration) || 0
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

            // Every datum has a fixed slot in the row:
            //   actions column: favorite star above the lyrics chip
            //   line 1: song name (left) ... duration (right)
            //   line 2: artist - year - album
            //   line 3: comment (own full-width line, only when present)
            //   remove column: the x, always top-right
            addPlaylistItemToDOM(item) {
                const playlistBody = document.getElementById('playlistBody');
                const row = document.createElement('div');
                row.className = 'playlist-row';
                row.dataset.itemId = String(item.id);
                row.dataset.videoId = item.videoId;

                const isFav = this.isFavorite(item.videoId);
                const lyricsReady = item.lyricsStatus === 'ready' && !!item.lyricsData;
                const lyricsLoading = item.lyricsStatus === 'loading';
                const lyricsLabel = lyricsLoading ? '...' : (lyricsReady ? 'L' : 'Get');

                row.innerHTML = `
                    <div class="playlist-row-actions">
                        <button class="favorite-btn ${isFav ? 'favorited' : ''}" data-video-id="${item.videoId}" aria-label="Toggle favorite">${isFav ? '\u2605' : '\u2606'}</button>
                        <button class="lyrics-row-btn ${lyricsReady ? 'ready' : ''}" data-item-id="${item.id}" aria-label="${lyricsReady ? 'Show cached lyrics' : 'Get lyrics'}">${lyricsLabel}</button>
                    </div>
                    <div class="playlist-row-main">
                        <div class="playlist-row-title-line">
                            <span class="playlist-song-name">${this.escapeHtml(item.name)}</span>
                            <span class="playlist-song-duration">${item.duration || '--:--'}</span>
                        </div>
                        <div class="playlist-row-meta-line">
                            <span class="playlist-song-artist">${this.escapeHtml(item.artist)}</span>
                            ${item.year ? `<span class="playlist-song-year">${this.escapeHtml(item.year)}</span>` : ''}
                            ${item.album ? `<span class="playlist-song-album">${this.escapeHtml(item.album)}</span>` : ''}
                        </div>
                        ${item.comment ? `<div class="playlist-song-comment">${this.escapeHtml(item.comment)}</div>` : ''}
                    </div>
                    <button class="playlist-remove-btn" aria-label="Remove from playlist">\u00d7</button>
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

                // Tap/click to play (on the row, not its buttons)
                row.addEventListener('click', (e) => {
                    const target = /** @type {HTMLElement} */ (e.target);
                    if (target.closest('button')) return;
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
                                        this.reportPlayerLoadFailure(activeItem, { error: detail, errorCode: event.data });
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

            reportPlayerLoadFailure(item, failure) {
                const description = this.describePlaylistItem(item);
                const { detail } = this.playerLoadFailureInfo(failure);
                if (this.tryNextVideoResult(item, failure)) {
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

                        // Log the play action
                        const songTitle = item.name || item.title || 'Unknown';
                        this.addMessage('user', 'Now Playing', `${songTitle}`);
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
                    this.reportPlayerLoadFailure(item, ready.error);
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
                this.updateBigLyricsAvailability();
            },

            updateMediaSessionForItem(item) {
                if (!item) return;

                // The now-playing title belongs to the lyric relay: the
                // driver sings along from it, so song/artist names are
                // never written here. Clear the previous song's lyric
                // until this song's lines start arriving. Reporting
                // 'playing' secures session ownership (the core's silent
                // loop) so the car reads THIS page, not youtube.com.
                MediaSessionCore.clearNowPlayingTitle();
                MediaSessionCore.setPlaybackState('playing');
                if (!this.mediaActionHandlersSet) {
                    this.mediaActionHandlersSet = true;
                    MediaSessionCore.setActionHandlers([
                        ['play', () => this.playPlaylist()],
                        ['pause', () => this.pausePlayback()],
                        ['previoustrack', () => this.playPrevious()],
                        ['nexttrack', () => this.playNext()]
                    ]);
                }
            },

            stopPlayback() {
                if (this.currentPlayingId) {
                    const player = this.playback.player;
                    if (player && typeof player.stopVideo === 'function') {
                        try {
                            this.playback.suppressAutoAdvanceFor(1500);
                            player.stopVideo();
                            this.playback.markStopped();
                            this.relayLyricToNowPlaying(-1);
                            MediaSessionCore.setPlaybackState('none');
                            this.updatePlayPauseButton();
                            this.stopProgressUpdates();
                            this.updateProgressBar(0, 1);
                        } catch (e) {
                            console.error('Error stopping video:', e);
                        }
                    }
                }
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
                        this.playback.markPaused();
                        this.relayLyricToNowPlaying(-1);
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

            fastForward() {
                if (this.currentPlayingId) {
                    const player = this.playback.player;
                    if (player && typeof player.getCurrentTime === 'function' && typeof player.seekTo === 'function') {
                        try {
                            const currentTime = player.getCurrentTime();
                            player.seekTo(currentTime + SEEK_JUMP_SECONDS, true);
                            this.resyncProgressClock();
                        } catch (e) {
                            console.error('Error fast forwarding:', e);
                        }
                    }
                }
            },

            rewind() {
                if (this.currentPlayingId) {
                    const player = this.playback.player;
                    if (player && typeof player.getCurrentTime === 'function' && typeof player.seekTo === 'function') {
                        try {
                            const currentTime = player.getCurrentTime();
                            player.seekTo(Math.max(0, currentTime - SEEK_JUMP_SECONDS), true);
                            this.resyncProgressClock();
                        } catch (e) {
                            console.error('Error rewinding:', e);
                        }
                    }
                }
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
                // Drop queued lookups for the discarded rows; detached
                // backfill items are not playlist-bound and keep going.
                this.lyricsFetchQueue = this.lyricsFetchQueue.filter(item => item.sourceKind === 'backfill');
                this.playback.reset();
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

            setupProgressBar() {
                const progressTrack = document.getElementById('progressBarTrack');
                if (!progressTrack) return;

                /** @param {MouseEvent | TouchEvent} e */
                const handleSeek = (e) => {
                    const rect = progressTrack.getBoundingClientRect();
                    const clientX = 'clientX' in e ? e.clientX : (e.touches && e.touches[0]?.clientX) || 0;
                    const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                    this.seekToPercentage(percentage);
                };

                // Mouse events
                progressTrack.addEventListener('mousedown', (e) => {
                    this.isDraggingProgress = true;
                    progressTrack.classList.add('dragging');
                    handleSeek(e);
                });

                document.addEventListener('mousemove', (e) => {
                    if (this.isDraggingProgress) {
                        handleSeek(e);
                    }
                });

                document.addEventListener('mouseup', () => {
                    if (this.isDraggingProgress) {
                        this.isDraggingProgress = false;
                        const progressTrack = document.getElementById('progressBarTrack');
                        if (progressTrack) progressTrack.classList.remove('dragging');
                    }
                });

                // Touch events
                progressTrack.addEventListener('touchstart', (e) => {
                    this.isDraggingProgress = true;
                    progressTrack.classList.add('dragging');
                    handleSeek(e);
                });

                progressTrack.addEventListener('touchmove', (e) => {
                    if (this.isDraggingProgress) {
                        e.preventDefault();
                        handleSeek(e);
                    }
                });

                progressTrack.addEventListener('touchend', () => {
                    this.isDraggingProgress = false;
                    progressTrack.classList.remove('dragging');
                });

                // Click to seek
                progressTrack.addEventListener('click', handleSeek);
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
                        this.updateProgressBar(currentTime, duration);
                        return currentTime;
                    }
                }
                return null;
            },

            updateProgressBar(currentTime, duration) {
                const fill = document.getElementById('progressBarFill');
                const handle = document.getElementById('progressBarHandle');
                const currentTimeEl = document.getElementById('currentTime');
                const totalTimeEl = document.getElementById('totalTime');

                if (fill && handle && currentTimeEl && totalTimeEl) {
                    if (!this.progressDiff) this.progressDiff = new ValueDiff();
                    const percentage = `${(currentTime / duration) * 100}%`;
                    this.progressDiff.style('fillWidth', fill, 'width', percentage);
                    this.progressDiff.style('handleLeft', handle, 'left', percentage);
                    this.progressDiff.text('currentTime', currentTimeEl, this.formatTime(currentTime));
                    this.progressDiff.text('totalTime', totalTimeEl, this.formatTime(duration));
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
