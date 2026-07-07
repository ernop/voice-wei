// @ts-check
// Music history/cache panel workflows.

const PlayerHistoryUI = (function () {
    'use strict';

    /** @param {VoiceMusicController} controller */
    function install(controller) {
        Object.assign(controller, /** @type {ThisType<VoiceMusicController>} */ ({
            setupMusicHistoryUI() {
                const toggleBtn = document.getElementById('musicHistoryToggleBtn');
                const reloadBtn = document.getElementById('musicHistoryReloadBtn');
                const loadLookupsBtn = document.getElementById('historyLoadSelectedLookupsBtn');
                const loadSongsBtn = document.getElementById('historyLoadSelectedSongsBtn');

                toggleBtn?.addEventListener('click', () => this.toggleMusicHistoryPanel());
                reloadBtn?.addEventListener('click', () => this.refreshMusicHistoryPanel());
                loadLookupsBtn?.addEventListener('click', () => this.loadSelectedHistoryLookups());
                loadSongsBtn?.addEventListener('click', () => this.loadSelectedKnownSongs());
            },

            setMusicHistoryPanelVisible(visible) {
                const panel = document.getElementById('musicHistoryPanel');
                if (!panel) return;
                panel.style.display = visible ? 'block' : 'none';
                if (visible) {
                    void this.refreshMusicHistoryPanel();
                }
            },

            toggleMusicHistoryPanel() {
                const panel = document.getElementById('musicHistoryPanel');
                if (!panel) return;
                this.setMusicHistoryPanelVisible(panel.style.display === 'none');
            },

            async refreshMusicHistoryPanel() {
                if (!window.PlayerHistoryDB) return;
                const [lookups, songs, searches] = await Promise.all([
                    window.PlayerHistoryDB.listLookups(),
                    window.PlayerHistoryDB.listSongs(),
                    window.PlayerHistoryDB.listYouTubeSearches()
                ]);
                this.musicHistoryLookups = lookups;
                this.musicHistorySongs = songs;
                this.musicHistorySearches = searches;
                this.renderLookupHistory(lookups);
                this.renderKnownSongsHistory(songs);
                this.renderSearchCacheHistory(searches);
            },

            renderLookupHistory(lookups) {
                const host = document.getElementById('musicLookupHistoryList');
                if (!host) return;
                host.innerHTML = '';
                if (!lookups.length) {
                    host.innerHTML = '<div class="music-history-empty">No lookup history yet.</div>';
                    return;
                }
                lookups.forEach(record => {
                    const item = document.createElement('div');
                    item.className = 'music-history-item';
                    item.innerHTML = `
                        <input type="checkbox" data-history-lookup-id="${record.id}">
                        <div>
                            <div class="music-history-item-title">${this.escapeHtml(this.truncateForStatus(record.requestText || '(no request)', 90))}</div>
                            <div class="music-history-item-meta">${record.songCount || 0} extracted - ${this.escapeHtml(record.provider || 'unknown')} - ${this.escapeHtml(record.createdAt || '')}</div>
                            <div class="music-history-item-actions">
                                <button class="panel-action-btn" type="button" data-load-lookup-id="${record.id}">Load</button>
                                <button class="panel-action-btn" type="button" data-rerun-lookup-id="${record.id}">Run Again</button>
                            </div>
                        </div>`;
                    host.appendChild(item);
                });
                host.querySelectorAll('[data-load-lookup-id]').forEach(btn => {
                    btn.addEventListener('click', event => this.loadHistoryLookupById(Number(/** @type {HTMLElement} */ (event.currentTarget).dataset.loadLookupId)));
                });
                host.querySelectorAll('[data-rerun-lookup-id]').forEach(btn => {
                    btn.addEventListener('click', event => this.rerunHistoryLookupById(Number(/** @type {HTMLElement} */ (event.currentTarget).dataset.rerunLookupId)));
                });
            },

            renderKnownSongsHistory(songs) {
                const host = document.getElementById('musicKnownSongsList');
                if (!host) return;
                host.innerHTML = '';
                if (!songs.length) {
                    host.innerHTML = '<div class="music-history-empty">No known songs recorded yet.</div>';
                    return;
                }
                songs.forEach(record => {
                    const title = record.name || record.title || record.searchTerm || record.videoId;
                    const artist = record.artist || record.channelTitle || '';
                    const item = document.createElement('div');
                    item.className = 'music-history-item';
                    item.innerHTML = `
                        <input type="checkbox" data-history-song-id="${this.escapeHtml(record.videoId)}">
                        <div>
                            <div class="music-history-item-title">${this.escapeHtml(title)}</div>
                            <div class="music-history-item-meta">${this.escapeHtml(artist)} - ${this.escapeHtml(record.sourceKind || 'known')} - ${this.escapeHtml(record.lastSeenAt || '')}</div>
                            <div class="music-history-item-actions">
                                <button class="panel-action-btn" type="button" data-load-song-id="${this.escapeHtml(record.videoId)}">Load</button>
                            </div>
                        </div>`;
                    host.appendChild(item);
                });
                host.querySelectorAll('[data-load-song-id]').forEach(btn => {
                    btn.addEventListener('click', event => this.loadKnownSongByVideoId(/** @type {HTMLElement} */ (event.currentTarget).dataset.loadSongId || ''));
                });
            },

            renderSearchCacheHistory(searches) {
                const host = document.getElementById('musicSearchCacheList');
                if (!host) return;
                host.innerHTML = '';
                if (!searches.length) {
                    host.innerHTML = '<div class="music-history-empty">No YouTube search cache yet.</div>';
                    return;
                }
                searches.forEach(record => {
                    const item = document.createElement('div');
                    item.className = 'music-history-item';
                    item.innerHTML = `
                        <input type="checkbox" disabled>
                        <div>
                            <div class="music-history-item-title">${this.escapeHtml(record.query || record.queryKey)}</div>
                            <div class="music-history-item-meta">${record.resultCount || 0} results - ${this.escapeHtml(record.source || 'cache')} - ${this.escapeHtml(record.updatedAt || '')}</div>
                            <div class="music-history-item-actions">
                                <button class="panel-action-btn" type="button" data-use-cache-query="${this.escapeHtml(record.query || '')}">Use First</button>
                                <button class="panel-action-btn" type="button" data-refresh-cache-query="${this.escapeHtml(record.query || '')}">Refresh</button>
                            </div>
                        </div>`;
                    host.appendChild(item);
                });
                host.querySelectorAll('[data-use-cache-query]').forEach(btn => {
                    btn.addEventListener('click', event => this.loadCachedSearchFirstResult(/** @type {HTMLElement} */ (event.currentTarget).dataset.useCacheQuery || ''));
                });
                host.querySelectorAll('[data-refresh-cache-query]').forEach(btn => {
                    btn.addEventListener('click', event => this.refreshCachedSearchQuery(/** @type {HTMLElement} */ (event.currentTarget).dataset.refreshCacheQuery || ''));
                });
            },

            selectedLookupIds() {
                return Array.from(document.querySelectorAll('[data-history-lookup-id]:checked'))
                    .map(input => Number(/** @type {HTMLInputElement} */ (input).dataset.historyLookupId))
                    .filter(Number.isFinite);
            },

            selectedSongIds() {
                return Array.from(document.querySelectorAll('[data-history-song-id]:checked'))
                    .map(input => /** @type {HTMLInputElement} */ (input).dataset.historySongId || '')
                    .filter(Boolean);
            },

            async loadSelectedHistoryLookups() {
                const ids = this.selectedLookupIds();
                await this.loadHistoryLookups(ids);
            },

            async loadHistoryLookupById(id) {
                await this.loadHistoryLookups([id]);
            },

            async loadHistoryLookups(ids) {
                const records = (this.musicHistoryLookups || []).filter(record => ids.includes(record.id));
                const songList = records.flatMap(record => Array.isArray(record.songList) ? record.songList : []);
                if (!songList.length) {
                    this.updateStatus('No songs in selected lookup history');
                    return;
                }
                this.addMessage('user', 'History', `Loading ${songList.length} extracted search item(s) from ${records.length} lookup(s)`);
                await this.searchAndAddToPlaylist(songList);
                await this.refreshMusicHistoryPanel();
            },

            async rerunHistoryLookupById(id) {
                const record = (this.musicHistoryLookups || []).find(item => item.id === id);
                if (!record?.requestText) return;
                this.addMessage('user', 'History override', `Running lookup again:\n${record.requestText}`);
                await this.processMusicSearch(record.requestText);
                await this.refreshMusicHistoryPanel();
            },

            async loadSelectedKnownSongs() {
                const ids = this.selectedSongIds();
                await this.loadKnownSongs(ids);
            },

            async loadKnownSongByVideoId(videoId) {
                await this.loadKnownSongs([videoId]);
            },

            async loadKnownSongs(videoIds) {
                const songs = (this.musicHistorySongs || []).filter(song => videoIds.includes(song.videoId));
                if (!songs.length) {
                    this.updateStatus('No known songs selected');
                    return;
                }
                this.addKnownSongsToPlaylist(songs);
                await this.refreshMusicHistoryPanel();
            },

            addKnownSongsToPlaylist(songs) {
                this.showPlaylistSurfaces();
                for (const song of songs) {
                    if (this.playlist.some(item => item.videoId === song.videoId)) continue;
                    const item = PlayerSongs.createPlaylistItem(song, {
                        sourceKind: 'history',
                        sourceLabel: 'Known songs'
                    });
                    if (!item) continue;
                    this.appendPlaylistItem(item);
                }
                this.updatePlaylistLabel();
                this.persistPlaylist();
                this.updateStatus(`Loaded ${songs.length} known song${songs.length === 1 ? '' : 's'}`);
            },

            async loadCachedSearchFirstResult(query) {
                if (!window.PlayerHistoryDB || !query) return;
                const cached = await window.PlayerHistoryDB.getYouTubeSearch(query);
                const first = cached?.results?.[0];
                if (!first) {
                    this.updateStatus(`No cached result for: ${query}`);
                    return;
                }
                const video = this.formatYouTubeResult(first);
                this.addKnownSongsToPlaylist([{
                    ...video,
                    name: video.title,
                    artist: video.channelTitle,
                    year: '',
                    album: '',
                    comment: 'Loaded from YouTube search cache',
                    searchTerm: query
                }]);
            },

            async refreshCachedSearchQuery(query) {
                if (!query) return;
                const proxyUrl = `proxy.php?q=${encodeURIComponent(query)}`;
                this.updateStatus(`Refreshing cache for: ${this.truncateForStatus(query, 80)}`);
                const response = await fetch(proxyUrl);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                }
                const data = await response.json();
                const results = data.results || [];
                if (window.PlayerHistoryDB) {
                    window.PlayerHistoryDB.recordYouTubeSearch(query, results, {
                        source: data.source || '',
                        instance: data.instance || '',
                        refreshedByUser: true
                    });
                }
                this.addMessage('claude', 'Search Cache Refresh', `${query}: ${results.length} fresh result(s)`);
                await new Promise(resolve => setTimeout(resolve, 120));
                await this.refreshMusicHistoryPanel();
            }
        }));
    }

    return { install };
})();

window.PlayerHistoryUI = PlayerHistoryUI;
