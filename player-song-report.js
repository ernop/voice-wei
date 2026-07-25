// @ts-check
// AI-researched song reports: request, persistence, note scheduling,
// controls, and timing. Notes tied to a lyric line play at that line's sung
// moment; general notes fill the gaps. The existing player deadline clock
// renders the schedule.

const SONG_REPORT_LINE_MAX_CHARS = 50;
// A brief blank on the second display line between consecutive report notes,
// so a new note is visibly a new note.
const SONG_REPORT_BLANK_SECONDS = 0.2;
const SONG_REPORT_INTERVAL_VALUES = Object.freeze([
    0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30
]);

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

            /**
             * The song's stored lyrics as plain text for the research
             * prompt: timed lines joined in order when present, otherwise
             * the plain lyric text. Empty string when nothing is stored.
             * @param {PlaylistItem} item
             */
            songReportLyricsText(item) {
                const lyrics = item.lyricsData;
                if (!lyrics) return '';
                const syncedText = (lyrics.syncedLines || [])
                    .map(line => String(line.text || '').trim())
                    .filter(Boolean)
                    .join('\n');
                return syncedText || String(lyrics.plainLyrics || '').trim();
            },

            /** @param {PlaylistItem} item */
            buildSongReportPrompt(item) {
                const durationSeconds = Math.max(Number(item.durationSeconds) || 180, 60);
                // Note count follows the song's length at a listening pace,
                // never the transient display-interval setting.
                const targetNotes = Math.min(40, Math.max(8, Math.round(durationSeconds / 15)));
                const identity = [
                    `Song: ${item.name || item.title || 'Unknown'}`,
                    `Artist: ${item.artist || item.channelTitle || 'Unknown'}`,
                    item.album ? `Album: ${item.album}` : '',
                    item.year ? `Year: ${item.year}` : '',
                    item.comment ? `Existing playlist note: ${item.comment}` : ''
                ].filter(Boolean).join('\n');

                const syncedLines = item.lyricsData ? item.lyricsData.syncedLines || [] : [];
                const numberedLyrics = syncedLines
                    .map((line, index) => `${index + 1} | ${line.text}`)
                    .join('\n');
                const plainLyrics = this.songReportLyricsText(item);
                const hasNumberedLyrics = numberedLyrics.trim().length > 0;
                const lyricsBlock = hasNumberedLyrics
                    ? `\nFull lyrics of the song, one line per row, numbered:\n${numberedLyrics}\n`
                    : (plainLyrics ? `\nFull lyrics of the song:\n${plainLyrics}\n` : '');
                const lyricRules = hasNumberedLyrics
                    ? `- Tie each note to the numbered lyric line it discusses whenever the material concerns a specific part of the song; use general notes for everything else.
- Do include the lyrics: quote lyric words inside a note when the note discusses them, quoting only from the numbered lyrics above.`
                    : (plainLyrics
                        ? `- There are no numbered lyric lines, so put every note in generalNotes.
- Do include the lyrics: quote lyric words inside a note when the note discusses them, quoting only from the lyrics above.`
                        : `- No lyrics are available, so put every note in generalNotes and do not quote any lyrics.`);

                return `Research this exact song on the web, then report what you find as short listening notes. Each note appears on the player's second display line while the recording plays; a note tied to a lyric line appears exactly when that line is sung.

${identity}
${lyricsBlock}
You are a careful reporter, not a creative writer or stylist. Your job is to convey other people's documented words, findings, and interpretations accurately. This is not your place to invent analysis, motives, emotions, symbolism, causal stories, connective details, or color. The song-identifying metadata above is research context only, not material to repeat in the report.

Investigate broadly before writing. Use only notable, well-supported material that you actually found in sources. Draw from whichever of these areas genuinely yields something interesting:
- published literary or critical analysis: narrative, themes, imagery, symbolism, allusions, locations, cultural references, title, and the relationship between words and music
- the writing and recording story, arrangement, production, performances, musical influences, and artistic choices
- the artists' personal and band history at the time, creative relationships, and well-sourced interpersonal stories sometimes described as gossip
- career, business, money, chart, sales, awards, audience, critical reception, and later influence
- real places, people, events, books, films, traditions, or scenes connected to the song
- separate research prompted by distinctive words, phrases, places, terms, people, objects, events, or ideas in the lyrics; report useful sourced context even when no source connects it to the song

Rules:
- Every factual claim and interpretation must be traceable to material you found. Keep source attribution out of lyricNotes and generalNotes; put it only in the final attributions list.
- Do not add your own interpretation or inference. Do not invent, speculate, embellish, repeat unsupported rumors, or make invasive claims.
- Select positive, interesting, well-supported material, but never soften, intensify, or change a source's meaning to improve the tone.
${lyricRules}
- Display notes must state only the sourced idea. Never name or refer to a critic, reviewer, magazine, publication, or other source in a note, and never use phrases such as "critics said" or "according to."
- Never put a raw URL anywhere in the response, including attributions.
- Never mention the song title, album title, release date, release year, or record label in a note. The listener already knows them.
- Put any source names and attribution details in attributions, after lyricNotes and generalNotes. Attributions are retained with the research response but never displayed as notes.
- Use ordinary, literal English. Do not imitate musicians, critics, journalists, insiders, or a cool persona. Replace trade slang and affected shorthand with plain words: say "recorded live," never "cut live."
- Write short, direct, information-dense sentences of at most 80 characters per note. Do not add scene-setting, flourishes, clever transitions, or generic praise.
- Aim for roughly ${targetNotes} notes in total.

Write every note under George Orwell's six rules, reproduced here verbatim:
i. Never use a metaphor, simile or other figure of speech which you are used to seeing in print.
ii. Never use a long word where a short one will do.
iii. If it is possible to cut a word out, always cut it out.
iv. Never use the passive where you can use the active.
v. Never use a foreign phrase, a scientific word or a jargon word if you can think of an everyday English equivalent.
vi. Break any of these rules sooner than say anything outright barbarous.
- Return only JSON in exactly this shape, with no text outside it:
{"lyricNotes":[{"line":<numbered lyric line>,"note":"<short sentence>"}],"generalNotes":["<short sentence>"],"attributions":["<source name and supported idea; no URL>"]}`;
            },

            /**
             * Display notes never carry citations or URLs. The prompt
             * forbids them; this boundary strips any that slip through a
             * provider response. A note that was nothing but a citation
             * disappears from display - the raw response with its
             * attributions stays in the stored record and the Log.
             * @param {string} noteText
             */
            sanitizeSongReportNote(noteText) {
                const original = String(noteText || '').replace(/\s+/g, ' ').trim();
                // Markdown links keep their visible words.
                let text = original.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
                // Bare URLs and domain paths disappear; stop before a
                // closing bracket so surrounding punctuation survives.
                text = text.replace(/\bhttps?:\/\/[^\s)\]]+/gi, ' ');
                text = text.replace(/\bwww\.[^\s)\]]+/gi, ' ');
                text = text.replace(/\b[\w-]+\.(?:com|org|net|edu|gov|io|co|fm|tv|uk|de|fr)\b(?:\/[^\s)\]]*)?/gi, ' ');
                // Numeric citation markers such as [3] or [1, 2].
                text = text.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, ' ');
                // Brackets and parens left empty by the removals.
                text = text.replace(/\(\s*\)|\[\s*\]/g, ' ');
                text = text.replace(/\s+([.,;:!?])/g, '$1');
                text = text.replace(/\s+/g, ' ').trim();
                // A cleaned note this short was mostly citation; it has no
                // displayable idea left.
                if (text !== original && text.length < 20) return '';
                return text;
            },

            /**
             * Turn the model's JSON response into report entries. Notes tied
             * to a valid numbered lyric line carry that line's sung time;
             * everything else is a general (untimed) note.
             * @param {string} responseText
             * @param {PlaylistItem} item
             * @returns {SongReportEntry[]}
             */
            parseSongReportResponse(responseText, item) {
                const source = String(responseText || '');
                const start = source.indexOf('{');
                const end = source.lastIndexOf('}');
                if (start < 0 || end <= start) {
                    throw new Error('The song report response did not contain the required JSON');
                }
                /** @type {{ lyricNotes?: Array<{ line?: number, note?: string }>, generalNotes?: string[] }} */
                let parsed;
                try {
                    parsed = JSON.parse(source.slice(start, end + 1));
                } catch (error) {
                    throw new Error('The song report response JSON could not be parsed');
                }

                const syncedLines = item.lyricsData ? item.lyricsData.syncedLines || [] : [];
                /** @type {SongReportEntry[]} */
                const entries = [];
                for (const note of parsed.lyricNotes || []) {
                    const text = this.sanitizeSongReportNote(note?.note);
                    if (!text) continue;
                    const lineNumber = Number(note?.line);
                    const synced = Number.isInteger(lineNumber) ? syncedLines[lineNumber - 1] : undefined;
                    entries.push({ time: synced ? synced.time : null, text });
                }
                for (const note of parsed.generalNotes || []) {
                    const text = this.sanitizeSongReportNote(note);
                    if (text) entries.push({ time: null, text });
                }
                if (entries.length === 0) {
                    throw new Error('The song report contained no notes');
                }
                return entries;
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
                    if (record) {
                        // Records saved before timed notes carry only display
                        // lines; migrate them to untimed entries on load.
                        const entries = Array.isArray(record.entries) && record.entries.length > 0
                            ? record.entries
                            : (Array.isArray(record.lines)
                                ? record.lines.map(text => ({ time: null, text }))
                                : []);
                        if (entries.length > 0) {
                            const migrated = { ...record, entries };
                            this.songReports.set(item.videoId, migrated);
                            return migrated;
                        }
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
             * untouched; when the response lands, lyric-anchored notes play
             * at their sung moments and general notes fill the gaps.
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
                const providerKey = provider === 'openai'
                    ? this.config?.openaiApiKey
                    : this.config?.claudeApiKey;
                if (!providerKey) {
                    const message = `${providerName} API key not configured`;
                    this.updateStatus(`Song report unavailable: ${message}`);
                    this.addMessage('error', 'Song report request', message);
                    return;
                }
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
                    // The prompt carries the song's full lyrics, so resolve
                    // them through the normal lyric store path first.
                    await this.ensureLyricsForItem(item);
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
                    this.addMessage('claude', 'Song report returned notes', result.text);

                    const entries = this.parseSongReportResponse(result.text, item);
                    const anchoredCount = entries.filter(entry => typeof entry.time === 'number').length;
                    this.songReportRequestState = {
                        ...this.songReportRequestState,
                        returnedLines: entries.length
                    };
                    this.addMessage('claude', 'Song report notes parsed', JSON.stringify({
                        noteCount: entries.length,
                        lyricAnchoredNotes: anchoredCount,
                        generalNotes: entries.length - anchoredCount,
                        entries
                    }, null, 2));

                    /** @type {SongReportRecord} */
                    const record = {
                        videoId: item.videoId,
                        generatedAt: Date.now(),
                        provider: result.provider,
                        model: result.model,
                        prompt,
                        reportText: result.text,
                        entries
                    };
                    await window.PlayerHistoryDB.putSongReport(record);
                    this.songReports.set(item.videoId, record);
                    this.addMessage(
                        'claude',
                        'Song report saved',
                        `${entries.length} notes saved for ${this.describePlaylistItem(item)}`
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
                        `Started ${entries.length} notes (${anchoredCount} at their sung lyric moments, `
                        + `${entries.length - anchoredCount} general)`
                    );
                    this.updateSongReportControls();
                    this.updateStatus(`Song report ready: ${entries.length} notes`);
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
                    `Started saved report for ${this.describePlaylistItem(item)} (${record.entries.length} notes)`
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
                const record = item ? this.songReportForItem(item) : null;
                const anchoredNotes = !!record
                    && record.entries.some(entry => typeof entry.time === 'number');
                const currentLine = item ? this.songReportLineIndexAt(item, now) : 0;
                this.settings.songReportIntervalSeconds = next;
                // Lyric-anchored notes keep their absolute sung moments; only
                // the untimed sequence re-anchors to hold its current line.
                if (item && record && !anchoredNotes) {
                    this.songReportAnchorVideoId = item.videoId;
                    this.songReportAnchorTime = now - (Math.max(0, currentLine) * next);
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

            /**
             * The moments each display line appears. Lyric-anchored notes
             * play at their line's sung time; general notes fill the largest
             * gaps between them (or advance from the anchor at the display
             * interval when nothing is anchored). Notes longer than the
             * display budget wrap into consecutive interval-spaced segments.
             * @param {PlaylistItem} item
             * @returns {Array<{ at: number, text: string }>}
             */
            songReportSchedule(item) {
                const record = this.songReportForItem(item);
                if (!record || !Array.isArray(record.entries) || record.entries.length === 0) return [];
                const interval = this.settings.songReportIntervalSeconds;
                const anchored = record.entries
                    .filter(entry => typeof entry.time === 'number')
                    .map(entry => ({ at: /** @type {number} */ (entry.time), text: entry.text }))
                    .sort((a, b) => a.at - b.at);
                const untimed = record.entries.filter(entry => typeof entry.time !== 'number');

                if (anchored.length === 0) {
                    const anchor = this.songReportAnchorVideoId === item.videoId
                        ? this.songReportAnchorTime
                        : 0;
                    return untimed
                        .flatMap(entry => this.segmentSongReport(entry.text))
                        .map((text, index) => ({ at: anchor + (index * interval), text }));
                }

                const placed = [...anchored];
                const songEnd = Math.max(
                    Number(item.durationSeconds) || 0,
                    anchored[anchored.length - 1].at + 30
                );
                /** @type {Array<{ start: number, end: number }>} */
                const gaps = [{ start: 0, end: anchored[0].at }];
                for (let i = 0; i < anchored.length - 1; i++) {
                    gaps.push({ start: anchored[i].at, end: anchored[i + 1].at });
                }
                gaps.push({ start: anchored[anchored.length - 1].at, end: songEnd });
                for (const entry of untimed) {
                    gaps.sort((a, b) => (b.end - b.start) - (a.end - a.start));
                    const gap = gaps.shift();
                    if (!gap) break;
                    const at = gap.start + ((gap.end - gap.start) / 2);
                    placed.push({ at, text: entry.text });
                    gaps.push({ start: gap.start, end: at }, { start: at, end: gap.end });
                }

                /** @type {Array<{ at: number, text: string }>} */
                const schedule = [];
                for (const note of placed) {
                    this.segmentSongReport(note.text).forEach((text, index) => {
                        schedule.push({ at: note.at + (index * interval), text });
                    });
                }
                return schedule.sort((a, b) => a.at - b.at);
            },

            /** @param {PlaylistItem} item @param {number} currentTime */
            songReportLineIndexAt(item, currentTime) {
                const schedule = this.songReportSchedule(item);
                let index = -1;
                for (let i = 0; i < schedule.length; i++) {
                    if (schedule[i].at <= currentTime) index = i;
                    else break;
                }
                return index;
            },

            /**
             * What the second display line shows now: the scheduled note,
             * with a brief blank between consecutive notes so a new note is
             * visibly a change. The blank applies to the in-page display;
             * the Media Session relay carries the note itself.
             * @param {PlaylistItem | null | undefined} item
             * @param {number} currentTime
             * @returns {{ text: string, blank: boolean }}
             */
            songReportDisplayAt(item, currentTime) {
                if (this.settings.songDisplayMode !== 'report' || !item) {
                    return { text: '', blank: false };
                }
                const schedule = this.songReportSchedule(item);
                const index = this.songReportLineIndexAt(item, currentTime);
                if (index < 0) return { text: '', blank: false };
                const blank = index > 0
                    && (currentTime - schedule[index].at) < SONG_REPORT_BLANK_SECONDS;
                return { text: schedule[index].text, blank };
            },

            /** @param {number} currentTime */
            nextSongReportDeadline(currentTime) {
                const item = this.playingPlaylistItem();
                if (this.settings.songDisplayMode !== 'report' || !item) return Infinity;
                const schedule = this.songReportSchedule(item);
                let next = Infinity;
                for (let i = 0; i < schedule.length; i++) {
                    const moments = i > 0
                        ? [schedule[i].at, schedule[i].at + SONG_REPORT_BLANK_SECONDS]
                        : [schedule[i].at];
                    for (const at of moments) {
                        if (at > currentTime && at < next) next = at;
                    }
                }
                return next;
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
                            ? `Playing ${requestState.returnedLines} notes`
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
                            + `in ${this.formatSongReportElapsed(requestState.elapsedMs)}; parsing notes`;
                    } else if (requestState?.phase === 'playing') {
                        status.textContent = `${providerModel} returned ${requestState.returnedCharacters} characters `
                            + `in ${this.formatSongReportElapsed(requestState.elapsedMs)}; playing `
                            + `${requestState.returnedLines} notes at their lyric moments`;
                    } else if (requestState?.phase === 'failed') {
                        status.textContent = `Report failed after ${this.formatSongReportElapsed(requestState.elapsedMs)}: `
                            + requestState.error;
                    } else {
                        status.textContent = record
                            ? `${record.entries.length} saved notes`
                            : 'No saved report; Song Report will request one';
                    }
                }
            }
        }));
    }

    return { install };
})();

window.PlayerSongReport = PlayerSongReport;
