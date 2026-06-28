// @ts-nocheck
// Voice command parsing, control execution, and LLM music search.

// Skip Claude API calls and return hardcoded test data (for debugging YouTube search)
const SKIP_CLAUDE = false;

const PlayerCommands = (function () {
    'use strict';

    /** @param {VoiceMusicController} controller */
    function install(controller) {
        Object.assign(controller, {
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
                const prompt = this.getMusicSearchPrompt(request);
                let responseText = '';

                try {
                    const requestBody = {
                        model: this.settings.claudeModel,
                        max_tokens: 4000,
                        messages: [{
                            role: 'user',
                            content: prompt
                        }]
                    };

                    this.logClaudeMessage(`Music search request to Claude (${this.settings.claudeModel})`);

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
                        throw new Error(error.error?.message || 'Claude API request failed');
                    }

                    const data = await response.json();
                    responseText = data.content[0].text.trim();
                } catch (error) {
                    console.error('Claude API error:', error);
                    this.logError('Claude API Error', error);
                    throw error;
                }

                return this.parseAIResponse(responseText, prompt);
            },

            async processCommandWithOpenAI(transcript) {
                if (!this.config || !this.config.openaiApiKey) {
                    throw new Error('OpenAI API key not configured');
                }

                const request = await this.prepareMusicSearchRequest(transcript);
                const prompt = this.getMusicSearchPrompt(request);
                let responseText = '';

                try {
                    const requestBody = {
                        model: this.settings.openaiModel,
                        messages: [{
                            role: 'user',
                            content: prompt
                        }],
                        max_tokens: 4000
                    };

                    this.logClaudeMessage(`Music search request to OpenAI (${this.settings.openaiModel})`);

                    const response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.config.openaiApiKey}`
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error?.message || 'OpenAI API request failed');
                    }

                    const data = await response.json();
                    responseText = data.choices[0].message.content.trim();
                } catch (error) {
                    console.error('OpenAI API error:', error);
                    this.logError('OpenAI API Error', error);
                    throw error;
                }

                return this.parseAIResponse(responseText, prompt);
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

                this.addMessage('claude', 'Page read', `${data.title || url} (${data.charCount || data.text.length} chars)`);
                return data;
            },

            getMusicSearchPrompt(request) {
                const transcript = typeof request === 'string' ? request : request.transcript;
                const linkedPages = typeof request === 'string' ? [] : request.linkedPages;
                const pageContext = linkedPages.length === 0 ? '' : `

Linked page text is supplied below. Use this supplied text as the source; do not say that you cannot browse the URL.
${linkedPages.map((page, index) => `[${index + 1}] ${page.url}
Title: ${page.title || '(untitled)'}
Text:
"""${page.text}"""`).join('\n\n')}`;

                return `A user is requesting music. They might also ask for comments on each song.

User's request: "${transcript}"
${pageContext}

Return a JSON array of music search items that match this request. Include as many items as appropriate for the request - a specific song request might be 1-2 songs, while a genre, page extraction, or mood request could be 5-25 items or more.

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

            parseAIResponse(responseText, prompt) {
                this.logClaudeMessage(`Response:\n${responseText}`);

                const jsonText = this.extractAIJson(responseText);

                this.addMessage('claude', 'Parsing JSON', jsonText.substring(0, 200) + (jsonText.length > 200 ? '...' : ''));

                const parsed = JSON.parse(jsonText);
                const songList = this.normalizeAISongList(parsed);
                this.addMessage('claude', 'Parsed songs', `${songList.length} songs found`);

                if (songList.length === 0) {
                    const error = new Error('No songs found in the AI response');
                    error.name = 'NoSongsFoundError';
                    throw error;
                }

                return { songList, prompt };
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
        });
    }

    return { install };
})();

window.PlayerCommands = PlayerCommands;
