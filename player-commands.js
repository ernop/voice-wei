// @ts-check
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

                const prompt = this.getMusicSearchPrompt(transcript);

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
                    const responseText = data.content[0].text.trim();

                    return this.parseAIResponse(responseText, prompt);
                } catch (error) {
                    console.error('Claude API error:', error);
                    this.logError('Claude API Error', error);
                    throw error;
                }
            },

            async processCommandWithOpenAI(transcript) {
                if (!this.config || !this.config.openaiApiKey) {
                    throw new Error('OpenAI API key not configured');
                }

                const prompt = this.getMusicSearchPrompt(transcript);

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
                    const responseText = data.choices[0].message.content.trim();

                    return this.parseAIResponse(responseText, prompt);
                } catch (error) {
                    console.error('OpenAI API error:', error);
                    this.logError('OpenAI API Error', error);
                    throw error;
                }
            },

            getMusicSearchPrompt(transcript) {
                return `A user is requesting music. They might also ask for comments on each song.

User's request: "${transcript}"

Return a JSON array of songs that match this request. Include as many songs as appropriate for the request - a specific song request might be 1-2 songs, while a genre or mood request could be 5-15 songs or more.

Return ONLY a JSON array (no markdown, no code blocks, no explanation), using this schema:
[{
  "name": "Song Title",
  "artist": "Artist Name",
  "year": "Release year (if known, otherwise empty string)",
  "album": "Album name (if known, otherwise empty string)",
  "comment": "Brief comment about why this song fits the request",
  "searchTerm": "Artist Name Song Title"
}]

If the request is not about music, return an empty array [].`;
            },

            parseAIResponse(responseText, prompt) {
                this.logClaudeMessage(`Response:\n${responseText}`);

                // Extract JSON array from response
                let jsonText = responseText;
                const firstBracket = responseText.indexOf('[');
                const lastBracket = responseText.lastIndexOf(']');

                if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
                    jsonText = responseText.substring(firstBracket, lastBracket + 1);
                }

                this.addMessage('claude', 'Parsing JSON', jsonText.substring(0, 200) + (jsonText.length > 200 ? '...' : ''));

                const songList = JSON.parse(jsonText);
                this.addMessage('claude', 'Parsed songs', `${songList.length} songs found`);

                if (!Array.isArray(songList) || songList.length === 0) {
                    throw new Error('No songs found or invalid response');
                }

                return { songList, prompt };
            }
        });
    }

    return { install };
})();

window.PlayerCommands = PlayerCommands;
