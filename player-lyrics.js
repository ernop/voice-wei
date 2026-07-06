// @ts-check
// Lyrics panel, overlay, LRCLIB lookup, and synced line highlighting.

const PlayerLyrics = (function () {
    'use strict';

    // Restored whenever the now-playing text stops showing a lyric line.
    const DEFAULT_DOCUMENT_TITLE = document.title;

    // The now-playing title leads the sung lyric so Bluetooth metadata
    // propagation (phone -> AVRCP -> car redraw) lands near the moment
    // the line actually starts. The on-screen highlight stays unled.
    const LYRIC_TITLE_LEAD_SECONDS = 0.75;

    /** @param {VoiceMusicController} controller */
    function install(controller) {
        Object.assign(controller, /** @type {ThisType<VoiceMusicController>} */ ({
            currentLyricsItem() {
                if (this.currentLyricsItemId == null) {
                    return null;
                }
                return this.playlist.find(item => item.id === this.currentLyricsItemId) || null;
            },

            toggleLyricsPanel() {
                const nextVisible = !this.lyricsPanelVisible;
                this.setLyricsPanelVisible(nextVisible);
                if (nextVisible) {
                    const currentItem = this.currentLyricsItem() || this.currentPlaylistItem();
                    if (currentItem) {
                        this.renderLyricsStateForItem(currentItem);
                        void this.ensureLyricsForItem(currentItem);
                    }
                }
            },

            setLyricsPanelVisible(visible) {
                this.lyricsPanelVisible = visible;
                this.lyricsPanelDismissed = !visible;
                const lyricsPanel = document.getElementById('lyricsPanel');
                if (lyricsPanel) {
                    lyricsPanel.style.display = visible ? 'block' : 'none';
                }
                this.updateLyricsButtonLabels();
            },

            openLyricsOverlay() {
                const overlay = document.getElementById('lyricsOverlay');
                if (!overlay) return;
                this.closeLyricsConfig();
                const currentItem = this.currentLyricsItem() || this.currentPlaylistItem();
                if (currentItem) {
                    this.renderLyricsStateForItem(currentItem);
                    void this.ensureLyricsForItem(currentItem);
                } else {
                    this.renderLyricsStateForItem(null);
                }
                overlay.style.display = 'block';
                overlay.setAttribute('aria-hidden', 'false');
                document.body.classList.add('lyrics-overlay-open');
                this.updateTransportPauseLabel();
                requestAnimationFrame(() => {
                    this.applyActiveLyricsLine(this.currentLyricsLineIndex, true);
                });
            },

            closeLyricsOverlay() {
                this.closeLyricsConfig();
                const overlay = document.getElementById('lyricsOverlay');
                if (!overlay) return;
                overlay.style.display = 'none';
                overlay.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('lyrics-overlay-open');
            },

            toggleLyricsConfig() {
                const config = document.getElementById('lyricsOverlayConfig');
                if (!config) return;
                const isOpen = config.style.display !== 'none';
                config.style.display = isOpen ? 'none' : 'flex';
            },

            closeLyricsConfig() {
                const config = document.getElementById('lyricsOverlayConfig');
                if (config) config.style.display = 'none';
            },

            updateLyricsButtonLabels() {
                const lyricsPanelBtn = document.getElementById('lyricsPanelBtn');
                if (lyricsPanelBtn) {
                    lyricsPanelBtn.textContent = this.lyricsPanelVisible ? 'Hide Lyrics' : 'Lyrics';
                }
            },

            updateBigLyricsAvailability() {
                const btn = document.getElementById('lyricsOverlayBtn');
                if (!btn) return;
                const currentItem = this.currentLyricsItem() || this.currentPlaylistItem();
                btn.classList.remove('lyrics-available', 'lyrics-unavailable', 'lyrics-loading');
                if (!currentItem) {
                    btn.classList.add('lyrics-unavailable');
                    btn.textContent = 'Big Lyrics';
                } else if (currentItem.lyricsStatus === 'loading') {
                    btn.classList.add('lyrics-loading');
                    btn.textContent = 'Big Lyrics ...';
                } else if (currentItem.lyricsStatus === 'ready' && currentItem.lyricsData) {
                    btn.classList.add('lyrics-available');
                    const synced = currentItem.lyricsData.syncedLines && currentItem.lyricsData.syncedLines.length > 0;
                    btn.textContent = synced ? 'Big Lyrics (synced)' : 'Big Lyrics (plain)';
                } else {
                    btn.classList.add('lyrics-unavailable');
                    btn.textContent = currentItem.lyricsStatus === 'not_found' ? 'No Lyrics' : 'Big Lyrics';
                }
            },

            adjustLyricsFontScale(delta) {
                const next = Math.max(0.72, Math.min(1.9, this.lyricsViewSettings.fontScale + delta));
                this.lyricsViewSettings.fontScale = Number(next.toFixed(2));
                this.applyLyricsViewSettings();
            },

            applyLyricsViewSettings() {
                const overlay = document.getElementById('lyricsOverlay');
                if (overlay) {
                    const fontRem = (2.2 * this.lyricsViewSettings.fontScale).toFixed(2);
                    const maxVw = this.lyricsViewSettings.widthMode === 'wide' ? '96vw' : '74vw';
                    const maxPx = this.lyricsViewSettings.widthMode === 'wide' ? '1200px' : '760px';
                    const textAlign = this.lyricsViewSettings.align === 'left' ? 'left' : 'center';
                    const lineHeight = this.lyricsViewSettings.spacing === 'tight' ? '1.05' : '1.15';
                    const backdrop = this.lyricsViewSettings.backdrop === 'blackout'
                        ? 'rgba(0, 0, 0, 0.985)'
                        : 'rgba(3, 8, 6, 0.96)';

                    overlay.style.setProperty('--lyrics-overlay-font-size', `clamp(${fontRem}rem, ${fontRem}rem + 2vw, ${(3.8 * this.lyricsViewSettings.fontScale).toFixed(2)}rem)`);
                    overlay.style.setProperty('--lyrics-overlay-max-width', `min(${maxVw}, ${maxPx})`);
                    overlay.style.setProperty('--lyrics-overlay-text-align', textAlign);
                    overlay.style.setProperty('--lyrics-overlay-line-height', lineHeight);
                    overlay.style.setProperty('--lyrics-overlay-bg', backdrop);
                }

                const widthBtn = document.getElementById('lyricsWidthToggleBtn');
                if (widthBtn) widthBtn.textContent = this.lyricsViewSettings.widthMode === 'wide' ? 'Wide' : 'Focus';
                const alignBtn = document.getElementById('lyricsAlignToggleBtn');
                if (alignBtn) alignBtn.textContent = this.lyricsViewSettings.align === 'center' ? 'Center' : 'Left';
                const spacingBtn = document.getElementById('lyricsSpacingToggleBtn');
                if (spacingBtn) spacingBtn.textContent = this.lyricsViewSettings.spacing === 'roomy' ? 'Roomy' : 'Tight';
                const backdropBtn = document.getElementById('lyricsBackdropToggleBtn');
                if (backdropBtn) backdropBtn.textContent = this.lyricsViewSettings.backdrop === 'dim' ? 'Dim' : 'Black';

                PlayerStorage.saveLyricsViewSettings(this.lyricsViewSettings);
            },

            updateLyricsStatus(item, message, isError = false) {
                const ids = ['lyricsStatus', 'lyricsOverlayStatus'];
                for (const id of ids) {
                    const el = document.getElementById(id);
                    if (!el) continue;
                    el.textContent = message;
                    el.classList.toggle('is-error', isError);
                }

                this.updateLyricsTitles(item);
            },

            updateLyricsTitles(item) {
                const lyricsSongTitleEl = document.getElementById('lyricsSongTitle');
                const lyricsOverlayTitleEl = document.getElementById('lyricsOverlayTitle');
                const songTitle = item ? (item.name || item.title || '') : '';
                const artistName = item ? (item.artist || item.channelTitle || '') : '';
                const combinedTitle = [songTitle, artistName].filter(Boolean).join(' - ');
                if (lyricsSongTitleEl) lyricsSongTitleEl.textContent = combinedTitle || 'No song selected';
                if (lyricsOverlayTitleEl) lyricsOverlayTitleEl.textContent = combinedTitle || 'No song selected';
            },

            renderLyricsStateForItem(item) {
                if (!item) {
                    this.updateLyricsStatus(null, 'Play a song to load lyrics.');
                    this.renderLyricsLines([]);
                    return;
                }

                if (item.lyricsStatus === 'loading') {
                    this.updateLyricsStatus(item, 'Finding lyrics on LRCLIB...');
                    this.renderLyricsLines([]);
                    return;
                }

                if (item.lyricsStatus === 'error') {
                    this.updateLyricsStatus(item, 'Could not load lyrics right now.', true);
                    this.renderLyricsLines([]);
                    return;
                }

                if (item.lyricsStatus === 'not_found') {
                    this.updateLyricsStatus(item, 'No lyrics found for this track.');
                    this.renderLyricsLines([]);
                    return;
                }

                if (item.lyricsStatus === 'ready' && item.lyricsData) {
                    const lyricsData = item.lyricsData;
                    const isSynced = lyricsData.syncedLines.length > 0;
                    if (lyricsData.instrumental) {
                        this.updateLyricsStatus(item, 'Track appears to be instrumental.');
                    } else if (isSynced) {
                        this.updateLyricsStatus(item, `LRCLIB match: ${lyricsData.artistName} - ${lyricsData.trackName} (synced)`);
                    } else {
                        this.updateLyricsStatus(item, `LRCLIB match: ${lyricsData.artistName} - ${lyricsData.trackName}`);
                    }
                    this.renderLyricsLines(this.getRenderableLyricsLines(lyricsData));
                    const overlay = document.getElementById('lyricsOverlay');
                    if (overlay) overlay.classList.toggle('has-synced-lyrics', isSynced);
                    return;
                }

                this.updateLyricsStatus(item, 'Play a song to load lyrics.');
                this.renderLyricsLines([]);
            },

            getRenderableLyricsLines(lyricsData) {
                if (lyricsData.syncedLines.length > 0) {
                    return lyricsData.syncedLines.map(line => line.text);
                }
                return lyricsData.plainLyrics.split(/\r?\n/);
            },

            renderLyricsLines(lines) {
                if (lines.length === 0) {
                    const overlay = document.getElementById('lyricsOverlay');
                    if (overlay) overlay.classList.remove('has-synced-lyrics');
                }
                const containerIds = ['lyricsContent', 'lyricsOverlayContent'];
                for (const containerId of containerIds) {
                    const container = document.getElementById(containerId);
                    if (!container) continue;
                    container.innerHTML = '';

                    const fragment = document.createDocumentFragment();
                    lines.forEach((line, index) => {
                        const el = document.createElement('div');
                        el.className = 'lyrics-line';
                        if (!line.trim()) {
                            el.classList.add('is-blank');
                            el.innerHTML = '&nbsp;';
                        } else {
                            el.textContent = line;
                        }
                        el.dataset.lyricsLineIndex = String(index);
                        fragment.appendChild(el);
                    });
                    container.appendChild(fragment);
                }
                this.applyActiveLyricsLine(this.currentLyricsLineIndex, true);
            },

            async ensureLyricsForItem(item) {
                if (this.hydrateItemLyricsFromCache(item)) {
                    this.refreshLyricsRowButton(item);
                    if (this.currentLyricsItemId === item.id) {
                        this.renderLyricsStateForItem(item);
                    }
                    return item.lyricsData;
                }

                if (item.lyricsStatus === 'ready') {
                    if (this.currentLyricsItemId === item.id) {
                        this.renderLyricsStateForItem(item);
                    }
                    return item.lyricsData;
                }

                if (item.lyricsStatus === 'loading') {
                    return item.lyricsData || null;
                }

                item.lyricsStatus = 'loading';
                this.refreshLyricsRowButton(item);
                if (this.currentLyricsItemId === item.id) {
                    this.renderLyricsStateForItem(item);
                }

                try {
                    const lyricsData = await this.lookupLyrics(item);
                    item.lyricsData = lyricsData;
                    item.lyricsStatus = lyricsData ? 'ready' : 'not_found';
                    if (lyricsData) {
                        this.persistLyricsForItem(item, lyricsData);
                    }
                } catch (error) {
                    console.error('Lyrics lookup failed:', error);
                    item.lyricsData = null;
                    item.lyricsStatus = 'error';
                }

                this.refreshLyricsRowButton(item);

                if (this.currentLyricsItemId === item.id) {
                    this.currentLyricsLineIndex = -1;
                    this.renderLyricsStateForItem(item);
                    this.updateSyncedLyricsPosition(this.currentPlaybackTime());
                }

                return item.lyricsData;
            },

            async showLyricsForItem(item) {
                this.currentLyricsItemId = item.id;
                this.currentLyricsLineIndex = -1;
                this.setLyricsPanelVisible(true);
                this.renderLyricsStateForItem(item);
                await this.ensureLyricsForItem(item);
            },

            async lookupLyrics(item) {
                const candidates = this.buildLyricsLookupCandidates(item);
                const expectedDuration = item.durationSeconds || this.parseDurationToSeconds(item.duration || '');
                /** @type {{ score: number, record: any } | null} */
                let bestMatch = null;

                // Search all candidates in parallel
                const allResults = await Promise.all(
                    candidates.map(candidate =>
                        this.searchLyricsProvider(candidate.title, candidate.artist, item.album || '')
                            .then(results => ({ candidate, results: results || [] }))
                            .catch(() => ({ candidate, results: [] }))
                    )
                );

                for (const { candidate, results } of allResults) {
                    for (const record of results) {
                        const score = this.scoreLyricsCandidate(record, candidate.artist, candidate.title, expectedDuration);
                        if (!bestMatch || score > bestMatch.score) {
                            bestMatch = { score, record };
                        }
                    }
                }

                if (!bestMatch || bestMatch.score < 0.58) {
                    return null;
                }

                const record = bestMatch.record;
                return {
                    provider: 'LRCLIB',
                    trackName: record.trackName || record.name || '',
                    artistName: record.artistName || '',
                    albumName: record.albumName || '',
                    duration: Number(record.duration) || 0,
                    instrumental: !!record.instrumental,
                    plainLyrics: (record.plainLyrics || '').trim(),
                    syncedLyrics: typeof record.syncedLyrics === 'string' && record.syncedLyrics.trim() ? record.syncedLyrics : null,
                    syncedLines: this.parseSyncedLyrics(record.syncedLyrics || '')
                };
            },

            async searchLyricsProvider(title, artist, album) {
                const key = `${this.normalizeComparisonText(artist)}|${this.normalizeComparisonText(title)}|${this.normalizeComparisonText(album)}`;
                if (this.lyricsLookupCache.has(key)) {
                    return this.lyricsLookupCache.get(key) || [];
                }

                const params = new URLSearchParams();
                if (title) params.set('track_name', title);
                if (artist) params.set('artist_name', artist);
                if (album) params.set('album_name', album);
                if (!title) {
                    params.set('q', [artist, album].filter(Boolean).join(' '));
                }

                const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`);
                if (!response.ok) {
                    throw new Error(`Lyrics search failed: HTTP ${response.status}`);
                }

                const data = await response.json();
                const results = Array.isArray(data) ? data : [];
                this.lyricsLookupCache.set(key, results);
                return results;
            },

            buildLyricsLookupCandidates(item) {
                /** @type {Array<{ artist: string, title: string }>} */
                const candidates = [];
                const parsed = this.extractArtistTitleFromVideoTitle(item.title || '');
                const primaryArtist = this.cleanArtistName(item.artist || parsed.artist || item.channelTitle || '');
                const primaryTitle = this.cleanSongTitle(item.name || parsed.title || item.title || '');
                this.addLyricsCandidate(candidates, primaryArtist, primaryTitle);

                if (parsed.artist || parsed.title) {
                    this.addLyricsCandidate(candidates, this.cleanArtistName(parsed.artist), this.cleanSongTitle(parsed.title));
                }

                if (item.channelTitle) {
                    this.addLyricsCandidate(candidates, this.cleanArtistName(item.channelTitle), primaryTitle);
                }

                if (!candidates.length) {
                    this.addLyricsCandidate(candidates, '', this.cleanSongTitle(item.title || item.name || ''));
                }

                return candidates;
            },

            addLyricsCandidate(candidates, artist, title) {
                const cleanedArtist = this.cleanArtistName(artist);
                const cleanedTitle = this.cleanSongTitle(title);
                if (!cleanedTitle) return;
                const key = `${this.normalizeComparisonText(cleanedArtist)}|${this.normalizeComparisonText(cleanedTitle)}`;
                if (candidates.some(candidate => `${this.normalizeComparisonText(candidate.artist)}|${this.normalizeComparisonText(candidate.title)}` === key)) {
                    return;
                }
                candidates.push({ artist: cleanedArtist, title: cleanedTitle });
            },

            extractArtistTitleFromVideoTitle(title) {
                const separators = [' - ', ' – ', ' — ', ': '];
                for (const separator of separators) {
                    const parts = title.split(separator).map(part => part.trim()).filter(Boolean);
                    if (parts.length >= 2) {
                        return {
                            artist: parts[0],
                            title: parts.slice(1).join(separator)
                        };
                    }
                }
                return { artist: '', title: title.trim() };
            },

            cleanSongTitle(text) {
                return this.normalizeWhitespace(text
                    .replace(/\[(official|lyrics?|audio|video|hd|4k)[^\]]*\]/gi, '')
                    .replace(/\((official|lyrics?|audio|video|hd|4k)[^)]*\)/gi, '')
                    .replace(/\bfeat\.?\b.*$/i, '')
                    .replace(/\bft\.?\b.*$/i, '')
                    .replace(/\s+\|\s+.*$/g, '')
                    .replace(/\s*\/\s*lyrics?$/i, '')
                );
            },

            cleanArtistName(text) {
                return this.normalizeWhitespace(text
                    .replace(/\b- topic\b/gi, '')
                    .replace(/\bofficial\b/gi, '')
                );
            },

            normalizeWhitespace(text) {
                return text.replace(/\s+/g, ' ').trim();
            },

            normalizeComparisonText(value) {
                return this.normalizeWhitespace(value
                    .toLowerCase()
                    .replace(/&/g, ' and ')
                    .replace(/[^\w\s]/g, ' ')
                    .replace(/\b(feat|featuring|ft|official|video|audio|lyrics|topic|remaster(ed)?)\b/g, ' ')
                );
            },

            tokenSimilarity(a, b) {
                const normalizedA = this.normalizeComparisonText(a);
                const normalizedB = this.normalizeComparisonText(b);
                if (!normalizedA || !normalizedB) return 0;
                if (normalizedA === normalizedB) return 1;
                if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return 0.9;

                const tokensA = new Set(normalizedA.split(' ').filter(Boolean));
                const tokensB = new Set(normalizedB.split(' ').filter(Boolean));
                if (!tokensA.size || !tokensB.size) return 0;

                let intersection = 0;
                for (const token of tokensA) {
                    if (tokensB.has(token)) intersection++;
                }

                const union = new Set([...tokensA, ...tokensB]).size;
                return union ? intersection / union : 0;
            },

            scoreLyricsCandidate(record, artist, title, expectedDuration) {
                const titleScore = this.tokenSimilarity(record.trackName || record.name || '', title);
                const artistScore = artist ? this.tokenSimilarity(record.artistName || '', artist) : 0.55;
                const duration = Number(record.duration) || 0;
                let durationScore = 0.5;
                if (expectedDuration > 0 && duration > 0) {
                    const diff = Math.abs(duration - expectedDuration);
                    durationScore = Math.max(0, 1 - (diff / 20));
                }
                return (titleScore * 0.6) + (artistScore * 0.25) + (durationScore * 0.15);
            },

            parseSyncedLyrics(syncedLyrics) {
                /** @type {SyncedLyricLine[]} */
                const lines = [];
                const regex = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g;
                let match = null;
                while ((match = regex.exec(syncedLyrics)) !== null) {
                    const minutes = Number(match[1]) || 0;
                    const seconds = Number(match[2]) || 0;
                    const fraction = match[3] || '0';
                    const fractionMs = Number(fraction.padEnd(3, '0')) || 0;
                    const time = (minutes * 60) + seconds + (fractionMs / 1000);
                    lines.push({
                        time,
                        text: (match[4] || '').trim()
                    });
                }
                return lines;
            },

            currentPlaybackTime() {
                if (!this.currentPlayingId) return 0;
                const player = this.playback.player;
                if (player && typeof player.getCurrentTime === 'function') {
                    try {
                        return player.getCurrentTime();
                    } catch (error) {
                        return 0;
                    }
                }
                return 0;
            },

            updateSyncedLyricsPosition(currentTime) {
                const currentItem = this.currentLyricsItem();
                if (!currentItem || currentItem.id !== this.currentPlayingId || !currentItem.lyricsData || currentItem.lyricsData.syncedLines.length === 0) {
                    this.applyActiveLyricsLine(-1);
                    this.relayLyricToNowPlaying(-1);
                    return;
                }

                const syncedLines = currentItem.lyricsData.syncedLines;
                this.applyActiveLyricsLine(this.syncedLyricLineIndexAt(syncedLines, currentTime));
                this.relayLyricToNowPlaying(
                    this.syncedLyricLineIndexAt(syncedLines, currentTime + LYRIC_TITLE_LEAD_SECONDS)
                );
            },

            /** @param {SyncedLyricLine[]} syncedLines @param {number} time */
            syncedLyricLineIndexAt(syncedLines, time) {
                let index = -1;
                for (let i = 0; i < syncedLines.length; i++) {
                    if (time >= syncedLines[i].time) {
                        index = i;
                    } else {
                        break;
                    }
                }
                return index;
            },

            applyActiveLyricsLine(activeIndex, force = false) {
                if (!force && this.currentLyricsLineIndex === activeIndex) return;
                this.currentLyricsLineIndex = activeIndex;
                const overlayOpen = document.body.classList.contains('lyrics-overlay-open');
                const selectors = ['#lyricsContent .lyrics-line', '#lyricsOverlayContent .lyrics-line'];
                for (const selector of selectors) {
                    const isOverlay = selector.includes('lyricsOverlayContent');
                    document.querySelectorAll(selector).forEach((element, index) => {
                        const htmlElement = /** @type {HTMLElement} */ (element);
                        const isActive = index === activeIndex && activeIndex >= 0;
                        htmlElement.classList.toggle('is-active', isActive);
                        if (isOverlay) {
                            htmlElement.classList.toggle('is-next', activeIndex >= 0 && index === activeIndex + 1);
                        }
                        const shouldScroll = overlayOpen
                            ? isOverlay
                            : !isOverlay;
                        if (isActive && shouldScroll) {
                            const container = htmlElement.closest('.lyrics-overlay-content, .lyrics-content');
                            if (container) {
                                const containerRect = container.getBoundingClientRect();
                                const elRect = htmlElement.getBoundingClientRect();
                                const offset = elRect.top - containerRect.top - (containerRect.height / 2) + (elRect.height / 2);
                                container.scrollBy({ top: offset, behavior: force ? 'auto' : 'smooth' });
                            }
                        }
                    });
                }
            },

            /**
             * The singer's title line: the line at the (led) index when it
             * has text, otherwise the next upcoming line - so intros and
             * instrumental gaps show what is about to be sung. Past the
             * last line, the last sung line stays up.
             * @param {SyncedLyricLine[]} lines @param {number} index
             */
            lyricTitleLineAt(lines, index) {
                if (index >= 0 && index < lines.length && lines[index].text.trim()) {
                    return lines[index].text.trim();
                }
                for (let i = Math.max(index + 1, 0); i < lines.length; i++) {
                    if (lines[i].text.trim()) return lines[i].text.trim();
                }
                for (let i = Math.min(index, lines.length - 1); i >= 0; i--) {
                    if (lines[i].text.trim()) return lines[i].text.trim();
                }
                return '';
            },

            /**
             * Relay the sung/upcoming lyric into the now-playing surfaces
             * (Media Session metadata for car/lock-screen displays plus
             * the tab title). The point is singing along while driving:
             * the title is the lyric line and nothing else. Song/artist
             * names are NEVER written here - when there is no lyric to
             * show, the surfaces are cleared instead.
             */
            relayLyricToNowPlaying(activeIndex) {
                const item = this.currentLyricsItem();
                const playingThisItem = !!item && item.id === this.currentPlayingId
                    && this.isPlaying && !this.isPaused;
                const lines = (playingThisItem && item.lyricsData) ? item.lyricsData.syncedLines : [];
                const line = (this.settings.lyricsOnNowPlaying && lines.length)
                    ? this.lyricTitleLineAt(lines, activeIndex)
                    : '';

                if (line) {
                    if (this.nowPlayingShowsLyric && this.nowPlayingLyricLine === line) return;
                    this.nowPlayingLyricLine = line;
                    this.setNowPlayingText(line, '', '');
                    document.title = line;
                    this.setHeaderTitleText(line);
                    this.nowPlayingShowsLyric = true;
                } else if (this.nowPlayingShowsLyric) {
                    this.nowPlayingShowsLyric = false;
                    this.nowPlayingLyricLine = '';
                    document.title = DEFAULT_DOCUMENT_TITLE;
                    this.setHeaderTitleText('Music');
                    this.setNowPlayingText('', '', '');
                }
            },

            /** The visible topbar heading mirrors the same lyric line. */
            setHeaderTitleText(text) {
                const heading = document.querySelector('#siteHeader .header-title-group h1');
                if (heading) heading.textContent = text;
            },

            setNowPlayingText(title, artist, album) {
                if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
                navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album });
            },

            hydrateItemLyricsFromCache(item) {
                const cacheKeys = this.getLyricsCacheKeysForItem(item);
                for (const key of cacheKeys) {
                    const cached = this.lyricsCache[key];
                    if (cached && this.cachedLyricsMatchesItem(cached, item)) {
                        item.lyricsData = cached;
                        item.lyricsStatus = 'ready';
                        return true;
                    }
                }
                return false;
            },

            cachedLyricsMatchesItem(cached, item) {
                const candidates = this.buildLyricsLookupCandidates(item);
                const expectedDuration = Math.round(item.durationSeconds || this.parseDurationToSeconds(item.duration || ''));
                const cachedDuration = Math.round(cached.duration || 0);
                const durationMatches = expectedDuration === 0 || cachedDuration === 0 || Math.abs(expectedDuration - cachedDuration) <= 8;

                return candidates.some(candidate => {
                    const titleScore = this.tokenSimilarity(cached.trackName || '', candidate.title);
                    const artistScore = candidate.artist ? this.tokenSimilarity(cached.artistName || '', candidate.artist) : 0.55;
                    return titleScore >= 0.72 && artistScore >= 0.5 && durationMatches;
                });
            },

            persistLyricsForItem(item, lyricsData) {
                const durationSeconds = Math.round(lyricsData.duration || item.durationSeconds || this.parseDurationToSeconds(item.duration || ''));
                const keys = new Set(this.getLyricsCacheKeysForItem(item));
                keys.add(this.buildLyricsCacheKey(lyricsData.artistName, lyricsData.trackName, durationSeconds));
                for (const key of keys) {
                    this.lyricsCache[key] = lyricsData;
                }
                PlayerStorage.saveLyricsCache(this.lyricsCache);
            },

            getLyricsCacheKeysForItem(item) {
                const durationSeconds = Math.round(item.durationSeconds || this.parseDurationToSeconds(item.duration || ''));
                return this.buildLyricsLookupCandidates(item).map(candidate =>
                    this.buildLyricsCacheKey(candidate.artist, candidate.title, durationSeconds)
                );
            },

            buildLyricsCacheKey(artist, title, durationSeconds) {
                return `${this.normalizeComparisonText(artist)}|${this.normalizeComparisonText(title)}|${Math.max(0, Math.round(durationSeconds || 0))}`;
            },

            refreshLyricsRowButton(item) {
                const row = document.querySelector(`[data-item-id="${item.id}"]`);
                const button = /** @type {HTMLButtonElement | null} */ (row?.querySelector('.lyrics-row-btn'));
                if (!button) return;
                const lyricsReady = item.lyricsStatus === 'ready' && !!item.lyricsData;
                const lyricsLoading = item.lyricsStatus === 'loading';
                const lyricsNotFound = item.lyricsStatus === 'not_found';
                const lyricsError = item.lyricsStatus === 'error';
                button.classList.toggle('ready', lyricsReady);
                button.classList.toggle('not-found', lyricsNotFound || lyricsError);
                if (lyricsLoading) {
                    button.textContent = '...';
                } else if (lyricsReady) {
                    button.textContent = 'L';
                } else if (lyricsNotFound) {
                    button.textContent = '--';
                } else if (lyricsError) {
                    button.textContent = '!';
                } else {
                    button.textContent = 'Get';
                }
                button.setAttribute('aria-label', lyricsReady ? 'Show cached lyrics' : (lyricsNotFound ? 'Lyrics not found' : 'Get lyrics'));
                if (this.currentLyricsItemId === item.id || this.currentPlayingId === item.id) {
                    this.updateBigLyricsAvailability();
                }
            }
        }));
    }

    return { install };
})();

window.PlayerLyrics = PlayerLyrics;
