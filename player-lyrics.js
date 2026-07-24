// @ts-check
// Lyrics panel, overlay, LRCLIB lookup, and synced line highlighting.

const PlayerLyrics = (function () {
    'use strict';

    // The now-playing title leads the sung lyric so Bluetooth metadata
    // propagation (phone -> AVRCP -> car redraw) lands near the moment
    // the line actually starts. The on-screen highlight stays unled.
    const LYRIC_TITLE_LEAD_SECONDS = 0.75;

    // A half-second step is fine enough to correct ordinary lyric drift
    // while remaining easy to count through repeated taps.
    const LYRIC_OFFSET_STEP_SECONDS = 0.5;

    // For the first moments of every song the title spots show WHO and
    // WHAT is playing (artist - song - year - album) before lyric duty
    // begins.
    const SONG_IDENTITY_INTRO_SECONDS = 2;

    // When a song's first lyric line starts later than this, the title
    // spots prefix the upcoming line with a per-second countdown so the
    // singer knows when to come in.
    const FIRST_LYRIC_COUNTDOWN_MIN_SECONDS = 5;

    // Background lyric lookups run through one bounded queue: at most this
    // many songs are being resolved at a time (each may issue a few
    // candidate searches). Adding a 100-song playlist must not fire 100
    // provider requests at once, and reopening the page resumes whatever
    // was interrupted through the same queue.
    const LYRICS_QUEUE_CONCURRENCY = 2;

    // A stored answered "none" is trusted this long before a normal
    // interaction rechecks the provider. The row chip force-retries a
    // "none" immediately regardless of age.
    const LYRICS_NONE_RECHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    // Every provider fetch is bounded so a lookup left mid-air by a page
    // suspension or a dead radio always settles - a song can never wedge
    // in 'loading'.
    const LYRICS_PROVIDER_TIMEOUT_MS = 12000;

    // Bumped whenever the lyric search gets smarter. Stored records from an
    // older search that did NOT land timed lyrics (simple-only or none) get
    // exactly one re-search under the new algorithm; records that already
    // hold timed lyrics are final. v2: timed-lyrics-first record selection.
    const LYRICS_SEARCH_VERSION = 2;

    /** @param {VoiceMusicController} controller */
    function install(controller) {
        Object.assign(controller, /** @type {ThisType<VoiceMusicController>} */ ({
            currentLyricsItem() {
                if (this.currentLyricsItemId == null) {
                    return null;
                }
                return this.playlist.find(item => item.id === this.currentLyricsItemId) || null;
            },

            /** The track the player is actually sounding - car/title relay source. */
            playingPlaylistItem() {
                if (this.currentPlayingId == null) return null;
                return this.playlist.find(item => item.id === this.currentPlayingId) || null;
            },

            toggleLyricsPanel() {
                const nextVisible = !this.lyricsPanelVisible;
                this.setLyricsPanelVisible(nextVisible);
                if (nextVisible) {
                    const currentItem = this.playingPlaylistItem() || this.currentLyricsItem() || this.currentPlaylistItem();
                    if (currentItem) {
                        this.currentLyricsItemId = currentItem.id;
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
                // Karaoke overlay follows the sounding track, not a chip
                // tap on a different row.
                const currentItem = this.playingPlaylistItem() || this.currentLyricsItem() || this.currentPlaylistItem();
                if (currentItem) {
                    this.currentLyricsItemId = currentItem.id;
                    this.renderLyricsStateForItem(currentItem);
                    void this.ensureLyricsForItem(currentItem);
                } else {
                    this.renderLyricsStateForItem(null);
                }
                overlay.style.display = 'block';
                overlay.setAttribute('aria-hidden', 'false');
                document.body.classList.add('lyrics-overlay-open');
                this.updateTransportPauseLabel();
                this.updateLyricOffsetControls();
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
                this.updateLyricOffsetControls();
                const btn = document.getElementById('lyricsOverlayBtn');
                if (!btn) return;
                const currentItem = this.playingPlaylistItem() || this.currentLyricsItem() || this.currentPlaylistItem();
                btn.classList.remove('lyrics-available', 'lyrics-unavailable', 'lyrics-loading');
                if (!currentItem) {
                    btn.classList.add('lyrics-unavailable');
                    btn.textContent = 'Big';
                    btn.title = 'Big Lyrics overlay';
                } else if (currentItem.lyricsStatus === 'loading') {
                    btn.classList.add('lyrics-loading');
                    btn.textContent = 'Big ...';
                    btn.title = 'Looking up lyrics';
                } else if (currentItem.lyricsStatus === 'ready' && currentItem.lyricsData) {
                    btn.classList.add('lyrics-available');
                    const timed = currentItem.lyricsData.syncedLines && currentItem.lyricsData.syncedLines.length > 0;
                    btn.textContent = timed ? 'Big (timed)' : 'Big (simple)';
                    btn.title = timed ? 'Big Lyrics overlay - timed lyrics' : 'Big Lyrics overlay - simple lyrics';
                } else {
                    btn.classList.add('lyrics-unavailable');
                    btn.textContent = currentItem.lyricsStatus === 'not_found' ? 'No lyrics' : 'Big';
                    btn.title = currentItem.lyricsStatus === 'not_found' ? 'No lyrics found' : 'Big Lyrics overlay';
                }
                this.updateFirstLyricButton();
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
                    const isTimed = lyricsData.syncedLines.length > 0;
                    if (lyricsData.instrumental) {
                        this.updateLyricsStatus(item, 'Track appears to be instrumental.');
                    } else if (isTimed) {
                        this.updateLyricsStatus(item, `Timed lyrics: ${lyricsData.artistName} - ${lyricsData.trackName} (LRCLIB)`);
                    } else {
                        this.updateLyricsStatus(item, `Simple lyrics: ${lyricsData.artistName} - ${lyricsData.trackName} (LRCLIB)`);
                    }
                    this.renderLyricsLines(this.getRenderableLyricsLines(lyricsData));
                    const overlay = document.getElementById('lyricsOverlay');
                    if (overlay) overlay.classList.toggle('has-synced-lyrics', isTimed);
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
                    // Replaced lyric content belongs to a new render, so it
                    // must not inherit the prior track's reading position.
                    container.scrollTop = 0;

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

            /**
             * Background path into lyric lookup: enqueue the item and let
             * the bounded workers resolve it. Direct user intent (playing
             * a song, tapping its chip) still calls ensureLyricsForItem
             * immediately - it is idempotent against the queue.
             */
            queueLyricsLookup(item) {
                if (item.lyricsStatus !== 'idle') return;
                if (this.lyricsFetchQueue.includes(item)) return;
                this.lyricsFetchQueue.push(item);
                this.pumpLyricsQueue();
            },

            pumpLyricsQueue() {
                while (this.lyricsFetchActive < LYRICS_QUEUE_CONCURRENCY && this.lyricsFetchQueue.length > 0) {
                    const item = this.lyricsFetchQueue.shift();
                    // Re-check at dequeue: the song may have resolved via a
                    // direct play, and a playlist row may have been removed.
                    // Backfill items are detached from the playlist by design
                    // and always run.
                    if (item.lyricsStatus !== 'idle') continue;
                    if (item.sourceKind !== 'backfill' && !this.playlist.some(entry => entry.id === item.id)) continue;
                    this.lyricsFetchActive++;
                    void this.ensureLyricsForItem(item).finally(() => {
                        this.lyricsFetchActive--;
                        this.pumpLyricsQueue();
                    });
                }
            },

            /**
             * Library lyric reconciliation, run on every page load: every
             * favorite is queued for resolution. Resolution is per song
             * against the permanent store, so songs already resolved
             * (found lyrics, or a fresh answered "none") settle from one
             * IndexedDB read with zero network - the pass is idempotent
             * and an interrupted or failed recheck resumes on the next
             * open by construction.
             */
            reconcileLibraryLyrics() {
                let queued = 0;
                const seen = new Set();
                for (const favorite of Object.values(this.favorites)) {
                    if (seen.has(favorite.videoId)) continue;
                    seen.add(favorite.videoId);
                    const item = PlayerSongs.createPlaylistItem(favorite, {
                        sourceKind: 'backfill',
                        sourceLabel: 'Library lyrics reconcile'
                    });
                    if (!item) continue;
                    this.queueLyricsLookup(item);
                    queued++;
                }
                if (queued > 0) {
                    this.addMessage('claude', 'Lyrics reconcile', `Verifying lyric state for ${queued} favorite${queued === 1 ? '' : 's'} (already-resolved songs cost nothing)`);
                }
            },

            /**
             * Bring this song's lyric state onto the live item, from the
             * permanent store outward. Used by every interaction with a
             * song (queued add, restore, direct play, chip tap):
             *
             * - An item already activated ('ready' with data) is trusted:
             *   activation only ever happens FROM the store or after an
             *   awaited save TO it, so it cannot disagree with the store.
             * - Otherwise resolution runs as one shared flight per videoId
             *   (duplicate rows, the queue, and a direct play all await
             *   the same promise), and the provider fetch is time-bounded,
             *   so a lookup interrupted by a page suspension can never
             *   leave the song wedged in 'loading' - the flight settles
             *   and the next interaction verifies against the store again.
             * @param {PlaylistItem} item
             * @param {{ forceLookup?: boolean }} [options]
             */
            async ensureLyricsForItem(item, { forceLookup = false } = {}) {
                // Timed lyrics in hand settle the session. Simple-only
                // lyrics stay upgrade-eligible: fall through to resolution,
                // which is one cheap store read when the record is current
                // and only re-searches when an upgrade attempt is due.
                const hasTimedLyrics = item.lyricsStatus === 'ready' && !!item.lyricsData
                    && item.lyricsData.syncedLines.length > 0;
                if (!forceLookup && hasTimedLyrics) {
                    if (this.currentLyricsItemId === item.id) {
                        this.renderLyricsStateForItem(item);
                    }
                    return item.lyricsData;
                }

                let flight = this.lyricsLookupsInFlight.get(item.videoId);
                if (!flight) {
                    flight = this.resolveLyricState(item, forceLookup);
                    this.lyricsLookupsInFlight.set(item.videoId, flight);
                }

                // A simple-lyrics upgrade check keeps showing what it has;
                // only a song with nothing yet enters the visible loading
                // state.
                const upgradingSimple = item.lyricsStatus === 'ready' && !!item.lyricsData;
                if (!upgradingSimple) {
                    item.lyricsStatus = 'loading';
                    item.lyricsData = null;
                    this.refreshLyricsRowButton(item);
                    if (this.currentLyricsItemId === item.id) {
                        this.renderLyricsStateForItem(item);
                    }
                }

                try {
                    const state = await flight;
                    this.applyLyricStateToItem(item, state);
                } catch (error) {
                    // Expected, handled external failure (provider or DB):
                    // nothing was saved. A song with simple lyrics keeps
                    // them (the upgrade just did not happen); a song with
                    // nothing stays unresolved and retries on next use.
                    if (!upgradingSimple) {
                        this.addMessage('error', 'Lyrics lookup failed', `${this.describePlaylistItem(item)}: ${error instanceof Error ? error.message : String(error)} (retries on next use)`);
                        item.lyricsData = null;
                        item.lyricsStatus = 'error';
                    }
                } finally {
                    if (this.lyricsLookupsInFlight.get(item.videoId) === flight) {
                        this.lyricsLookupsInFlight.delete(item.videoId);
                    }
                }

                this.refreshLyricsRowButton(item);

                if (this.currentLyricsItemId === item.id) {
                    this.currentLyricsLineIndex = -1;
                    this.renderLyricsStateForItem(item);
                }
                // Car/title relay follows the sounding track. Re-arm even
                // when the lyrics panel is focused on a different row.
                if (this.currentPlayingId === item.id) {
                    this.resyncProgressClock();
                }

                return item.lyricsData;
            },

            /**
             * Resolve a song's lyric state with the permanent store
             * (IndexedDB `lyricStates`, keyed by videoId) as the single
             * source of truth:
             * 1. A stored record with TIMED lyrics is final - zero network.
             * 2. A stored simple-only or "none" record settles from the
             *    store while it is fresh AND was produced by the current
             *    search algorithm; otherwise it gets one serious re-search
             *    aimed at timed lyrics.
             * 3. The provider answer is saved FIRST (awaited), then
             *    returned for activation. An upgrade attempt that finds
             *    nothing better keeps the existing simple lyrics - a
             *    re-search can never downgrade what we already have.
             *    Failures throw without saving anything.
             * @param {PlaylistItem} item
             * @param {boolean} forceLookup ignore a stored "none" (user retry)
             * @returns {Promise<LyricStateRecord>}
             */
            async resolveLyricState(item, forceLookup) {
                const saved = await window.PlayerHistoryDB.getLyricState(item.videoId);
                const savedHasTimed = !!saved && saved.status === 'found' && !!saved.lyrics
                    && Array.isArray(saved.lyrics.syncedLines) && saved.lyrics.syncedLines.length > 0;
                if (savedHasTimed) {
                    return saved;
                }
                const savedFresh = !!saved && (Date.now() - saved.checkedAt) < LYRICS_NONE_RECHECK_TTL_MS;
                const savedCurrentSearch = !!saved && saved.searchVersion === LYRICS_SEARCH_VERSION;
                if (!forceLookup && saved && savedFresh && savedCurrentSearch) {
                    return saved;
                }

                const lyrics = await this.lookupLyrics(item);
                // A user-tuned offset outlives re-searches; only absent when
                // the song has never been adjusted.
                const preservedOffset = saved && typeof saved.lyricOffsetSeconds === 'number'
                    ? saved.lyricOffsetSeconds
                    : undefined;
                /** @type {LyricStateRecord} */
                let state;
                if (lyrics) {
                    const foundTimed = lyrics.syncedLines.length > 0;
                    const keepExistingSimple = !foundTimed
                        && !!saved && saved.status === 'found' && !!saved.lyrics;
                    state = keepExistingSimple
                        ? { ...saved, checkedAt: Date.now(), searchVersion: LYRICS_SEARCH_VERSION }
                        : { videoId: item.videoId, status: 'found', checkedAt: Date.now(), searchVersion: LYRICS_SEARCH_VERSION, lyrics };
                    if (foundTimed && saved && !savedHasTimed) {
                        this.addMessage('claude', 'Timed lyrics found', `Upgraded from simple lyrics: ${this.describePlaylistItem(item)}`);
                    }
                } else if (saved && saved.status === 'found' && saved.lyrics) {
                    // Upgrade attempt answered empty: keep the simple lyrics.
                    state = { ...saved, checkedAt: Date.now(), searchVersion: LYRICS_SEARCH_VERSION };
                } else {
                    state = { videoId: item.videoId, status: 'none', checkedAt: Date.now(), searchVersion: LYRICS_SEARCH_VERSION };
                }
                if (typeof preservedOffset === 'number') {
                    state.lyricOffsetSeconds = preservedOffset;
                }
                await window.PlayerHistoryDB.putLyricState(state);
                return state;
            },

            /**
             * Activation: the live object learns what the store just said.
             * Only ever called with a state that was read from or saved to
             * the permanent store.
             * @param {PlaylistItem} item @param {LyricStateRecord} state
             */
            applyLyricStateToItem(item, state) {
                if (state.status === 'found' && state.lyrics) {
                    item.lyricsData = state.lyrics;
                    item.lyricsStatus = 'ready';
                } else {
                    item.lyricsData = null;
                    item.lyricsStatus = 'not_found';
                }
                item.lyricOffsetSeconds = typeof state.lyricOffsetSeconds === 'number'
                    ? state.lyricOffsetSeconds
                    : 0;
                this.updateLyricOffsetControls();
            },

            /** @param {PlaylistItem | null | undefined} item */
            lyricOffsetForItem(item) {
                if (!item || typeof item.lyricOffsetSeconds !== 'number') return 0;
                return item.lyricOffsetSeconds;
            },

            /** @param {number} offsetSeconds */
            formatLyricOffset(offsetSeconds) {
                const normalized = Math.abs(offsetSeconds) < 0.05 ? 0 : offsetSeconds;
                const sign = normalized > 0 ? '+' : '';
                return `${sign}${normalized.toFixed(1)}s`;
            },

            updateLyricOffsetControls() {
                const item = this.playingPlaylistItem();
                const show = !!item && this.itemHasTimedLyrics(item);
                for (const id of ['transportLyricsSyncControls', 'lyricsOverlaySyncControls']) {
                    const controls = document.getElementById(id);
                    if (controls) controls.style.display = show ? '' : 'none';
                }
                const text = `Offset ${this.formatLyricOffset(this.lyricOffsetForItem(item))}`;
                for (const id of ['transportLyricOffset', 'lyricsOverlayOffset']) {
                    const output = document.getElementById(id);
                    if (output) output.textContent = text;
                }
            },

            /**
             * Nudge the sounding track's lyric clock and persist it on the
             * lyricStates record for that videoId. Positive delta shows
             * later lines; negative delta shows earlier lines.
             * @param {number} deltaSeconds
             */
            async nudgeLyricOffset(deltaSeconds) {
                const item = this.playingPlaylistItem();
                if (!item || !item.videoId || !this.itemHasTimedLyrics(item)) return;
                const next = Math.round((this.lyricOffsetForItem(item) + deltaSeconds) * 10) / 10;
                item.lyricOffsetSeconds = next;
                this.updateLyricOffsetControls();
                const saved = await window.PlayerHistoryDB.getLyricState(item.videoId);
                /** @type {LyricStateRecord} */
                const record = saved
                    ? { ...saved, lyricOffsetSeconds: next }
                    : {
                        videoId: item.videoId,
                        status: 'found',
                        checkedAt: Date.now(),
                        searchVersion: LYRICS_SEARCH_VERSION,
                        lyrics: item.lyricsData || undefined,
                        lyricOffsetSeconds: next
                    };
                await window.PlayerHistoryDB.putLyricState(record);
                this.updateListeningTextPosition(this.currentPlaybackTime());
                this.resyncProgressClock();
            },

            /** The displayed lyrics are ahead of the audio: show earlier lines. */
            lyricsTooFast() {
                return this.nudgeLyricOffset(-LYRIC_OFFSET_STEP_SECONDS);
            },

            /** The displayed lyrics are behind the audio: show later lines. */
            lyricsTooSlow() {
                return this.nudgeLyricOffset(LYRIC_OFFSET_STEP_SECONDS);
            },

            async showLyricsForItem(item) {
                // Tapping the row chip is explicit user intent: a stored
                // answered "none" gets rechecked at the provider now.
                const forceLookup = item.lyricsStatus === 'not_found';
                this.currentLyricsItemId = item.id;
                this.currentLyricsLineIndex = -1;
                this.setLyricsPanelVisible(true);
                this.renderLyricsStateForItem(item);
                await this.ensureLyricsForItem(item, { forceLookup });
            },

            async lookupLyrics(item) {
                const candidates = this.buildLyricsLookupCandidates(item);
                const expectedDuration = item.durationSeconds || this.parseDurationToSeconds(item.duration || '');
                /** @type {{ score: number, record: any } | null} */
                let bestMatch = null;

                // Search all candidates in parallel, keeping failures
                // distinct from genuine empty answers.
                const searches = await Promise.all(
                    candidates.map(candidate =>
                        this.searchLyricsProvider(candidate.title, candidate.artist, item.album || '')
                            .then(results => ({ candidate, results: results || [], error: /** @type {Error | null} */ (null) }))
                            .catch(error => ({
                                candidate,
                                results: /** @type {any[]} */ ([]),
                                error: error instanceof Error ? error : new Error(String(error))
                            }))
                    )
                );

                // A provider failure (rate limit, network) is NOT "no lyrics
                // exist". Only searches that actually answered may conclude
                // not-found; if every candidate search failed, throw so the
                // item lands in 'error' and is retried on the next load -
                // never recorded as a durable miss.
                const answered = searches.filter(search => !search.error);
                if (answered.length === 0) {
                    const firstError = searches[0] ? searches[0].error : null;
                    throw new Error(`All ${searches.length} lyric search${searches.length === 1 ? '' : 'es'} failed: ${firstError ? firstError.message : 'unknown error'}`);
                }

                // Timed lyrics first: among records that match the song well
                // enough, one carrying timed (synced) lyrics always beats a
                // simple-only one, even at a slightly lower match score.
                /** @type {{ score: number, record: any } | null} */
                let bestTimedMatch = null;
                for (const { candidate, results } of answered) {
                    for (const record of results) {
                        const score = this.scoreLyricsCandidate(record, candidate.artist, candidate.title, expectedDuration);
                        if (!bestMatch || score > bestMatch.score) {
                            bestMatch = { score, record };
                        }
                        const hasTimed = typeof record.syncedLyrics === 'string' && record.syncedLyrics.trim();
                        if (hasTimed && (!bestTimedMatch || score > bestTimedMatch.score)) {
                            bestTimedMatch = { score, record };
                        }
                    }
                }

                const chosen = (bestTimedMatch && bestTimedMatch.score >= 0.58) ? bestTimedMatch : bestMatch;
                if (!chosen || chosen.score < 0.58) {
                    return null;
                }

                const record = chosen.record;
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

                const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
                    signal: AbortSignal.timeout(LYRICS_PROVIDER_TIMEOUT_MS)
                });
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

            updateListeningTextPosition(currentTime) {
                // Title spots and the sticky lyric row always follow the
                // sounding track. The panel/overlay highlight only moves
                // when those views are showing that same track (a chip tap
                // on another row must not freeze or clear the car display).
                const playingItem = this.playingPlaylistItem();
                const showingPlaying = !!playingItem && this.currentLyricsItemId === playingItem.id;
                const syncedLines = (playingItem && playingItem.lyricsData)
                    ? playingItem.lyricsData.syncedLines
                    : [];
                const offset = this.lyricOffsetForItem(playingItem);
                // Lyric-file clock: playback time plus the per-song nudge.
                // Identity intro still uses wall-clock currentTime.
                const lyricTime = currentTime + offset;
                const reportText = this.songReportTextAt(playingItem, currentTime);

                if (!playingItem || syncedLines.length === 0) {
                    if (showingPlaying) this.applyActiveLyricsLine(-1);
                    // Songs without synced lyrics still get the identity
                    // intro in the title spots for the first seconds.
                    const lyricText = playingItem
                        ? this.lyricDisplayTextAt(playingItem, [], -1, currentTime)
                        : '';
                    this.relayListeningTextToNowPlaying(lyricText, reportText);
                    this.updateTransportBarLyric(lyricText);
                    this.updateTransportBarSecondary(reportText);
                    return;
                }

                const activeIndex = this.syncedLyricLineIndexAt(syncedLines, lyricTime);
                if (showingPlaying) this.applyActiveLyricsLine(activeIndex);
                const barLyric = this.lyricDisplayTextAt(playingItem, syncedLines, activeIndex, currentTime);
                const ledIndex = this.syncedLyricLineIndexAt(
                    syncedLines,
                    lyricTime + LYRIC_TITLE_LEAD_SECONDS
                );
                const relayLyric = this.lyricDisplayTextAt(playingItem, syncedLines, ledIndex, currentTime);
                this.updateTransportBarLyric(barLyric);
                this.updateTransportBarSecondary(reportText);
                this.relayListeningTextToNowPlaying(relayLyric, reportText);
            },

            /**
             * The sticky now-playing bar's lyric row: the sung (or next
             * upcoming) line, always on screen while scrolling. Empty text
             * collapses the row.
             * @param {string} text
             */
            updateTransportBarLyric(text) {
                const el = document.getElementById('transportBarLyric');
                if (!el) return;
                const line = String(text || '').trim();
                if (el.textContent !== line) {
                    el.textContent = line;
                }
                el.style.display = line ? 'block' : 'none';
            },

            /** @param {string} text */
            updateTransportBarSecondary(text) {
                const el = document.getElementById('transportBarSecondary');
                if (!el) return;
                const line = String(text || '').trim();
                if (el.textContent !== line) {
                    el.textContent = line;
                }
                el.style.display = line ? 'block' : 'none';
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

            /**
             * The next media-time moment at which anything lyric-driven
             * changes: a line becomes the highlight (line.time) or enters
             * the led title window (line.time - lead). Infinity when no
             * synced lyrics apply. The deadline clock sleeps until here.
             * @param {number} currentTime
             */
            nextListeningTextDeadline(currentTime) {
                const item = this.playingPlaylistItem();
                if (!item) return Infinity;
                let next = this.nextSongReportDeadline(currentTime);
                if (!item.lyricsData) return next;
                const offset = this.lyricOffsetForItem(item);
                for (const line of item.lyricsData.syncedLines) {
                    // A line becomes active / enters the led title window
                    // at wall-clock times shifted by the per-song offset.
                    for (const at of [line.time - offset, line.time - offset - LYRIC_TITLE_LEAD_SECONDS]) {
                        if (at > currentTime && at < next) next = at;
                    }
                }
                return next;
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

            /** @param {PlaylistItem} item "Artist - Song - Year - Album", skipping unknowns */
            describeSongIdentity(item) {
                return [item.artist, item.name, item.year, item.album]
                    .map(part => String(part || '').trim())
                    .filter(Boolean)
                    .join(' - ');
            },

            /**
             * Media Session artist line (car/lock-screen second row):
             * year - artist - song name. Title stays the lyric; this line
             * keeps song identity visible for the whole play.
             * @param {PlaylistItem} item
             */
            describeNowPlayingArtist(item) {
                return [item.year, item.artist, item.name]
                    .map(part => String(part || '').trim())
                    .filter(Boolean)
                    .join(' - ');
            },

            /**
             * What the title spots (car/lock-screen metadata, tab title,
             * header lyric line, sticky-bar lyric row) show at a moment:
             * - First seconds of a song: the song's identity, so the
             *   listener knows who and what it is.
             * - Waiting for a late first lyric line (starts past the
             *   countdown threshold): the upcoming line prefixed with the
             *   seconds remaining, counting down.
             * - Otherwise: the sung/upcoming lyric line.
             * @param {PlaylistItem} item
             * @param {SyncedLyricLine[]} lines
             * @param {number} index active (or led) line index
             * @param {number} currentTime
             */
            lyricDisplayTextAt(item, lines, index, currentTime) {
                if (currentTime < SONG_IDENTITY_INTRO_SECONDS) {
                    return this.describeSongIdentity(item);
                }
                if (!lines.length) return '';
                const line = this.lyricTitleLineAt(lines, index);
                if (index < 0 && line) {
                    const firstLine = lines.find(candidate => candidate.text.trim());
                    const offset = this.lyricOffsetForItem(item);
                    // Wall-clock moment the first line becomes the highlight.
                    const firstAt = firstLine ? firstLine.time - offset : 0;
                    if (firstLine && firstAt > FIRST_LYRIC_COUNTDOWN_MIN_SECONDS) {
                        const wait = Math.ceil(firstAt - currentTime);
                        if (wait >= 1) {
                            return `${wait} ${line}`;
                        }
                    }
                }
                return line;
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
             * PUSH the current display text into the now-playing surfaces
             * (Media Session metadata for car/lock-screen displays plus
             * the tab title). Writes are event-driven - the deadline clock
             * wakes exactly at lyric-line boundaries and display seconds -
             * and identical repeats are dropped by the core, so the car
             * gets one push per distinct text. Title is the sung lyric
             * line (plus identity intro / late-first-line countdown; see
             * lyricDisplayTextAt). Artist is always year - artist - name
             * while playing, so the car's second row keeps song identity.
             * With nothing to show the surfaces clear.
             * @param {string} primaryText
             * @param {string} secondaryText
             */
            relayListeningTextToNowPlaying(primaryText, secondaryText) {
                const item = this.playingPlaylistItem();
                const playingThisItem = !!item && this.isPlaying && !this.isPaused;
                const enabled = this.settings.lyricsOnNowPlaying && playingThisItem;
                const primary = enabled ? String(primaryText || '').trim() : '';
                const secondary = enabled ? String(secondaryText || '').trim() : '';

                if (primary || secondary) {
                    // Re-arm session ownership before the push: the silent
                    // keep-alive can be paused out from under us, after which
                    // Chrome routes the car to the YouTube iframe.
                    MediaSessionCore.ensurePlayingSession();
                    MediaSessionCore.setDisplayLines(primary, secondary);
                    this.nowPlayingShowsText = true;
                } else if (this.nowPlayingShowsText) {
                    this.nowPlayingShowsText = false;
                    MediaSessionCore.clearDisplayLine();
                    MediaSessionCore.clearSecondaryDisplayLine();
                }
            },

            /**
             * The row's lyric state marker: ✓ = timed (best / line-synced),
             * ~ = non-timed (simple text only), … = looking, – = none,
             * ! = failed, · = not looked up yet.
             * @param {PlaylistItem} item
             * @returns {{ label: string, className: string, aria: string }}
             */
            lyricsRowMarker(item) {
                if (item.lyricsStatus === 'loading') {
                    return { label: '\u2026', className: '', aria: 'Looking up lyrics' };
                }
                if (item.lyricsStatus === 'ready' && item.lyricsData) {
                    return item.lyricsData.syncedLines.length > 0
                        ? { label: '\u2713', className: 'timed', aria: 'Timed lyrics (line-synced) - tap to view' }
                        : { label: '~', className: 'simple', aria: 'Simple lyrics (text only) - tap to view' };
                }
                if (item.lyricsStatus === 'not_found') {
                    return { label: '\u2013', className: 'none', aria: 'No lyrics found - tap to retry' };
                }
                if (item.lyricsStatus === 'error') {
                    return { label: '!', className: 'none', aria: 'Lyrics lookup failed - tap to retry' };
                }
                return { label: '\u00b7', className: '', aria: 'Get lyrics' };
            },

            refreshLyricsRowButton(item) {
                const row = document.querySelector(`[data-item-id="${item.id}"]`);
                const button = /** @type {HTMLButtonElement | null} */ (row?.querySelector('.lyrics-row-btn'));
                if (!button) return;
                const marker = this.lyricsRowMarker(item);
                button.classList.toggle('timed', marker.className === 'timed');
                button.classList.toggle('simple', marker.className === 'simple');
                button.classList.toggle('none', marker.className === 'none');
                button.textContent = marker.label;
                button.setAttribute('aria-label', marker.aria);
                button.title = marker.aria;
                if (this.currentLyricsItemId === item.id || this.currentPlayingId === item.id) {
                    this.updateBigLyricsAvailability();
                }
                // Timed-only filter depends on lyric state; refresh when a row settles.
                if (this.settings.playlistTimedOnly) this.applyPlaylistFilter();
            }
        }));
    }

    return { install };
})();

window.PlayerLyrics = PlayerLyrics;
