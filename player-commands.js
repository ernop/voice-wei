// @ts-check
// Voice command parsing, control execution, and LLM music search.

// Skip Claude API calls and return hardcoded test data (for debugging YouTube search)
const SKIP_CLAUDE = false;
const MUSIC_SEARCH_MAX_TOKENS = 16000;
const MUSIC_SOURCE_CHUNK_CHARS = 50000;
const SONG_REPORT_MAX_TOKENS = 6000;
// The direct playlist entry: player.html?url=<page>&onlyURL=true|false
const LINKED_PAGE_URL_PARAM = 'url';
const LINKED_PAGE_ONLY_PARAM = 'onlyURL';
// onlyURL=false: related picks for the whole page, shared across its batches.
const LINKED_PAGE_RELATED_PICKS_MAX = 20;
// schema.org fields that identify songs; the rest of a page's JSON-LD
// (offers, images, audio URLs, related albums) is prompt noise.
const MUSIC_STRUCTURED_DATA_KEYS = new Set([
    '@graph', '@type', 'name', 'byArtist', 'inAlbum', 'album', 'track', 'tracks',
    'itemListElement', 'item', 'position', 'datePublished', 'duration'
]);

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

                // Favorites and list curation (the playlist card's controls)
                if (lower.match(/^(load|add|play)\s+(my\s+)?(favorites|favourites|faves|favs|starred(\s+songs)?)$/)) {
                    return 'loadfavorites';
                }
                if (lower.match(/^(star|favorite|favourite|like)\s+(this|it|this\s+song|the\s+song)$/)) {
                    return 'star';
                }
                if (lower.match(/^(unstar|unfavorite|unfavourite|unlike)\s+(this|it|this\s+song|the\s+song)$/)) {
                    return 'unstar';
                }
                if (lower.match(/^(show\s+)?(favorites|favourites|faves|favs|starred)(\s+songs)?\s+only$/)
                    || lower.match(/^(show\s+)?only\s+(favorites|favourites|faves|favs|starred)(\s+songs)?$/)) {
                    return 'favoritesonly';
                }
                if (lower.match(/^show\s+(all|everything)(\s+songs)?$/)) {
                    return 'showall';
                }
                if (lower.match(/^(unload|remove|drop)\s+(the\s+)?(unstarred|non[\s-]?favorites|non[\s-]?favourites)(\s+songs)?$/)) {
                    return 'unloadunstarred';
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
                        } else if (this.playNext()) {
                            this.updateStatus('Next song');
                        }
                        break;
                    case 'previous':
                        if (this.playlist.length === 0) {
                            this.updateStatus('Playlist is empty');
                        } else if (this.playPrevious()) {
                            this.updateStatus('Previous song');
                        }
                        break;
                    case 'forward':
                        if (!this.currentPlayingId) {
                            this.updateStatus('Nothing is playing');
                        } else {
                            this.fastForward();
                            this.updateStatus('Skipped forward 5 seconds');
                        }
                        break;
                    case 'rewind':
                        if (!this.currentPlayingId) {
                            this.updateStatus('Nothing is playing');
                        } else {
                            this.rewind();
                            this.updateStatus('Rewound 5 seconds');
                        }
                        break;
                    case 'loadfavorites': {
                        const added = this.loadFavoritesToPlaylist();
                        this.speakText(added > 0 ? `Loaded ${added} favorite${added === 1 ? '' : 's'}` : 'No new favorites to load');
                        break;
                    }
                    case 'star':
                    case 'unstar': {
                        const item = this.nowPlayingItem();
                        if (!item) {
                            this.updateStatus('Nothing is playing');
                            this.speakText('Nothing is playing');
                            break;
                        }
                        this.setSongFavorite(item, command === 'star');
                        this.speakText(command === 'star' ? 'Starred' : 'Unstarred');
                        break;
                    }
                    case 'favoritesonly':
                        this.setPlaylistFavoritesOnly(true);
                        this.updateStatus('Showing favorites only');
                        this.speakText('Showing favorites only');
                        break;
                    case 'showall':
                        this.clearPlaylistFilter();
                        this.updateStatus('Showing all songs');
                        this.speakText('Showing all songs');
                        break;
                    case 'unloadunstarred': {
                        const removed = this.unloadUnstarredSongs();
                        this.speakText(removed > 0 ? `Unloaded ${removed} unstarred song${removed === 1 ? '' : 's'}` : 'No unstarred songs to unload');
                        break;
                    }
                }
            },

            showHelp() {
                const commands = 'play, pause, stop, next, previous, fast forward, rewind, shuffle, clear, what\'s playing, '
                    + 'load favorites, star this, unstar this, favorites only, show all, unload unstarred';

                this.updateStatus(`Voice Commands: ${commands}`);
                this.addMessage('user', 'Help:', commands);
                this.speakText(`Voice commands: ${commands}.`);
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

            /** @param {MusicSearchRequest} request */
            async processCommandWithLLM(request) {
                // Debug mode: skip API and return hardcoded test data
                if (SKIP_CLAUDE) {
                    this.addMessage('claude', 'DEBUG', 'Skipping API - using hardcoded Cecilia');
                    const testSongList = [{
                        name: "Cecilia",
                        artist: "Simon & Garfunkel",
                        year: "1970",
                        album: "Bridge Over Troubled Water",
                        comment: "DEBUG: Hardcoded test song",
                        searchTerm: "Simon & Garfunkel Cecilia",
                        fromPage: false
                    }];
                    return { songList: testSongList, prompt: '[DEBUG MODE - API skipped]' };
                }

                // Use configured provider
                const provider = this.settings.aiProvider;

                if (provider === 'openai') {
                    return this.processCommandWithOpenAI(request);
                } else {
                    return this.processCommandWithClaude(request);
                }
            },

            /**
             * The selected provider has no key saved at all. Same
             * ApiKeyError name as key-level provider failures so every
             * catch surfaces it, plus a missingKey flag so the UI opens
             * the key entry overlay instead of only naming the problem.
             * @param {'claude' | 'openai'} provider
             * @returns {Error & { provider?: string, missingKey?: boolean }}
             */
            missingApiKeyError(provider) {
                /** @type {Error & { provider?: string, missingKey?: boolean }} */
                const error = new Error(`No ${provider === 'openai' ? 'OpenAI' : 'Claude'} API key saved`);
                error.name = 'ApiKeyError';
                error.provider = provider;
                error.missingKey = true;
                return error;
            },

            /**
             * Provider errors that mean "your key/account, not this
             * request": invalid key, spend or rate limits, billing. These
             * get a distinguishable name so the UI can show a persistent,
             * actionable banner instead of a generic lookup failure.
             * @param {'claude' | 'openai'} provider
             * @param {number} status HTTP status
             * @param {any} errorBody parsed provider error JSON
             * @returns {Error & { provider?: string, status?: number }}
             */
            classifyProviderError(provider, status, errorBody) {
                const type = errorBody?.error?.type || '';
                const message = errorBody?.error?.message || `${provider} API request failed (HTTP ${status})`;
                /** @type {Error & { provider?: string, status?: number }} */
                const error = new Error(message);
                const keyLevel = [401, 402, 403, 429].includes(status)
                    || /quota|billing|credit|insufficient|rate.?limit|spend/i.test(`${type} ${message}`);
                if (keyLevel) {
                    error.name = 'ApiKeyError';
                    error.provider = provider;
                    error.status = status;
                }
                return error;
            },

            /**
             * Run the dedicated, web-grounded report prompt through the
             * provider/model already selected for music requests.
             * @param {string} prompt
             * @returns {Promise<{ text: string, provider: 'claude' | 'openai', model: string }>}
             */
            async requestSongReportResearch(prompt) {
                const provider = this.settings.aiProvider;
                if (provider === 'openai') {
                    if (!this.config?.openaiApiKey) {
                        throw this.missingApiKeyError('openai');
                    }
                    const model = this.settings.openaiModel;
                    // Default reasoning effort: the report demands careful
                    // sourcing and attribution, not the fastest answer.
                    const requestBody = {
                        model,
                        input: prompt,
                        max_output_tokens: SONG_REPORT_MAX_TOKENS,
                        tools: [{ type: 'web_search' }],
                        tool_choice: 'required'
                    };
                    this.addMessage('claude', `Song report request to OpenAI (${model})`, JSON.stringify(requestBody, null, 2));

                    const response = await fetch('https://api.openai.com/v1/responses', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.config.openaiApiKey}`
                        },
                        body: JSON.stringify(requestBody)
                    });
                    if (!response.ok) {
                        const error = await response.json().catch(() => ({}));
                        this.addMessage('error', 'Song report response from OpenAI', JSON.stringify(error, null, 2));
                        throw this.classifyProviderError('openai', response.status, error);
                    }

                    const data = await response.json();
                    this.addMessage('claude', 'Song report response from OpenAI', JSON.stringify(data, null, 2));
                    if (data.status === 'incomplete') {
                        throw new Error(`OpenAI song report was incomplete (${data.incomplete_details?.reason || 'unknown reason'})`);
                    }
                    return { text: this.extractOpenAIResponseText(data), provider: 'openai', model };
                }

                if (!this.config?.claudeApiKey) {
                    throw this.missingApiKeyError('claude');
                }
                const model = this.settings.claudeModel;
                const requestBody = {
                    model,
                    max_tokens: SONG_REPORT_MAX_TOKENS,
                    messages: [{ role: 'user', content: prompt }],
                    tools: [{
                        type: 'web_search_20250305',
                        name: 'web_search',
                        max_uses: 8
                    }],
                    tool_choice: { type: 'any' }
                };
                this.addMessage('claude', `Song report request to Claude (${model})`, JSON.stringify(requestBody, null, 2));

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
                    const error = await response.json().catch(() => ({}));
                    this.addMessage('error', 'Song report response from Claude', JSON.stringify(error, null, 2));
                    throw this.classifyProviderError('claude', response.status, error);
                }

                const data = await response.json();
                this.addMessage('claude', 'Song report response from Claude', JSON.stringify(data, null, 2));
                if (data.stop_reason === 'max_tokens') {
                    throw new Error('Claude song report reached its output limit');
                }
                const text = (data.content || [])
                    .filter(block => block.type === 'text')
                    .map(block => String(block.text || '').trim())
                    .filter(Boolean)
                    .join('\n')
                    .trim();
                if (!text) {
                    throw new Error('Claude song report did not contain text output');
                }
                return { text, provider: 'claude', model };
            },

            /** @param {MusicSearchRequest} request */
            async processCommandWithClaude(request) {
                if (!this.config || !this.config.claudeApiKey) {
                    throw this.missingApiKeyError('claude');
                }

                const prepared = await this.prepareMusicSearchRequest(request);
                const prompts = this.getMusicSearchPrompts(prepared);
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

                    let truncated = false;
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
                            const error = await response.json().catch(() => ({}));
                            this.addMessage('error', `Claude response (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(error, null, 2));
                            throw this.classifyProviderError('claude', response.status, error);
                        }

                        const data = await response.json();
                        this.addMessage('claude', `Claude response (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(data, null, 2));
                        truncated = data.stop_reason === 'max_tokens';
                        if (truncated) {
                            this.addMessage('error', 'Claude response truncated', `stop_reason=max_tokens: the song list was cut off at the ${MUSIC_SEARCH_MAX_TOKENS}-token output limit; complete songs will be recovered.`);
                        }
                        // Adaptive-thinking models (Fable 5, Sonnet 5) may
                        // return thinking blocks before the text block.
                        const textBlock = data.content.find(block => block.type === 'text');
                        if (!textBlock) {
                            throw new Error('Claude response did not contain a text block');
                        }
                        responseText = textBlock.text.trim();
                    } catch (error) {
                        this.logError('Claude API Error', error);
                        throw error;
                    }

                    songLists.push(this.parseAIResponse(responseText, prompt, { allowEmpty: true, truncated }).songList);
                }

                return this.mergeAIResponseBatches(songLists, prompts, prepared.pageScope);
            },

            /** @param {MusicSearchRequest} request */
            async processCommandWithOpenAI(request) {
                if (!this.config || !this.config.openaiApiKey) {
                    throw this.missingApiKeyError('openai');
                }

                const prepared = await this.prepareMusicSearchRequest(request);
                const prompts = this.getMusicSearchPrompts(prepared);
                const songLists = [];

                for (let i = 0; i < prompts.length; i++) {
                    const prompt = prompts[i];
                    let responseText = '';
                    const openaiRequest = this.buildOpenAIRequest(prompt);

                    this.logClaudeMessage(`Music search request to OpenAI (${this.settings.openaiModel}) batch ${i + 1}/${prompts.length}`);
                    this.addMessage('claude', `OpenAI request (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(openaiRequest.body, null, 2));

                    let truncated = false;
                    try {
                        const response = await fetch(openaiRequest.url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.config.openaiApiKey}`
                            },
                            body: JSON.stringify(openaiRequest.body)
                        });

                        if (!response.ok) {
                            const error = await response.json().catch(() => ({}));
                            this.addMessage('error', `OpenAI response (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(error, null, 2));
                            throw this.classifyProviderError('openai', response.status, error);
                        }

                        const data = await response.json();
                        this.addMessage('claude', `OpenAI response (raw, batch ${i + 1}/${prompts.length})`, JSON.stringify(data, null, 2));
                        truncated = data.status === 'incomplete';
                        if (truncated) {
                            this.addMessage('error', 'OpenAI response truncated', `status=incomplete (${data.incomplete_details?.reason || 'unknown reason'}): the song list was cut off at the ${MUSIC_SEARCH_MAX_TOKENS}-token output limit; complete songs will be recovered.`);
                        }
                        responseText = this.extractOpenAIResponseText(data);
                    } catch (error) {
                        this.logError('OpenAI API Error', error);
                        throw error;
                    }

                    songLists.push(this.parseAIResponse(responseText, prompt, { allowEmpty: true, truncated }).songList);
                }

                return this.mergeAIResponseBatches(songLists, prompts, prepared.pageScope);
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

            /**
             * A typed, spoken, or history request. URLs in its words (or a
             * known page it names) are read, and the words decide what to take.
             * @param {string} requestText
             * @returns {MusicSearchRequest}
             */
            musicSearchRequestFromText(requestText) {
                const explicitUrls = this.extractUrlsFromTranscript(requestText);
                return {
                    requestText,
                    pageScope: 'request',
                    pageUrls: explicitUrls.length > 0 ? explicitUrls : this.inferKnownPageUrls(requestText)
                };
            },

            /**
             * The direct playlist entry: player.html?url=<page>&onlyURL=true|false.
             * onlyURL=true (also the value when omitted) takes exactly the
             * page's songs; false lets related picks follow them. Any other
             * value is an error rather than a guessed mode.
             * @param {URLSearchParams} params
             * @returns {LinkedPageEntry | null} null when the page was opened without one
             */
            parseLinkedPageEntry(params) {
                const rawUrl = params.get(LINKED_PAGE_URL_PARAM);
                if (rawUrl === null) return null;

                /** @type {URL | null} */
                let pageUrl = null;
                try {
                    pageUrl = new URL(rawUrl.trim());
                } catch (_invalidUrl) {
                    pageUrl = null;
                }
                if (!pageUrl || (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:')) {
                    return { ok: false, error: `Linked page link needs a full http(s) page address in "${LINKED_PAGE_URL_PARAM}" (got "${rawUrl}")` };
                }

                const rawOnly = params.get(LINKED_PAGE_ONLY_PARAM);
                const onlyValue = rawOnly === null ? 'true' : rawOnly.trim().toLowerCase();
                if (onlyValue !== 'true' && onlyValue !== 'false') {
                    return { ok: false, error: `Linked page link: ${LINKED_PAGE_ONLY_PARAM} must be true or false (got "${rawOnly}")` };
                }

                const onlyUrl = onlyValue === 'true';
                return {
                    ok: true,
                    request: {
                        requestText: `Linked page (${LINKED_PAGE_ONLY_PARAM}=${onlyUrl}): ${pageUrl.href}`,
                        pageScope: onlyUrl ? 'only-page' : 'page-plus-related',
                        pageUrls: [pageUrl.href]
                    }
                };
            },

            linkedPageEntryFromLocation() {
                return this.parseLinkedPageEntry(new URLSearchParams(window.location.search));
            },

            // Leaves every other parameter (diagnostic flags) in place.
            clearLinkedPageEntryFromLocation() {
                const url = new URL(window.location.href);
                url.searchParams.delete(LINKED_PAGE_URL_PARAM);
                url.searchParams.delete(LINKED_PAGE_ONLY_PARAM);
                history.replaceState(history.state, '', url.href);
            },

            /**
             * @param {MusicSearchRequest} request
             * @returns {Promise<PreparedMusicSearchRequest>}
             */
            async prepareMusicSearchRequest(request) {
                const urls = request.pageUrls;
                if (urls.length === 0) {
                    return { ...request, linkedPages: [] };
                }

                this.updateStatus(`Reading ${urls.length} linked page${urls.length === 1 ? '' : 's'}...`);
                this.addMessage('claude', 'Linked pages', `Reading ${urls.join(', ')}`);

                const linkedPages = await Promise.all(urls.map(url => this.fetchLinkedPageText(url)));
                return { ...request, linkedPages };
            },

            /**
             * @param {string} url
             * @returns {Promise<LinkedPageText>}
             */
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

            /** @param {PreparedMusicSearchRequest} prepared */
            getMusicSearchPrompt(prepared) {
                return this.getMusicSearchPrompts(prepared)[0];
            },

            /** @param {PreparedMusicSearchRequest} prepared */
            getMusicSearchPrompts(prepared) {
                if (prepared.pageScope !== 'request') {
                    return this.getLinkedPagePrompts(prepared);
                }

                const { requestText, linkedPages } = prepared;
                const sourceChunks = this.buildMusicSourceChunks(prepared);
                const promptRequest = sourceChunks.length > 0 && linkedPages.length === 0 && requestText.length > 2000
                    ? `${requestText.slice(0, 2000)}\n[Long typed/pasted request continues in the extraction batches below.]`
                    : requestText;

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

            /**
             * One prompt per batch of a directly linked page. The related-pick
             * allowance is split across batches so a long page gets the same
             * total as a short one.
             * @param {PreparedMusicSearchRequest} prepared
             */
            getLinkedPagePrompts(prepared) {
                const chunks = this.buildMusicSourceChunks(prepared);
                this.addMessage('claude', 'Extraction batches', `${chunks.length} page batch${chunks.length === 1 ? '' : 'es'} prepared (${prepared.pageScope})`);
                const relatedPicksMax = Math.ceil(LINKED_PAGE_RELATED_PICKS_MAX / chunks.length);
                return chunks.map(chunk => this.buildLinkedPagePrompt({ pageScope: prepared.pageScope, chunk, relatedPicksMax }));
            },

            /** @param {PreparedMusicSearchRequest} prepared */
            buildMusicSourceChunks(prepared) {
                if (prepared.linkedPages.length > 0) {
                    return prepared.linkedPages.flatMap(page => this.chunkMusicSource(
                        this.linkedPageSourceText(page),
                        page.title || page.url,
                        `URL: ${page.url}
Readable text: ${page.charCount || page.text.length} chars${page.truncated ? ` (truncated from ${page.originalCharCount || 'unknown'} chars)` : ''}`
                    ));
                }

                if (prepared.requestText.length > MUSIC_SOURCE_CHUNK_CHARS) {
                    return this.chunkMusicSource(prepared.requestText, 'typed/pasted request text', 'The user supplied a long typed request. The extraction instruction may be part of the first batch.');
                }

                return [];
            },

            /**
             * What the extraction reads for one page: its readable text, led
             * by any schema.org music data it embeds (Apple Music albums, for
             * one, list their songs only there).
             * @param {LinkedPageText} page
             */
            linkedPageSourceText(page) {
                const music = this.musicStructuredData(page.structuredData);
                if (music.length === 0) return page.text;
                return `Structured music data embedded in the page (schema.org JSON-LD):
${JSON.stringify(music)}

Readable page text:
${page.text}`;
            },

            /**
             * The page's JSON-LD blocks that describe music (MusicAlbum,
             * MusicPlaylist, MusicRecording...), pruned to identity fields.
             * @param {unknown[]} blocks
             * @returns {unknown[]}
             */
            musicStructuredData(blocks) {
                /** @param {unknown} node @returns {boolean} */
                const describesMusic = node => {
                    if (Array.isArray(node)) return node.some(describesMusic);
                    if (!node || typeof node !== 'object') return false;
                    const types = [].concat(node['@type'] || []);
                    return types.some(type => /^Music/.test(String(type)))
                        || Object.values(node).some(describesMusic);
                };
                /** @param {unknown} node @returns {unknown} */
                const prune = node => {
                    if (Array.isArray(node)) return node.map(prune);
                    if (!node || typeof node !== 'object') return node;
                    return Object.fromEntries(Object.entries(node)
                        .filter(([key]) => MUSIC_STRUCTURED_DATA_KEYS.has(key))
                        .map(([key, value]) => [key, prune(value)]));
                };
                return blocks.filter(describesMusic).map(prune);
            },

            chunkMusicSource(text, label, meta) {
                const chunks = [];
                const source = String(text || '');
                let start = 0;
                while (start < source.length) {
                    let end = Math.min(source.length, start + MUSIC_SOURCE_CHUNK_CHARS);
                    // End a batch on a line break when one is near, so a
                    // tracklist row is never split between two batches.
                    if (end < source.length) {
                        const lineBreak = source.lastIndexOf('\n', end);
                        if (lineBreak > start + MUSIC_SOURCE_CHUNK_CHARS / 2) end = lineBreak + 1;
                    }
                    chunks.push(source.slice(start, end));
                    start = end;
                }
                return chunks.map((chunk, index) => ({
                    text: chunk,
                    label,
                    meta,
                    index,
                    total: chunks.length
                }));
            },

            /**
             * The extraction prompt for one batch of a directly linked page.
             * Every item states fromPage, so the merge can keep the page's own
             * songs first and in page order, and onlyURL=true can hold the
             * playlist to exactly them.
             * @param {{ pageScope: LinkedPageScope, chunk: MusicSourceChunk, relatedPicksMax: number }} options
             */
            buildLinkedPagePrompt({ pageScope, chunk, relatedPicksMax }) {
                const onlyPage = pageScope === 'only-page';
                const scopeRules = onlyPage
                    ? `Scope (onlyURL=true): the playlist is exactly the page's songs.
- Return every one of the page's songs in this batch, in page order. Do not skip, summarize, or cap them; keep fields compact for long lists.
- Add nothing else: no recommendations, no similar songs, no other songs by the page's artists. Every item has "fromPage": true.`
                    : `Scope (onlyURL=false): the page's songs seed the playlist, and related picks may follow them.
- First return every one of the page's songs in this batch, in page order, each with "fromPage": true. Do not skip, summarize, or cap them; keep fields compact for long lists.
- Then add up to ${relatedPicksMax} related songs that fit the page, each with "fromPage": false and a comment saying why it fits: for example a well-known song by an artist the page mentions without naming a song, or a song close to the page's songs in style, era, or theme. Never repeat one of the page's songs as a related pick.`;

                return `Build a music playlist from a web page the user linked directly (onlyURL=${onlyPage}). There is no other request.

The page's songs: when the page is built around a list of songs (an album tracklist, a setlist, a radio or DJ playlist, a chart, a ranked or curated list), they are that list in its order, every part of it (both sides, bonus tracks, encores). Otherwise they are the songs the page's text names, in the order it first names each one. Navigation, links to other pages, footnotes, references, and citations are not the page's songs. A song needs a title: artists, bands, and albums the page mentions without naming a song are not songs.

${scopeRules}

Use each song's title and artist as the page gives them; when the page's context makes the artist clear (an album's tracklist, one band's setlist), use that artist. Every item means the ORIGINAL STUDIO RECORDING unless the page names a live, acoustic, cover, or remix version: never add words like "live" to the search term.

Page batch ${chunk.index + 1} of ${chunk.total} from ${chunk.label}.
${chunk.meta}
Name only songs visible in this batch; duplicates across batches are merged.
Text:
"""${chunk.text}"""

Return ONLY a JSON array (no markdown, no code blocks, no explanation), using this schema:
[{
  "name": "Song title",
  "artist": "Artist or band name, or empty string if the page does not make it clear",
  "year": "Release year if the page gives it or you are confident of it, otherwise empty string",
  "album": "Album if the page gives it or its context makes it clear, otherwise empty string",
  "comment": "A few words: what the page says about the song, or why a related pick fits",
  "searchTerm": "Artist Name Song Title",
  "fromPage": true
}]

If this batch holds none of the page's songs${onlyPage ? '' : ' and you have no related picks'}, return an empty array [].`;
            },

            buildMusicSearchPrompt(transcript, sourceContext) {
                return `A user is requesting music. They might also ask for comments on each song.

User's request: "${transcript}"
${sourceContext}

Return a JSON array of music search items that match this request. If the user asks for "all", "every", a complete list, or page extraction, return every distinct music item you can identify from the supplied request/page text. Do not impose a small recommendation cap. For very large lists, keep fields compact rather than summarizing or dropping items.

If linked page text is supplied, extract the songs, artists, or bands mentioned in that text according to the user's request. If a song and artist are both known, use both. If only an artist/band or only a search phrase is known, still include a useful YouTube search term.

Names in the request may be misheard by voice transcription or slightly misspelled (for example "mayu ongaku" for the band Maya Ongaku). If the request looks like an artist, band, or song name you do not confidently recognize, never substitute a different better-known artist that partially matches or reinterpret the words. Return the user's literal words as a searchTerm item (YouTube search tolerates small misspellings and will find the artist); if you suspect the name is a near-miss spelling of a real artist, also include items using that corrected name.

Unless the user explicitly asks for live, acoustic, cover, or remix versions, every item means the ORIGINAL STUDIO RECORDING: never add words like "live" to the search term, and do not select live albums or concert recordings.

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

                let parsed;
                try {
                    parsed = JSON.parse(jsonText);
                } catch (parseError) {
                    // A response cut off mid-list (output token limit) is
                    // still mostly usable: keep every complete item, drop
                    // the broken tail, and say so loudly in the log.
                    const salvaged = this.salvageJsonArrayItems(responseText);
                    if (!salvaged || salvaged.length === 0) {
                        throw parseError;
                    }
                    const cause = options.truncated
                        ? 'The provider reports the response hit its output token limit.'
                        : 'The response JSON did not parse whole.';
                    this.addMessage('error', 'Truncated response recovered', `${cause} Kept ${salvaged.length} complete song${salvaged.length === 1 ? '' : 's'} and dropped the incomplete tail.`);
                    parsed = salvaged;
                }

                const songList = this.normalizeAISongList(parsed);
                this.addMessage('claude', 'Parsed songs', `${songList.length} songs found`);

                if (songList.length === 0 && !options.allowEmpty) {
                    const error = new Error('No songs found in the AI response');
                    error.name = 'NoSongsFoundError';
                    throw error;
                }

                return { songList, prompt };
            },

            /**
             * Recover the complete top-level objects of the first JSON
             * array in the text. Handles responses truncated mid-item by
             * an output token limit: every fully closed object is kept,
             * the partial trailing one is dropped. String contents
             * (quotes, braces, escapes) are tracked so lyric-like values
             * cannot fool the scan. Returns null when no array starts.
             * @param {string} text
             * @returns {any[] | null}
             */
            salvageJsonArrayItems(text) {
                const source = String(text || '');
                const start = source.indexOf('[');
                if (start === -1) return null;

                /** @type {string[]} */
                const rawItems = [];
                let depth = 0;
                let inString = false;
                let escaped = false;
                let itemStart = -1;
                for (let i = start + 1; i < source.length; i++) {
                    const ch = source[i];
                    if (inString) {
                        if (escaped) {
                            escaped = false;
                        } else if (ch === '\\') {
                            escaped = true;
                        } else if (ch === '"') {
                            inString = false;
                        }
                        continue;
                    }
                    if (ch === '"') {
                        inString = true;
                        continue;
                    }
                    if (ch === '{') {
                        if (depth === 0) itemStart = i;
                        depth++;
                        continue;
                    }
                    if (ch === '}') {
                        depth--;
                        if (depth === 0 && itemStart !== -1) {
                            rawItems.push(source.slice(itemStart, i + 1));
                            itemStart = -1;
                        }
                        continue;
                    }
                    if (ch === ']' && depth === 0) {
                        break; // array closed properly
                    }
                }

                const items = [];
                for (const raw of rawItems) {
                    try {
                        items.push(JSON.parse(raw));
                    } catch (_ignored) {
                        // An item that does not parse on its own is dropped.
                    }
                }
                return items;
            },

            /**
             * Batches merge in order, first occurrence winning. For a linked
             * page, the page's own songs lead in page order and related picks
             * follow; onlyURL=true keeps nothing the page does not name.
             * @param {AISongItem[][]} songLists
             * @param {string[]} prompts
             * @param {LinkedPageScope} pageScope
             */
            mergeAIResponseBatches(songLists, prompts, pageScope) {
                const items = songLists.flat();
                const pageSongs = items.filter(item => item.fromPage);
                const relatedPicks = items.filter(item => !item.fromPage);
                const ordered = pageScope === 'request' ? items
                    : pageScope === 'only-page' ? pageSongs
                        : [...pageSongs, ...relatedPicks];

                const seen = new Set();
                const merged = [];
                for (const item of ordered) {
                    const key = item.searchTerm.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    merged.push(pageScope === 'page-plus-related' && !item.fromPage
                        ? { ...item, comment: `Related pick: ${item.comment}`.trim() }
                        : item);
                }

                if (pageScope === 'only-page' && relatedPicks.length > 0) {
                    this.addMessage('claude', 'Not on the page', `onlyURL=true: left out ${relatedPicks.length} item${relatedPicks.length === 1 ? '' : 's'} the AI did not mark as named by the page: ${relatedPicks.map(item => item.searchTerm).join('; ')}`);
                }
                const provenance = pageScope === 'request' ? ''
                    : ` (${merged.filter(item => item.fromPage).length} from the page, ${merged.filter(item => !item.fromPage).length} related picks)`;
                this.addMessage('claude', 'Merged extraction', `${merged.length} unique music item${merged.length === 1 ? '' : 's'} from ${songLists.length} batch${songLists.length === 1 ? '' : 'es'}${provenance}`);
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

            /** @returns {AISongItem | null} */
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
                        searchTerm,
                        fromPage: false
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
                    searchTerm,
                    fromPage: item.fromPage === true
                };
            }
        }));
    }

    return { install };
})();

window.PlayerCommands = PlayerCommands;
