// @ts-check
// Voice command parsing, control execution, and LLM music search.

// Skip Claude API calls and return hardcoded test data (for debugging YouTube search)
const SKIP_CLAUDE = false;
const MUSIC_SEARCH_MAX_TOKENS = 16000;
const MUSIC_SOURCE_CHUNK_CHARS = 50000;

const PlayerCommands = (function () {
    'use strict';

    /** @param {VoiceMusicController} controller */
    function install(controller) {
        Object.assign(controller, /** @type {ThisType<VoiceMusicController>} */ ({
            parseControlCommand(transcript) {
                const lower = transcript.toLowerCase().trim();

                // Help command
                if (lower.match(/^(help|commands|what can (i|you) (say|do))/)) {
                    return 'help';
                }

                // What's playing command
                if (lower.match(/^(what('s| is) playing|current song|now playing|what song)/)) {
                    return 'whatsplaying';
                }

                // Clear playlist commands
                if (lower.match(/^(clear|empty|delete)(\s+(the\s+)?playlist)?$/)) {
                    return 'clear';
                }

                // Randomize/shuffle commands
                if (lower.match(/^(shuffle|randomize|random)(\s+(the\s+)?playlist)?$/)) {
                    return 'shuffle';
                }

                // Play commands
                if (lower.match(/^(play|start|resume|continue)(\s+(the\s+)?playlist)?$/)) {
                    return 'play';
                }

                // Pause commands
                if (lower.match(/^(pause|halt)(\s+(the\s+)?playback)?$/)) {
                    return 'pause';
                }

                // Stop commands
                if (lower.match(/^(stop)(\s+(the\s+)?playback)?$/)) {
                    return 'stop';
                }

                // Next commands
                if (lower.match(/^(next|skip|forward)(\s+(song|track))?$/)) {
                    return 'next';
                }

                // Previous commands
                if (lower.match(/^(previous|prev|back|last)(\s+(song|track))?$/)) {
                    return 'previous';
                }

                // Fast forward
                if (lower.match(/^(fast\s+forward|ff|advance|jump\s+forward)/)) {
                    return 'forward';
                }

                // Rewind
                if (lower.match(/^(rewind|backward|jump\s+back)/)) {
                    return 'rewind';
                }

                return null;
            },

            executeControlCommand(command) {
                switch (command) {
                    case 'help':
                        this.showHelp();
                        break;
                    case 'whatsplaying':
                        this.announceCurrentSong();
                        break;
                    case 'clear':
                        if (this.playlist.length === 0) {
                            this.updateStatus('Playlist is already empty');
                            this.speakText('Playlist is already empty');
                        } else {
                            const count = this.playlist.length;
                            this.clearPlaylist();
                            this.updateStatus('Playlist cleared');
                            this.speakText(`Cleared ${count} song${count > 1 ? 's' : ''} from playlist`);
                        }
                        break;
                    case 'shuffle':
                        if (this.playlist.length < 2) {
                            this.updateStatus('Need at least 2 songs to shuffle');
                            this.speakText('Need at least 2 songs to shuffle');
                        } else {
                            this.shufflePlaylist();
                            this.updateStatus('Playlist shuffled');
                            this.speakText('Playlist shuffled');
                        }
                        break;
                    case 'play':
                        if (this.playlist.length === 0) {
                            this.updateStatus('Playlist is empty - add some songs first');
                            this.speakText('Playlist is empty. Say something like "play some jazz" to add songs.');
                        } else {
                            this.playPlaylist();
                            this.updateStatus('Playing');
                        }
                        break;
                    case 'pause':
                        if (!this.isPlaying) {
                            this.updateStatus('Nothing is playing');
                        } else {
                            this.pausePlayback();
                            this.updateStatus('Paused');
                        }
                        break;
                    case 'stop':
                        this.stopPlayback();
                        this.updateStatus('Stopped');
                        break;
                    case 'next':
                        if (this.playlist.length === 0) {
                            this.updateStatus('Playlist is empty');
                        } else {
                            this.playNext();
                            this.updateStatus('Next song');
                        }
                        break;
                    case 'previous':
                        if (this.playlist.length === 0) {
                            this.updateStatus('Playlist is empty');
                        } else {
                            this.playPrevious();
                            this.updateStatus('Previous song');
                        }
                        break;
                    case 'forward':
                        if (!this.currentPlayingId) {
                            this.updateStatus('Nothing is playing');
                        } else {
                            this.fastForward();
                            this.updateStatus('Skipped forward 10 seconds');
                        }
                        break;
                    case 'rewind':
                        if (!this.currentPlayingId) {
                            this.updateStatus('Nothing is playing');
                        } else {
                            this.rewind();
                            this.updateStatus('Rewound 10 seconds');
                        }
                        break;
                }
            },

            showHelp() {
                const helpText = `Voice Commands: play, pause, stop, next, previous, fast forward, rewind, shuffle, clear, what's playing`;

                this.updateStatus(helpText);
                this.addMessage('user', 'Help:', 'play, pause, stop, next, previous, fast forward, rewind, shuffle, clear, what\'s playing');
                this.speakText('Voice commands: play, pause, stop, next, previous, fast forward, rewind, shuffle, clear, and what\'s playing.');
            },

            announceCurrentSong() {
                if (!this.currentPlayingId) {
                    this.updateStatus('Nothing is playing');
                    this.speakText('Nothing is currently playing');
                    return;
                }

                const currentItem = this.playlist.find(item => item.id === this.currentPlayingId);
                if (currentItem) {
                    const announcement = `Now playing: ${currentItem.title} by ${currentItem.channelTitle || 'Unknown Artist'}`;
                    this.updateStatus(announcement);
                    this.speakText(announcement);
                }
            },

            async processCommandWithLLM(transcript) {
                // Debug mode: skip API and return hardcoded test data
                if (SKIP_CLAUDE) {
                    this.addMessage('claude', 'DEBUG', 'Skipping API - using hardcoded Cecilia');
                    const testSongList = [{
                        name: "Cecilia",
                        artist: "Simon & Garfunkel",
                        year: "1970",
                        album: "Bridge Over Troubled Water",
                        comment: "DEBUG: Hardcoded test song",
                        searchTerm: "Simon & Garfunkel Cecilia"
                    }];
                    return { songList: testSongList, prompt: '[DEBUG MODE - API skipped]' };
                }

                // Use configured provider
                const provider = this.settings.aiProvider;

                if (provider === 'openai') {
                    return this.processCommandWithOpenAI(transcript);
                } else {
                    return this.processCommandWithClaude(transcript);
                }
            },

            async processCommandWithClaude(transcript) {
                if (!this.config || !this.config.claudeApiKey) {
                    throw new Error('Claude API key not configured');
                }

                const request = await this.prepareMusicSearchRequest(transcript);
                const prompts = this.getMusicSearchPrompts(request);
                const songLists = [];

                for (let i = 0; i < prompts.length; i++) {
                    const prompt = prompts[i];
                    let responseText = '';
                    const requestBody = {
                        model: this.settings.claudeModel,
                        max_tokens: MUSIC_SEARCH_MAX_TOKENS,
                        messages: [{
                            role: 'user',
                            content: prompt
                        }]
                    };

                    this.logClaudeMessage(`Music search request to Claude (${this.settings.claudeModel}) batch ${i + 1}/${prompts.length}`);
                    this.addMessage('claude', `Claude request (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(requestBody, null, 2));

                    try {
                        const response = await fetch('https://api.anthropic.com/v1/messages', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-api-key': this.config.claudeApiKey,
                                'anthropic-version': '2023-06-01',
                                'anthropic-dangerous-direct-browser-access': 'true'
                            },
                            body: JSON.stringify(requestBody)
                        });

                        if (!response.ok) {
                            const error = await response.json();
                            this.addMessage('error', `Claude response (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(error, null, 2));
                            throw new Error(error.error?.message || 'Claude API request failed');
                        }

                        const data = await response.json();
                        this.addMessage('claude', `Claude response (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(data, null, 2));
                        responseText = data.content[0].text.trim();
                    } catch (error) {
                        this.logError('Claude API Error', error);
                        throw error;
                    }

                    songLists.push(this.parseAIResponse(responseText, prompt, { allowEmpty: true }).songList);
                }

                return this.mergeAIResponseBatches(songLists, prompts);
            },

            async processCommandWithOpenAI(transcript) {
                if (!this.config || !this.config.openaiApiKey) {
                    throw new Error('OpenAI API key not configured');
                }

                const request = await this.prepareMusicSearchRequest(transcript);
                const prompts = this.getMusicSearchPrompts(request);
                const songLists = [];

                for (let i = 0; i < prompts.length; i++) {
                    const prompt = prompts[i];
                    let responseText = '';
                    const request = this.buildOpenAIRequest(prompt);

                    this.logClaudeMessage(`Music search request to OpenAI (${this.settings.openaiModel}) batch ${i + 1}/${prompts.length}`);
                    this.addMessage('claude', `OpenAI request (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(request.body, null, 2));

                    try {
                        const response = await fetch(request.url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.config.openaiApiKey}`
                            },
                            body: JSON.stringify(request.body)
                        });

                        if (!response.ok) {
                            const error = await response.json();
                            this.addMessage('error', `OpenAI response (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(error, null, 2));
                            throw new Error(error.error?.message || 'OpenAI API request failed');
                        }

                        const data = await response.json();
                        this.addMessage('claude', `OpenAI response (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(data, null, 2));
                        responseText = this.extractOpenAIResponseText(data);
                    } catch (error) {
                        this.logError('OpenAI API Error', error);
                        throw error;
                    }

                    songLists.push(this.parseAIResponse(responseText, prompt, { allowEmpty: true }).songList);
                }

                return this.mergeAIResponseBatches(songLists, prompts);
            },

            buildOpenAIRequest(prompt) {
                const model = this.settings.openaiModel;
                if (/^gpt-5/i.test(model)) {
                    return {
                        url: 'https://api.openai.com/v1/responses',
                        body: {
                            model,
                            input: prompt,
                            max_output_tokens: MUSIC_SEARCH_MAX_TOKENS,
                            reasoning: { effort: 'low' }
                        }
                    };
                }

                return {
                    url: 'https://api.openai.com/v1/responses',
                    body: {
                        model,
                        input: prompt,
                        max_output_tokens: MUSIC_SEARCH_MAX_TOKENS
                    }
                };
            },

            extractOpenAIResponseText(data) {
                if (typeof data.output_text === 'string') {
                    return data.output_text.trim();
                }

                const outputText = (data.output || [])
                    .flatMap(item => item.content || [])
                    .map(part => part.text || part.output_text || '')
                    .join('')
                    .trim();
                if (outputText) return outputText;

                const chatText = data.choices?.[0]?.message?.content;
                if (typeof chatText === 'string') return chatText.trim();

                throw new Error('OpenAI response did not contain text output');
            },

            extractUrlsFromTranscript(transcript) {
                const matches = transcript.match(/\bhttps?:\/\/[^\s<>"']+/gi) || [];
                const urls = matches.map(url => url.replace(/[)\].,!?;:]+$/g, ''));
                return [...new Set(urls)];
            },

            inferKnownPageUrls(transcript) {
                if (/(tv\s*tropes|tvtropes)/i.test(transcript) && /regional\s+riffs?/i.test(transcript)) {
                    return ['https://tvtropes.org/pmwiki/pmwiki.php/Main/RegionalRiff'];
                }
                return [];
            },

            async prepareMusicSearchRequest(transcript) {
                const explicitUrls = this.extractUrlsFromTranscript(transcript);
                const urls = explicitUrls.length > 0 ? explicitUrls : this.inferKnownPageUrls(transcript);
                if (urls.length === 0) {
                    return { transcript, linkedPages: [] };
                }

                this.updateStatus(`Reading ${urls.length} linked page${urls.length === 1 ? '' : 's'}...`);
                this.addMessage('claude', 'Linked pages', `Reading ${urls.join(', ')}`);

                const linkedPages = await Promise.all(urls.map(url => this.fetchLinkedPageText(url)));
                return { transcript, linkedPages };
            },

            async fetchLinkedPageText(url) {
                const response = await fetch(`proxy.php?readUrl=${encodeURIComponent(url)}`);
                const data = await response.json().catch(() => ({}));

                if (!response.ok || data.error) {
                    throw new Error(data.error || `Could not read linked page: ${url}`);
                }

                if (!data.text || !String(data.text).trim()) {
                    throw new Error(`No readable text found at ${url}`);
                }

                const truncatedText = data.truncated ? `, truncated from ${data.originalCharCount || 'unknown'} chars` : '';
                this.addMessage('claude', 'Page read', `${data.title || url} (${data.charCount || data.text.length} chars${truncatedText})`);
                return data;
            },

            getMusicSearchPrompt(request) {
                return this.getMusicSearchPrompts(request)[0];
            },

            getMusicSearchPrompts(request) {
                const transcript = typeof request === 'string' ? request : request.transcript;
                const linkedPages = typeof request === 'string' ? [] : request.linkedPages;
                const sourceChunks = this.buildMusicSourceChunks(transcript, linkedPages);
                const promptRequest = sourceChunks.length > 0 && linkedPages.length === 0 && transcript.length > 2000
                    ? `${transcript.slice(0, 2000)}\n[Long typed/pasted request continues in the extraction batches below.]`
                    : transcript;

                if (sourceChunks.length === 0) {
                    return [this.buildMusicSearchPrompt(promptRequest, '')];
                }

                this.addMessage('claude', 'Extraction batches', `${sourceChunks.length} source batch${sourceChunks.length === 1 ? '' : 'es'} prepared`);
                return sourceChunks.map(chunk => this.buildMusicSearchPrompt(promptRequest, `

Source batch ${chunk.index + 1} of ${chunk.total} from ${chunk.label}.
${chunk.meta}
Extract only music items visible in this source batch. Duplicates across batches will be merged.
Text:
"""${chunk.text}"""`));
            },

            buildMusicSourceChunks(transcript, linkedPages) {
                if (linkedPages.length > 0) {
                    return linkedPages.flatMap(page => this.chunkMusicSource(
                        page.text,
                        page.title || page.url,
                        `URL: ${page.url}
Readable text: ${page.charCount || page.text.length} chars${page.truncated ? ` (truncated from ${page.originalCharCount || 'unknown'} chars)` : ''}`
                    ));
                }

                if (transcript.length > MUSIC_SOURCE_CHUNK_CHARS) {
                    return this.chunkMusicSource(transcript, 'typed/pasted request text', 'The user supplied a long typed request. The extraction instruction may be part of the first batch.');
                }

                return [];
            },

            chunkMusicSource(text, label, meta) {
                const chunks = [];
                const source = String(text || '');
                for (let start = 0; start < source.length; start += MUSIC_SOURCE_CHUNK_CHARS) {
                    chunks.push(source.slice(start, start + MUSIC_SOURCE_CHUNK_CHARS));
                }
                return chunks.map((chunk, index) => ({
                    text: chunk,
                    label,
                    meta,
                    index,
                    total: chunks.length
                }));
            },

            buildMusicSearchPrompt(transcript, sourceContext) {
                return `A user is requesting music. They might also ask for comments on each song.

User's request: "${transcript}"
${sourceContext}

Return a JSON array of music search items that match this request. If the user asks for "all", "every", a complete list, or page extraction, return every distinct music item you can identify from the supplied request/page text. Do not impose a small recommendation cap. For very large lists, keep fields compact rather than summarizing or dropping items.

If linked page text is supplied, extract the songs, artists, or bands mentioned in that text according to the user's request. If a song and artist are both known, use both. If only an artist/band or only a search phrase is known, still include a useful YouTube search term.

Return ONLY a JSON array (no markdown, no code blocks, no explanation), using this schema:
[{
  "name": "Song Title, or empty string if the item is an artist/band/search phrase",
  "artist": "Artist or band name, or empty string if unknown",
  "year": "Release year (if known, otherwise empty string)",
  "album": "Album name (if known, otherwise empty string)",
  "comment": "Brief comment about why this song fits the request",
  "searchTerm": "Artist Name Song Title, artist/band name, or exact terms to search for"
}]

If the request is not about music, return an empty array [].`;
            },

            parseAIResponse(responseText, prompt, options = {}) {
                this.logClaudeMessage(`Response:\n${responseText}`);

                const jsonText = this.extractAIJson(responseText);

                this.addMessage('claude', 'Parsing JSON', jsonText.substring(0, 200) + (jsonText.length > 200 ? '...' : ''));

                const parsed = JSON.parse(jsonText);
                const songList = this.normalizeAISongList(parsed);
                this.addMessage('claude', 'Parsed songs', `${songList.length} songs found`);

                if (songList.length === 0 && !options.allowEmpty) {
                    const error = new Error('No songs found in the AI response');
                    error.name = 'NoSongsFoundError';
                    throw error;
                }

                return { songList, prompt };
            },

            mergeAIResponseBatches(songLists, prompts) {
                const seen = new Set();
                const merged = [];
                for (const list of songLists) {
                    for (const item of list) {
                        const key = item.searchTerm.toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        merged.push(item);
                    }
                }

                this.addMessage('claude', 'Merged extraction', `${merged.length} unique music item${merged.length === 1 ? '' : 's'} from ${songLists.length} batch${songLists.length === 1 ? '' : 'es'}`);
                if (merged.length === 0) {
                    const error = new Error('No songs found in the AI response');
                    error.name = 'NoSongsFoundError';
                    throw error;
                }

                return { songList: merged, prompt: prompts.join('\n\n--- NEXT EXTRACTION BATCH ---\n\n') };
            },

            extractAIJson(responseText) {
                const fencedMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/i);
                const text = fencedMatch ? fencedMatch[1].trim() : responseText.trim();

                const firstArray = text.indexOf('[');
                const lastArray = text.lastIndexOf(']');
                if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
                    return text.substring(firstArray, lastArray + 1);
                }

                const firstObject = text.indexOf('{');
                const lastObject = text.lastIndexOf('}');
                if (firstObject !== -1 && lastObject !== -1 && lastObject > firstObject) {
                    return text.substring(firstObject, lastObject + 1);
                }

                return text;
            },

            normalizeAISongList(parsed) {
                const items = Array.isArray(parsed)
                    ? parsed
                    : (Array.isArray(parsed.songs) ? parsed.songs
                        : (Array.isArray(parsed.tracks) ? parsed.tracks
                            : (Array.isArray(parsed.items) ? parsed.items
                                : (Array.isArray(parsed.results) ? parsed.results
                                    : (Array.isArray(parsed.searchTerms) ? parsed.searchTerms : [])))));

                return items
                    .map(item => this.normalizeAISongItem(item))
                    .filter(item => item && item.searchTerm);
            },

            normalizeAISongItem(item) {
                if (typeof item === 'string') {
                    const searchTerm = item.trim();
                    if (!searchTerm) return null;
                    return {
                        name: '',
                        artist: '',
                        year: '',
                        album: '',
                        comment: '',
                        searchTerm
                    };
                }

                if (!item || typeof item !== 'object') return null;

                const name = String(item.name || item.title || item.song || item.track || '').trim();
                const artist = String(item.artist || item.band || item.performer || '').trim();
                const searchTerm = String(item.searchTerm || item.search || item.query || item.terms || `${artist} ${name}`.trim()).trim();

                if (!searchTerm) return null;

                return {
                    name,
                    artist,
                    year: String(item.year || '').trim(),
                    album: String(item.album || '').trim(),
                    comment: String(item.comment || item.reason || '').trim(),
                    searchTerm
                };
            }
        }));
    }

    return { install };
})();

window.PlayerCommands = PlayerCommands;
