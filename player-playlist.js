// @ts-nocheck
// Playlist DOM, YouTube search/playback, and transport controls.

const PROGRESS_UPDATE_INTERVAL_MS = 100;
const SEEK_JUMP_SECONDS = 10;
const DOM_SETTLE_DELAY_MS = 50;
const YOUTUBE_API_TIMEOUT_MS = 10000;
const YOUTUBE_API_POLL_INTERVAL_MS = 100;
const PLAYER_READY_TIMEOUT_MS = 8000;

const PlayerPlaylist = (function () {
    'use strict';

    /** @param {VoiceMusicController} controller */
    function install(controller) {
        Object.assign(controller, {
            loadFavoritesToPlaylist() {
                const favoritesList = Object.values(this.favorites);
                if (favoritesList.length === 0) {
                    this.updateStatus('No favorites saved');
                    return;
                }

                document.getElementById('playlistContainer').style.display = 'block';
                document.getElementById('centralPlayer').style.display = 'block';
                this.showTransportBar();

                let addedCount = 0;
                for (const favData of favoritesList) {
                    // Minimal fallback: try to get at least artist and name
                    const artistName = favData.artist || favData.channelTitle || 'Unknown';
                    const songName = favData.name || favData.title || 'Unknown';

                    // Skip if we don't have a videoId
                    if (!favData.videoId) continue;
                    if (this.playlist.some(item => item.videoId === favData.videoId)) continue;

                    /** @type {PlaylistItem} */
                    const playlistItem = {
                        videoId: favData.videoId,
                        name: songName,
                        artist: artistName,
                        year: favData.year || '',
                        album: favData.album || '',
                        title: favData.title || songName,
                        channelTitle: favData.channelTitle || artistName,
                        duration: favData.duration || '--:--',
                        durationSeconds: favData.durationSeconds || this.parseDurationToSeconds(favData.duration || ''),
                        comment: favData.comment || '',
                        searchTerm: favData.searchTerm || '',
                        id: Date.now() + Math.random(),
                        lyricsStatus: 'idle',
                        lyricsData: null
                    };
                    this.hydrateItemLyricsFromCache(playlistItem);

                    this.playlist.unshift(playlistItem);
                    if (this.currentPlaylistIndex >= 0) {
                        this.currentPlaylistIndex++;
                    }
                    this.addPlaylistItemToDOM(playlistItem);
                    addedCount++;

                    // Eagerly fetch lyrics for favorites too
                    if (playlistItem.lyricsStatus === 'idle') {
                        void this.ensureLyricsForItem(playlistItem);
                    }
                }

                this.updatePlaylistLabel();
                this.updateStatus(`Loaded ${addedCount} favorite${addedCount !== 1 ? 's' : ''}`);
                this.addMessage('user', 'Favorites', `Loaded ${addedCount} favorite songs`);
                this.persistPlaylist();
            },

            shufflePlaylist() {
                if (this.playlist.length === 0) return;
                const currentPlayingId = this.currentPlayingId;

                // Fisher-Yates shuffle
                for (let i = this.playlist.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
                }

                // Re-render playlist table body
                const playlistBody = document.getElementById('playlistBody');
                playlistBody.innerHTML = '';

                // Remove old player divs
                const container = document.getElementById('playlistContainer');
                const playerDivs = container.querySelectorAll('.youtube-player');
                playerDivs.forEach(div => div.remove());

                // Re-add items
                for (let i = this.playlist.length - 1; i >= 0; i--) {
                    this.addPlaylistItemToDOM(this.playlist[i]);
                }

                // Rebind current index to the currently playing item after shuffle
                if (currentPlayingId != null) {
                    this.currentPlaylistIndex = this.playlist.findIndex(item => item.id === currentPlayingId);
                    const currentItem = this.playlist[this.currentPlaylistIndex];
                    if (currentItem) {
                        this.updateCentralPlayer(currentItem);
                        const row = document.querySelector(`[data-item-id="${currentItem.id}"]`);
                        if (row) row.classList.add('playing');
                    }
                }
                this.persistPlaylist();
            },

            async searchAndAddToPlaylist(songList) {
                const playlistContainer = document.getElementById('playlistContainer');

                playlistContainer.style.display = 'block';
                this.showTransportBar();

                if (songList.length > 0) {
                    document.getElementById('centralPlayer').style.display = 'block';
                }

                this.addMessage('claude', 'Processing', `Searching ${songList.length} songs in parallel...`);

                const validSongs = songList
                    .map((song, i) => ({ song, index: i }))
                    .filter(({ song, index }) => {
                        if (!song.searchTerm) {
                            this.addMessage('claude', 'Skipped search item', `Song ${index + 1} had no search term: ${JSON.stringify(song).substring(0, 100)}`);
                            return false;
                        }
                        return true;
                    });

                // Fire all YouTube searches in parallel
                const searchPromises = validSongs.map(({ song, index }) => {
                    this.addMessage('claude', `Song ${index + 1}`, `Searching: ${song.searchTerm}`);
                    return this.searchYouTube(song.searchTerm)
                        .then(videoData => ({ song, index, videoData, error: null }))
                        .catch(error => ({ song, index, videoData: null, error }));
                });

                const results = await Promise.all(searchPromises);

                // Add to playlist in original order (reversed so unshift preserves order)
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

                    const playlistItem = {
                        name: song.name ? this.decodeHtml(song.name) : '',
                        artist: song.artist ? this.decodeHtml(song.artist) : '',
                        year: song.year || '',
                        album: song.album ? this.decodeHtml(song.album) : '',
                        comment: song.comment ? this.decodeHtml(song.comment) : '',
                        searchTerm: song.searchTerm,
                        ...videoData,
                        id: Date.now() + Math.random(),
                        lyricsStatus: 'idle',
                        lyricsData: null
                    };
                    this.hydrateItemLyricsFromCache(playlistItem);
                    this.playlist.unshift(playlistItem);
                    if (this.currentPlaylistIndex >= 0) {
                        this.currentPlaylistIndex++;
                    }
                    this.addPlaylistItemToDOM(playlistItem);
                    addedCount++;

                    if (playlistItem.lyricsStatus === 'idle') {
                        void this.ensureLyricsForItem(playlistItem);
                    }
                }

                this.updatePlaylistLabel();
                this.addMessage('claude', 'Complete', `Added ${addedCount} of ${songList.length} songs`);

                if (addedCount === 0 && songList.length > 0) {
                    this.speakText('Could not find any of those songs on YouTube');
                }
                this.persistPlaylist();
                return { addedCount, skippedCount, requestedCount: songList.length, attemptedTerms, skippedTerms };
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

                const response = await fetch(proxyUrl);

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const errorMsg = errorData.error || `HTTP ${response.status}`;
                    this.addMessage('error', 'Search Failed', errorMsg);
                    throw new Error(`Search failed: ${errorMsg}`);
                }

                const data = await response.json();

                // Check for error response
                if (data.error) {
                    this.addMessage('error', 'Search Error', data.error);
                    throw new Error(data.error);
                }

                // Get results from our standardized proxy response
                const results = data.results || [];

                const videos = results
                    .filter(result => result.videoId)
                    .map(result => this.formatYouTubeResult(result));
                if (videos.length > 0) {
                    const [firstVideo, ...alternateVideos] = videos;
                    this.addMessage('claude', 'Found', `${firstVideo.title} (via ${data.source || 'proxy'})`);
                    return {
                        ...firstVideo,
                        alternateVideos: alternateVideos.slice(0, 5)
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

            addPlaylistItemToDOM(item) {
                const playlistBody = document.getElementById('playlistBody');
                const row = document.createElement('tr');
                row.dataset.itemId = String(item.id);
                row.dataset.videoId = item.videoId;

                const isFav = this.isFavorite(item.videoId);
                const artistName = item.artist || item.channelTitle || 'Unknown';
                const songName = item.name || item.title || 'Unknown';
                const yearText = item.year || '';
                const albumText = item.album || '';
                const lyricsReady = item.lyricsStatus === 'ready' && !!item.lyricsData;
                const lyricsLoading = item.lyricsStatus === 'loading';
                const lyricsLabel = lyricsLoading ? '...' : (lyricsReady ? 'L' : 'Get');

                row.innerHTML = `
                    <td>
                        <div class="playlist-actions-cell">
                            <button class="favorite-btn ${isFav ? 'favorited' : ''}" data-video-id="${item.videoId}" aria-label="Toggle favorite">${isFav ? '\u2605' : '\u2606'}</button>
                            <button class="lyrics-row-btn ${lyricsReady ? 'ready' : ''}" data-item-id="${item.id}" aria-label="${lyricsReady ? 'Show cached lyrics' : 'Get lyrics'}">${lyricsLabel}</button>
                        </div>
                    </td>
                    <td>${this.escapeHtml(artistName)}</td>
                    <td>${this.escapeHtml(songName)}</td>
                    <td>${yearText}</td>
                    <td>${this.escapeHtml(albumText)}</td>
                    <td>${item.duration || '--:--'}</td>
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

                // Tap/click to play (on the row, not the favorite button)
                row.addEventListener('click', (e) => {
                    const target = /** @type {HTMLElement} */ (e.target);
                    if (target.closest('.favorite-btn') || target.closest('.lyrics-row-btn')) return;
                    this.playVideo(item);
                });

                // Insert newest items at the top
                playlistBody.insertBefore(row, playlistBody.firstChild);

                this.createPlaylistPlayer(item);
            },

            createPlaylistPlayer(item) {
                // Create hidden player container outside the table
                const playlistContainer = document.getElementById('playlistContainer');
                const playerDiv = document.createElement('div');
                playerDiv.id = `player-${item.id}`;
                playerDiv.className = 'youtube-player';
                playerDiv.style.display = 'none';
                playlistContainer.appendChild(playerDiv);

                // Create readiness promise before player construction
                const playerId = `player-${item.id}`;
                let readyResolve;
                const readyPromise = new Promise(resolve => { readyResolve = resolve; });
                this.playerReadyPromises.set(item.id, { promise: readyPromise, resolve: readyResolve });
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
                        const player = new YT.Player(playerId, {
                            height: '200',
                            width: '100%',
                            videoId: item.videoId,
                            playerVars: {
                                autoplay: 0,
                                controls: 1,
                                modestbranding: 1,
                                rel: 0
                            },
                            events: {
                                onReady: (event) => {
                                    console.log('Player ready for:', item.videoId);
                                    this.players.set(item.id, event.target);
                                    settleReady({ ok: true, player: event.target });
                                },
                                onStateChange: (event) => {
                                    // Auto-advance to next when video ends
                                    if (event.data === YT.PlayerState.ENDED) {
                                        if (Date.now() < this.suppressAutoAdvanceUntil) {
                                            return;
                                        }
                                        this.playNext();
                                    }
                                },
                                onError: (event) => {
                                    console.error('Player error:', event.data);
                                    const detail = this.describeYouTubePlayerError(event.data);
                                    const entry = this.playerReadyPromises.get(item.id);
                                    const reportNow = !entry || entry.settled;
                                    settleReady({ ok: false, error: detail, errorCode: event.data });
                                    if (reportNow) {
                                        this.reportPlayerLoadFailure(item, { error: detail, errorCode: event.data });
                                    }
                                }
                            }
                        });

                        // Store player immediately (methods may not be available until onReady)
                        this.players.set(item.id, player);
                    } catch (error) {
                        console.error('Error creating YouTube player:', error);
                        settleReady({ ok: false, error: error.message || String(error) });
                    }
                };

                // Wait a tick for DOM to settle, then create player
                setTimeout(() => {
                    if (typeof YT !== 'undefined' && typeof YT.Player !== 'undefined') {
                        createPlayer();
                    } else {
                        // YouTube API not ready - use two strategies for robustness:
                        // 1. Push to callback queue (if onYouTubeIframeAPIReady fires later)
                        // 2. Poll for API (handles race conditions and late script loads)
                        if (!window.youtubeApiReady) {
                            window.youtubeApiReady = [];
                        }
                        window.youtubeApiReady.push(createPlayer);

                        const checkApi = setInterval(() => {
                            // Stop polling if element was removed (e.g., playlist cleared)
                            if (!document.getElementById(playerId)) {
                                clearInterval(checkApi);
                                return;
                            }
                            if (typeof YT !== 'undefined' && typeof YT.Player !== 'undefined') {
                                clearInterval(checkApi);
                                createPlayer();
                            }
                        }, YOUTUBE_API_POLL_INTERVAL_MS);

                        // Give up after timeout
                        setTimeout(() => {
                            clearInterval(checkApi);
                            settleReady({ ok: false, error: `YouTube API did not load within ${YOUTUBE_API_TIMEOUT_MS / 1000}s` });
                        }, YOUTUBE_API_TIMEOUT_MS);
                    }
                }, DOM_SETTLE_DELAY_MS);
            },

            recreatePlaylistPlayer(item) {
                const oldPlayer = this.players.get(item.id);
                if (oldPlayer && typeof oldPlayer.destroy === 'function') {
                    try {
                        oldPlayer.destroy();
                    } catch (error) {
                        console.error('Error destroying player before retry:', error);
                    }
                }
                this.players.delete(item.id);
                this.playerReadyPromises.delete(item.id);

                const playerDiv = document.getElementById(`player-${item.id}`);
                if (playerDiv) {
                    playerDiv.remove();
                }

                this.createPlaylistPlayer(item);
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
                const row = document.querySelector(`[data-item-id="${item.id}"]`);
                if (!row) return;

                row.dataset.videoId = item.videoId;
                const favBtn = row.querySelector('.favorite-btn');
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

                const cells = row.querySelectorAll('td');
                if (cells[5]) {
                    cells[5].textContent = item.duration || '--:--';
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

                const nextVideo = item.alternateVideos && item.alternateVideos.shift();
                if (!nextVideo) {
                    return false;
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
                // Stop currently playing video
                if (this.currentPlayingId && this.currentPlayingId !== item.id) {
                    const currentPlayer = this.players.get(this.currentPlayingId);
                    if (currentPlayer && typeof currentPlayer.pauseVideo === 'function') {
                        try {
                            currentPlayer.pauseVideo();
                        } catch (e) {
                            console.error('Error pausing video:', e);
                        }
                    }
                    // Remove playing class from all rows
                    document.querySelectorAll('#playlistBody tr').forEach(el => {
                        el.classList.remove('playing');
                    });
                }

                // Play new video
                const player = this.players.get(item.id);
                if (player && typeof player.playVideo === 'function') {
                    try {
                        player.playVideo();
                        this.currentPlayingId = item.id;
                        this.isPlaying = true;
                        this.isPaused = false;

                        // Update playlist index
                        this.currentPlaylistIndex = this.playlist.findIndex(song => song.id === item.id);

                        // Update central player display
                        this.updateCentralPlayer(item);

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
                    const description = this.describePlaylistItem(item);
                    this.updateStatus(`Player loading: ${this.truncateForStatus(description, 100)}`);
                    this.addMessage('claude', 'Player loading', `Waiting for player: ${description}\nVideo ID: ${item.videoId}\nSearch term: ${item.searchTerm || '(none)'}`);
                    const loadingVideoId = item.videoId;
                    const ready = await this.waitForPlayerReady(item);
                    if (ready.ok) {
                        const readyPlayer = ready.player || this.players.get(item.id);
                        if (readyPlayer) {
                            this.players.set(item.id, readyPlayer);
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

            stopPlayback() {
                if (this.currentPlayingId) {
                    const player = this.players.get(this.currentPlayingId);
                    if (player && typeof player.stopVideo === 'function') {
                        try {
                            this.suppressAutoAdvanceUntil = Date.now() + 1500;
                            player.stopVideo();
                            this.isPlaying = false;
                            this.isPaused = false;
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
                    const player = this.players.get(this.currentPlayingId);
                    if (player && typeof player.playVideo === 'function') {
                        const currentItem = this.playlist.find(item => item.id === this.currentPlayingId) || null;
                        player.playVideo();
                        this.isPlaying = true;
                        this.isPaused = false;
                        this.updatePlayPauseButton();
                        this.startProgressUpdates();
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
                    const player = this.players.get(this.currentPlayingId);
                    if (player && typeof player.pauseVideo === 'function') {
                        player.pauseVideo();
                        this.isPlaying = false;
                        this.isPaused = true;
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
                    const player = this.players.get(this.currentPlayingId);
                    if (player && typeof player.getCurrentTime === 'function' && typeof player.seekTo === 'function') {
                        try {
                            const currentTime = player.getCurrentTime();
                            player.seekTo(currentTime + SEEK_JUMP_SECONDS, true);
                        } catch (e) {
                            console.error('Error fast forwarding:', e);
                        }
                    }
                }
            },

            rewind() {
                if (this.currentPlayingId) {
                    const player = this.players.get(this.currentPlayingId);
                    if (player && typeof player.getCurrentTime === 'function' && typeof player.seekTo === 'function') {
                        try {
                            const currentTime = player.getCurrentTime();
                            player.seekTo(Math.max(0, currentTime - SEEK_JUMP_SECONDS), true);
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
                    const player = this.players.get(this.currentPlayingId);
                    if (player && typeof player.seekTo === 'function') {
                        player.seekTo(0, true);
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

            clearPlaylist() {
                // Stop any playing video
                if (this.currentPlayingId) {
                    const player = this.players.get(this.currentPlayingId);
                    if (player && typeof player.stopVideo === 'function') {
                        try {
                            this.suppressAutoAdvanceUntil = Date.now() + 1500;
                            player.stopVideo();
                        } catch (e) {
                            // Ignore
                        }
                    }
                }

                this.stopProgressUpdates();
                this.playlist = [];
                this.currentPlaylistIndex = -1;
                this.isPlaying = false;
                this.isPaused = false;
                document.getElementById('playlistBody').innerHTML = '';

                // Remove any player divs that were appended to the container
                const container = document.getElementById('playlistContainer');
                const playerDivs = container.querySelectorAll('.youtube-player');
                playerDivs.forEach(div => div.remove());

                document.getElementById('playlistContainer').style.display = 'none';
                document.getElementById('centralPlayer').style.display = 'none';
                this.hideTransportBar();
                this.players.forEach(player => {
                    try {
                        player.destroy();
                    } catch (e) {
                        // Ignore errors
                    }
                });
                this.players.clear();
                this.playerReadyPromises.clear();
                this.currentPlayingId = null;
                this.updatePlayPauseButton();
                this.updateCentralPlayer(null);
                this.updatePlaylistLabel();
                this.currentLyricsItemId = null;
                this.currentLyricsLineIndex = -1;
                this.setLyricsPanelVisible(false);
                this.lyricsPanelDismissed = false;
                this.closeLyricsOverlay();
                this.renderLyricsStateForItem(null);

                // Also hide transcript/response containers
                this.hideClaudeResponse();
                this.hidePrompt();
                const transcriptContainer = document.getElementById('transcriptContainer');
                if (transcriptContainer) {
                    transcriptContainer.style.display = 'none';
                }
                this.persistPlaylist();
            },

            persistPlaylist() {
                PlayerStorage.savePlaylist(this.playlist, this.currentPlaylistIndex);
            },

            restoreSavedPlaylist() {
                const saved = PlayerStorage.loadPlaylist();
                if (!saved.items.length) {
                    return;
                }

                this.playlist = saved.items.map(item => ({
                    ...item,
                    lyricsStatus: item.lyricsStatus || 'idle',
                    lyricsData: item.lyricsData || null
                }));
                this.currentPlaylistIndex = saved.currentPlaylistIndex;

                document.getElementById('playlistContainer').style.display = 'block';
                document.getElementById('centralPlayer').style.display = 'block';
                this.showTransportBar();

                for (let i = this.playlist.length - 1; i >= 0; i--) {
                    const item = this.playlist[i];
                    this.hydrateItemLyricsFromCache(item);
                    this.addPlaylistItemToDOM(item);
                }
                this.updatePlaylistLabel();

                if (this.currentPlaylistIndex >= 0 && this.currentPlaylistIndex < this.playlist.length) {
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

                const player = this.players.get(this.currentPlayingId);
                if (player && typeof player.getDuration === 'function' && typeof player.seekTo === 'function') {
                    const duration = player.getDuration();
                    if (duration && duration > 0) {
                        const seekTime = duration * percentage;
                        player.seekTo(seekTime, true);
                        this.updateProgressBar(seekTime, duration);
                    }
                }
            },

            startProgressUpdates() {
                this.stopProgressUpdates();
                this.progressUpdateInterval = setInterval(() => {
                    this.updateCurrentProgress();
                }, PROGRESS_UPDATE_INTERVAL_MS);
            },

            stopProgressUpdates() {
                if (this.progressUpdateInterval) {
                    clearInterval(this.progressUpdateInterval);
                    this.progressUpdateInterval = null;
                }
            },

            updateCurrentProgress() {
                if (!this.currentPlayingId || this.isDraggingProgress) return;

                const player = this.players.get(this.currentPlayingId);
                if (player && typeof player.getCurrentTime === 'function' && typeof player.getDuration === 'function') {
                    const currentTime = player.getCurrentTime();
                    const duration = player.getDuration();
                    if (duration && duration > 0) {
                        this.updateProgressBar(currentTime, duration);
                    }
                }
            },

            updateProgressBar(currentTime, duration) {
                const fill = document.getElementById('progressBarFill');
                const handle = document.getElementById('progressBarHandle');
                const currentTimeEl = document.getElementById('currentTime');
                const totalTimeEl = document.getElementById('totalTime');

                if (fill && handle && currentTimeEl && totalTimeEl) {
                    const percentage = (currentTime / duration) * 100;
                    fill.style.width = `${percentage}%`;
                    handle.style.left = `${percentage}%`;
                    currentTimeEl.textContent = this.formatTime(currentTime);
                    totalTimeEl.textContent = this.formatTime(duration);
                }

                this.updateSyncedLyricsPosition(currentTime);
            },

            formatTime(seconds) {
                if (!seconds || isNaN(seconds)) return '0:00';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            },

            setupYouTubeAPI() {
                if (typeof YT === 'undefined') {
                    window.onYouTubeIframeAPIReady = () => {
                        this.playerReady();
                    };
                } else {
                    this.playerReady();
                }
            },

            playerReady() {
                console.log('YouTube API ready');

                // Run any pending player creation functions
                if (window.youtubeApiReady && Array.isArray(window.youtubeApiReady)) {
                    window.youtubeApiReady.forEach(fn => {
                        if (typeof fn === 'function') {
                            fn();
                        }
                    });
                    window.youtubeApiReady = [];
                }
            },

            loadDemoSongIfRequested() {
                const params = new URLSearchParams(window.location.search);
                if (params.get('demoLyrics') !== '1' || this.playlist.length > 0) {
                    return;
                }

                /** @type {PlaylistItem} */
                const demoItem = {
                    id: Date.now() + Math.random(),
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
                    searchTerm: 'Rick Astley Never Gonna Give You Up',
                    lyricsStatus: 'idle',
                    lyricsData: null
                };

                this.hydrateItemLyricsFromCache(demoItem);
                this.playlist.unshift(demoItem);
                this.currentPlaylistIndex = 0;
                document.getElementById('playlistContainer').style.display = 'block';
                document.getElementById('centralPlayer').style.display = 'block';
                this.showTransportBar();
                this.addPlaylistItemToDOM(demoItem);
                this.currentLyricsItemId = demoItem.id;
                this.updateCentralPlayer(demoItem);
                this.updatePlaylistLabel();
                this.setLyricsPanelVisible(true);
                this.renderLyricsStateForItem(demoItem);
                void this.ensureLyricsForItem(demoItem);
                this.updateStatus('Demo lyrics song loaded');
            },

            parseDurationToSeconds(value) {
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
        });
    }

    return { install };
})();

window.PlayerPlaylist = PlayerPlaylist;
