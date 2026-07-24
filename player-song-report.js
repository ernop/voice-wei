// @ts-check
// AI-researched song reports: request, persistence, segmentation, controls,
// and timing. The existing player deadline clock renders these lines.

const SONG_REPORT_LINE_MAX_CHARS = 50;
const SONG_REPORT_INTERVAL_VALUES = Object.freeze([3, 4, 5, 6, 8, 10, 12, 15, 20, 30]);

const PlayerSongReport = (function () {
    'use strict';

    /** @param {VoiceMusicController} controller */
    function install(controller) {
        /** @type {Map<string, SongReportRecord>} */
        controller.songReports = new Map();
        /** @type {Map<string, Promise<SongReportRecord | null>>} */
        controller.songReportLoadsInFlight = new Map();
        controller.songReportRequestInFlight = false;
        controller.songReportAnchorVideoId = null;
        controller.songReportAnchorTime = 0;

        Object.assign(controller, /** @type {ThisType<VoiceMusicController>} */ ({
            /** @param {PlaylistItem | null | undefined} item */
            songReportForItem(item) {
                if (!item) return null;
                return this.songReports.get(item.videoId) || null;
            },

            /** @param {PlaylistItem} item */
            buildSongReportPrompt(item) {
                const durationSeconds = Math.max(Number(item.durationSeconds) || 180, 60);
                const targetLines = Math.min(
                    60,
                    Math.max(12, Math.ceil(durationSeconds / this.settings.songReportIntervalSeconds))
                );
                const targetChars = targetLines * 42;
                const identity = [
                    `Song: ${item.name || item.title || 'Unknown'}`,
                    `Artist: ${item.artist || item.channelTitle || 'Unknown'}`,
                    item.album ? `Album: ${item.album}` : '',
                    item.year ? `Year: ${item.year}` : '',
                    item.comment ? `Existing playlist note: ${item.comment}` : ''
                ].filter(Boolean).join('\n');

                return `Research this exact song on the web, then write a fascinating, appreciative listening companion that will appear one short line at a time while the recording plays.

${identity}

Investigate broadly before writing. Use only notable, well-supported material. Draw from whichever of these areas genuinely yields something interesting:
- literary analysis: narrative, themes, imagery, symbolism, allusions, locations, cultural references, title, and the relationship between words and music
- the writing and recording story, arrangement, production, performances, musical influences, and artistic choices
- the artists' personal and band history at the time, creative relationships, and well-sourced interpersonal stories sometimes described as gossip
- career, business, money, label, chart, sales, awards, audience, critical reception, and later influence
- real places, people, events, books, films, traditions, or scenes connected to the song

Rules:
- Be factual. Do not invent, speculate, repeat unsupported rumors, or make invasive claims.
- Keep the tone positive, warm, and interesting. Omit negative, dull, uncertain, or unsupported material instead of mentioning its absence.
- Do not quote or reproduce the lyrics. Analyze and paraphrase them.
- Do not use headings, bullets, labels, citations, source lists, or prefatory language.
- Return only continuous plain prose made of crisp, varied sentences that make sense when wrapped into short display lines.
- Aim for about ${targetChars} characters total, enough for roughly ${targetLines} display lines.`;
            },

            /**
             * Wrap report prose into short, readable display lines. Prefer a
             * nearby punctuation boundary, then a word boundary; never exceed
             * the car-display budget.
             * @param {string} reportText
             * @param {number} [maxChars]
             */
            segmentSongReport(reportText, maxChars = SONG_REPORT_LINE_MAX_CHARS) {
                const lines = [];
                let remaining = String(reportText || '').replace(/\s+/g, ' ').trim();
                const minimumNaturalBreak = Math.floor(maxChars * 0.6);

                while (remaining) {
                    if (remaining.length <= maxChars) {
                        lines.push(remaining);
                        break;
                    }

                    let cut = -1;
                    for (let i = maxChars - 1; i >= minimumNaturalBreak; i--) {
                        if (/[.!?;,:]/.test(remaining[i]) && /\s/.test(remaining[i + 1] || '')) {
                            cut = i + 1;
                            break;
                        }
                    }
                    if (cut < 0) {
                        cut = remaining.lastIndexOf(' ', maxChars);
                    }
                    if (cut <= 0) {
                        cut = maxChars;
                    }

                    lines.push(remaining.slice(0, cut).trim());
                    remaining = remaining.slice(cut).trim();
                }

                return lines.filter(Boolean);
            },

            /** @param {PlaylistItem} item */
            async loadSongReportForItem(item) {
                const cached = this.songReportForItem(item);
                if (cached) {
                    this.updateSongReportControls();
                    return cached;
                }

                let flight = this.songReportLoadsInFlight.get(item.videoId);
                if (!flight) {
                    flight = window.PlayerHistoryDB.getSongReport(item.videoId);
                    this.songReportLoadsInFlight.set(item.videoId, flight);
                }

                try {
                    const record = await flight;
                    if (record && Array.isArray(record.lines) && record.lines.length > 0) {
                        this.songReports.set(item.videoId, record);
                    }
                    return record;
                } catch (error) {
                    this.logError('Song Report Load Error', error);
                    this.updateStatus(`Could not load saved song report: ${error instanceof Error ? error.message : String(error)}`);
                    return null;
                } finally {
                    if (this.songReportLoadsInFlight.get(item.videoId) === flight) {
                        this.songReportLoadsInFlight.delete(item.videoId);
                    }
                    this.updateSongReportControls();
                    if (this.currentPlayingId === item.id) {
                        this.resyncProgressClock();
                    }
                }
            },

            /**
             * Explicitly research the selected/sounding song. Playback is
             * untouched; when the response lands, report line one starts at
             * the current media time.
             */
            async requestSongReport() {
                if (this.songReportRequestInFlight) return;
                const item = this.playingPlaylistItem() || this.currentPlaylistItem();
                if (!item) {
                    this.updateStatus('Play or select a song before requesting a report');
                    return;
                }

                this.songReportRequestInFlight = true;
                this.updateSongReportControls();
                this.updateStatus(`Researching song report: ${this.truncateForStatus(this.describePlaylistItem(item), 80)}`);

                try {
                    const prompt = this.buildSongReportPrompt(item);
                    const result = await this.requestSongReportResearch(prompt);
                    const lines = this.segmentSongReport(result.text);
                    if (lines.length === 0) {
                        throw new Error('The song report response was empty');
                    }

                    /** @type {SongReportRecord} */
                    const record = {
                        videoId: item.videoId,
                        generatedAt: Date.now(),
                        provider: result.provider,
                        model: result.model,
                        prompt,
                        reportText: result.text,
                        lines
                    };
                    await window.PlayerHistoryDB.putSongReport(record);
                    this.songReports.set(item.videoId, record);
                    this.settings.songDisplayMode = 'report';
                    this.saveSettings();
                    this.songReportAnchorVideoId = item.videoId;
                    this.songReportAnchorTime = this.currentPlayingId === item.id
                        ? this.currentPlaybackTime()
                        : 0;
                    this.updateSongReportControls();
                    this.updateListeningTextPosition(this.currentPlaybackTime());
                    this.resyncProgressClock();
                    this.updateStatus(`Song report ready: ${lines.length} lines`);
                } catch (error) {
                    this.logError('Song Report Error', error);
                    this.updateStatus(`Song report failed: ${error instanceof Error ? error.message : String(error)}`);
                    if (error instanceof Error && error.name === 'ApiKeyError') {
                        this.showApiKeyProblem(error);
                    }
                } finally {
                    this.songReportRequestInFlight = false;
                    this.updateSongReportControls();
                }
            },

            /** @param {'lyrics' | 'report'} mode */
            setSongDisplayMode(mode) {
                const item = this.playingPlaylistItem() || this.currentPlaylistItem();
                if (mode === 'report' && !this.songReportForItem(item)) return;
                this.settings.songDisplayMode = mode;
                if (mode === 'report' && item) {
                    this.songReportAnchorVideoId = item.videoId;
                    this.songReportAnchorTime = this.currentPlayingId === item.id
                        ? this.currentPlaybackTime()
                        : 0;
                }
                this.saveSettings();
                this.updateSongReportControls();
                this.updateListeningTextPosition(this.currentPlaybackTime());
                this.resyncProgressClock();
            },

            /** @param {-1 | 1} direction */
            stepSongReportInterval(direction) {
                const values = SONG_REPORT_INTERVAL_VALUES;
                const current = this.settings.songReportIntervalSeconds;
                let index = values.indexOf(current);
                if (index < 0) {
                    index = values.reduce((best, value, candidate) =>
                        Math.abs(value - current) < Math.abs(values[best] - current) ? candidate : best, 0);
                }
                const next = values[Math.max(0, Math.min(values.length - 1, index + direction))];
                if (next === current) return;

                const item = this.playingPlaylistItem();
                const now = this.currentPlaybackTime();
                const currentLine = item ? this.songReportLineIndexAt(item, now) : 0;
                this.settings.songReportIntervalSeconds = next;
                if (item && this.songReportForItem(item)) {
                    this.songReportAnchorVideoId = item.videoId;
                    this.songReportAnchorTime = now - (currentLine * next);
                }
                this.saveSettings();
                this.updateSongReportControls();
                this.updateListeningTextPosition(now);
                this.resyncProgressClock();
            },

            /** @param {PlaylistItem} item */
            resetSongReportForPlay(item) {
                this.songReportAnchorVideoId = item.videoId;
                this.songReportAnchorTime = 0;
                void this.loadSongReportForItem(item);
                this.updateSongReportControls();
            },

            clearSongReportPlayback() {
                this.songReportAnchorVideoId = null;
                this.songReportAnchorTime = 0;
                this.updateSongReportControls();
            },

            /** @param {PlaylistItem} item @param {number} currentTime */
            songReportLineIndexAt(item, currentTime) {
                const record = this.songReportForItem(item);
                if (!record || record.lines.length === 0) return -1;
                const anchor = this.songReportAnchorVideoId === item.videoId
                    ? this.songReportAnchorTime
                    : 0;
                const elapsed = Math.max(0, currentTime - anchor);
                return Math.min(
                    Math.floor(elapsed / this.settings.songReportIntervalSeconds),
                    record.lines.length - 1
                );
            },

            /** @param {PlaylistItem | null | undefined} item @param {number} currentTime */
            songReportTextAt(item, currentTime) {
                if (this.settings.songDisplayMode !== 'report' || !item) return '';
                const record = this.songReportForItem(item);
                if (!record) return '';
                const index = this.songReportLineIndexAt(item, currentTime);
                return index >= 0 ? record.lines[index] : '';
            },

            /** @param {number} currentTime */
            nextSongReportDeadline(currentTime) {
                const item = this.playingPlaylistItem();
                if (this.settings.songDisplayMode !== 'report' || !item) return Infinity;
                const record = this.songReportForItem(item);
                if (!record || record.lines.length < 2) return Infinity;
                const index = this.songReportLineIndexAt(item, currentTime);
                if (index < 0 || index >= record.lines.length - 1) return Infinity;
                const anchor = this.songReportAnchorVideoId === item.videoId
                    ? this.songReportAnchorTime
                    : 0;
                return anchor + ((index + 1) * this.settings.songReportIntervalSeconds);
            },

            updateSongReportControls() {
                const item = this.playingPlaylistItem() || this.currentPlaylistItem();
                const record = this.songReportForItem(item);
                const requestButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('requestSongReportBtn'));
                const lyricsButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('songDisplayLyricsBtn'));
                const reportButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('songDisplayReportBtn'));
                const interval = document.getElementById('songReportIntervalValue');
                const status = document.getElementById('songReportStatus');
                const effectiveMode = this.settings.songDisplayMode === 'report' && record
                    ? 'report'
                    : 'lyrics';

                if (requestButton) {
                    requestButton.disabled = !item || this.songReportRequestInFlight;
                    requestButton.textContent = this.songReportRequestInFlight
                        ? 'Researching Report'
                        : (record ? 'Refresh Song Report' : 'Request Song Report');
                }
                if (lyricsButton) {
                    lyricsButton.classList.toggle('selected', effectiveMode === 'lyrics');
                    lyricsButton.setAttribute('aria-pressed', String(effectiveMode === 'lyrics'));
                }
                if (reportButton) {
                    reportButton.disabled = !record;
                    reportButton.classList.toggle('selected', effectiveMode === 'report');
                    reportButton.setAttribute('aria-pressed', String(effectiveMode === 'report'));
                }
                if (interval) {
                    interval.textContent = `${this.settings.songReportIntervalSeconds}s`;
                }
                if (status) {
                    status.textContent = this.songReportRequestInFlight
                        ? 'Researching without interrupting playback'
                        : (record ? `${record.lines.length} saved lines` : 'No saved report for this song');
                }
            }
        }));
    }

    return { install };
})();

window.PlayerSongReport = PlayerSongReport;
