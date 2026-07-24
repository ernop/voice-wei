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
        /** @type {SongReportRequestState} */
        controller.songReportRequestState = {
            phase: 'idle',
            videoId: null,
            startedAt: 0,
            elapsedMs: 0,
            provider: null,
            model: '',
            returnedCharacters: 0,
            returnedLines: 0,
            error: ''
        };
        /** @type {number | null} */
        controller.songReportRequestTimer = null;
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
- Return exactly one continuous plain-text prose block made of crisp, varied sentences that make sense when wrapped into short display lines.
- Do not return JSON, Markdown, headings, bullets, labels, citations, source lists, prefatory language, or any text outside that prose block.
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
                    this.addMessage('error', 'Song report request', 'No song is playing or selected');
                    return;
                }

                const provider = /** @type {'claude' | 'openai'} */ (this.settings.aiProvider);
                const model = provider === 'openai'
                    ? this.settings.openaiModel
                    : this.settings.claudeModel;
                const providerName = provider === 'openai' ? 'OpenAI' : 'Claude';
                const itemName = this.truncateForStatus(this.describePlaylistItem(item), 80);
                const startedAt = Date.now();
                this.songReportRequestInFlight = true;
                this.songReportRequestState = {
                    phase: 'sending',
                    videoId: item.videoId,
                    startedAt,
                    elapsedMs: 0,
                    provider,
                    model,
                    returnedCharacters: 0,
                    returnedLines: 0,
                    error: ''
                };
                this.updateSongReportControls();
                this.updateStatus(`Sending song report request: ${itemName}`);
                this.addMessage(
                    'claude',
                    'Song report request',
                    `Starting ${providerName} (${model}) research for ${this.describePlaylistItem(item)}`
                );

                try {
                    const prompt = this.buildSongReportPrompt(item);
                    const research = this.requestSongReportResearch(prompt);
                    this.songReportRequestState = {
                        ...this.songReportRequestState,
                        phase: 'waiting',
                        elapsedMs: Date.now() - startedAt
                    };
                    this.updateSongReportControls();
                    this.addMessage(
                        'claude',
                        'Song report request sent',
                        `${providerName} (${model}); waiting for the provider response`
                    );
                    this.songReportRequestTimer = window.setInterval(() => {
                        if (this.songReportRequestState.phase !== 'waiting') return;
                        this.songReportRequestState = {
                            ...this.songReportRequestState,
                            elapsedMs: Date.now() - startedAt
                        };
                        this.updateSongReportControls();
                    }, 1000);

                    const result = await research;
                    const elapsedMs = Date.now() - startedAt;
                    this.songReportRequestState = {
                        ...this.songReportRequestState,
                        phase: 'received',
                        elapsedMs,
                        provider: result.provider,
                        model: result.model,
                        returnedCharacters: result.text.length
                    };
                    this.updateSongReportControls();
                    this.addMessage(
                        'claude',
                        'Song report response received',
                        `${result.provider === 'openai' ? 'OpenAI' : 'Claude'} (${result.model}) returned `
                        + `${result.text.length} characters in ${this.formatSongReportElapsed(elapsedMs)}`
                    );
                    this.addMessage('claude', 'Song report returned prose', result.text);

                    const lines = this.segmentSongReport(result.text);
                    if (lines.length === 0) {
                        throw new Error('The song report response was empty');
                    }
                    this.songReportRequestState = {
                        ...this.songReportRequestState,
                        returnedLines: lines.length
                    };
                    this.addMessage('claude', 'Song report split', JSON.stringify({
                        maximumCharactersPerLine: SONG_REPORT_LINE_MAX_CHARS,
                        lineCount: lines.length,
                        lines
                    }, null, 2));

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
                    this.addMessage(
                        'claude',
                        'Song report saved',
                        `${lines.length} lines saved for ${this.describePlaylistItem(item)}`
                    );
                    this.settings.songDisplayMode = 'report';
                    this.saveSettings();
                    this.songReportAnchorVideoId = item.videoId;
                    this.songReportAnchorTime = this.currentPlayingId === item.id
                        ? this.currentPlaybackTime()
                        : 0;
                    this.updateSongReportControls();
                    this.updateListeningTextPosition(this.currentPlaybackTime());
                    this.resyncProgressClock();
                    this.songReportRequestState = {
                        ...this.songReportRequestState,
                        phase: 'playing'
                    };
                    this.addMessage(
                        'claude',
                        'Song report playback',
                        `Started line 1 of ${lines.length} at ${this.songReportAnchorTime.toFixed(1)}s; `
                        + `advancing every ${this.settings.songReportIntervalSeconds}s`
                    );
                    this.updateSongReportControls();
                    this.updateStatus(`Song report ready: ${lines.length} lines`);
                } catch (error) {
                    this.songReportRequestState = {
                        ...this.songReportRequestState,
                        phase: 'failed',
                        elapsedMs: Date.now() - startedAt,
                        error: error instanceof Error ? error.message : String(error)
                    };
                    this.logError('Song Report Error', error);
                    this.updateStatus(`Song report failed: ${error instanceof Error ? error.message : String(error)}`);
                    if (error instanceof Error && error.name === 'ApiKeyError') {
                        this.showApiKeyProblem(error);
                    }
                } finally {
                    if (this.songReportRequestTimer !== null) {
                        window.clearInterval(this.songReportRequestTimer);
                        this.songReportRequestTimer = null;
                    }
                    this.songReportRequestInFlight = false;
                    this.updateSongReportControls();
                }
            },

            async activateSongReport() {
                if (this.songReportRequestInFlight) return;
                const item = this.playingPlaylistItem() || this.currentPlaylistItem();
                if (!item) {
                    this.updateStatus('Play or select a song before requesting a report');
                    this.addMessage('error', 'Song report selection', 'No song is playing or selected');
                    return;
                }

                let record = this.songReportForItem(item);
                if (!record) {
                    this.addMessage(
                        'claude',
                        'Song report selection',
                        `Checking saved report for ${this.describePlaylistItem(item)}`
                    );
                    record = await this.loadSongReportForItem(item);
                }
                if (!record) {
                    this.addMessage(
                        'claude',
                        'Song report selection',
                        `No saved report for ${this.describePlaylistItem(item)}; requesting one`
                    );
                    await this.requestSongReport();
                    return;
                }

                this.setSongDisplayMode('report');
                this.addMessage(
                    'claude',
                    'Song report playback',
                    `Started saved report for ${this.describePlaylistItem(item)} at line 1`
                );
            },

            /** @param {number} elapsedMs */
            formatSongReportElapsed(elapsedMs) {
                const seconds = Math.max(0, elapsedMs) / 1000;
                return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
            },

            /** @param {'identity' | 'report'} mode */
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
                const identityButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('songDisplayIdentityBtn'));
                const reportButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('songDisplayReportBtn'));
                const interval = document.getElementById('songReportIntervalValue');
                const status = document.getElementById('songReportStatus');
                const effectiveMode = this.settings.songDisplayMode === 'report' && record
                    ? 'report'
                    : 'identity';
                const requestState = item && this.songReportRequestState.videoId === item.videoId
                    ? this.songReportRequestState
                    : null;
                const requestActive = requestState
                    && (requestState.phase === 'sending'
                        || requestState.phase === 'waiting'
                        || requestState.phase === 'received');
                const elapsedSeconds = requestState
                    ? Math.floor(requestState.elapsedMs / 1000)
                    : 0;
                const lifecycleLabel = requestState?.phase === 'sending'
                    ? 'Sending Report'
                    : requestState?.phase === 'waiting'
                        ? `Waiting ${elapsedSeconds}s`
                        : requestState?.phase === 'received'
                            ? `Received ${requestState.returnedCharacters} chars`
                            : '';

                if (requestButton) {
                    requestButton.disabled = !item || this.songReportRequestInFlight;
                    requestButton.textContent = requestActive
                        ? lifecycleLabel
                        : (record ? 'Refresh Song Report' : 'Request Song Report');
                }
                if (identityButton) {
                    identityButton.classList.toggle('selected', effectiveMode === 'identity' && !requestActive);
                    identityButton.setAttribute('aria-pressed', String(effectiveMode === 'identity' && !requestActive));
                }
                if (reportButton) {
                    const reportSelected = effectiveMode === 'report' || Boolean(requestActive);
                    reportButton.disabled = !item || this.songReportRequestInFlight;
                    reportButton.textContent = requestActive
                        ? lifecycleLabel
                        : (requestState?.phase === 'playing' && effectiveMode === 'report'
                            ? `Playing ${requestState.returnedLines} lines`
                            : (requestState?.phase === 'failed' ? 'Retry Song Report' : 'Song Report'));
                    reportButton.classList.toggle('selected', reportSelected);
                    reportButton.setAttribute('aria-pressed', String(reportSelected));
                }
                if (interval) {
                    interval.textContent = `${this.settings.songReportIntervalSeconds}s`;
                }
                if (status) {
                    const providerName = requestState?.provider === 'openai' ? 'OpenAI' : 'Claude';
                    const providerModel = requestState?.provider
                        ? `${providerName} ${requestState.model}`
                        : '';
                    if (requestState?.phase === 'sending') {
                        status.textContent = `Sending to ${providerModel}`;
                    } else if (requestState?.phase === 'waiting') {
                        status.textContent = `${providerModel} · waiting ${elapsedSeconds}s without interrupting playback`;
                    } else if (requestState?.phase === 'received') {
                        status.textContent = `${providerModel} returned ${requestState.returnedCharacters} characters `
                            + `in ${this.formatSongReportElapsed(requestState.elapsedMs)}; splitting for playback`;
                    } else if (requestState?.phase === 'playing') {
                        status.textContent = `${providerModel} returned ${requestState.returnedCharacters} characters `
                            + `in ${this.formatSongReportElapsed(requestState.elapsedMs)}; playing `
                            + `${requestState.returnedLines} lines every ${this.settings.songReportIntervalSeconds}s`;
                    } else if (requestState?.phase === 'failed') {
                        status.textContent = `Report failed after ${this.formatSongReportElapsed(requestState.elapsedMs)}: `
                            + requestState.error;
                    } else {
                        status.textContent = record
                            ? `${record.lines.length} saved lines`
                            : 'No saved report; Song Report will request one';
                    }
                }
            }
        }));
    }

    return { install };
})();

window.PlayerSongReport = PlayerSongReport;
