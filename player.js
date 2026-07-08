// @ts-check
// Voice music controller — composes player-storage, player-api-keys,
// player-commands, player-playlist, and player-lyrics modules.

class VoiceMusicController {
    constructor() {
        /** @type {VoiceCommandCore | null} */
        this.voiceCore = null;
        // The single authoritative location for all playback state: status,
        // the reused YouTube player handle and its readiness, the active/
        // current item, the playlist cursor, and playback intents all live
        // only here. Other modules read through this.playback and the thin
        // accessors installed by PlayerPlaylist; they never store playback
        // state of their own.
        /** @type {PlaybackState} */
        this.playback = new PlaybackState();
        /** @type {Map<number, { promise: Promise<any>, resolve: Function, settled?: boolean }>} */
        this.playerReadyPromises = new Map();
        /** @type {Map<number, YouTubeVideoCandidate[]>} */
        this.youtubeAlternateResults = new Map();
        /** @type {Set<number>} Items that already got one fresh-alternates search after a load failure */
        this.alternateVideoSearchAttempts = new Set();
        /** @type {AppConfig | null} */
        this.config = null;
        /** @type {PlaylistItem[]} */
        this.playlist = [];
        /** @type {PlayerAppSettings} */
        this.settings = PlayerStorage.loadSettings({
            readClaudeResponse: false,
            autoSubmitMode: true,
            claudeModel: 'claude-opus-4-8',
            openaiModel: 'gpt-5.5',
            aiProvider: 'claude',
            lyricsOnNowPlaying: true,
            showSongNotes: false
        });
        /** @type {string} Live playlist view filter (normalized; never persisted) */
        this.playlistFilterQuery = '';
        /** @type {string} Live Known Songs search query (normalized; never persisted) */
        this.knownSongsQuery = '';
        this.normalizeLlmSettings();
        /** @type {ReturnType<typeof setTimeout> | null} Deadline-clock wake-up (see scheduleNextProgressRender) */
        this.progressUpdateTimer = null;
        /** @type {number | null} Media time at the last render; detects buffering stalls */
        this.lastRenderedMediaTime = null;
        /** @type {boolean} */
        this.isDraggingProgress = false;
        /** @type {Record<string, FavoriteData>} */
        this.favorites = PlayerStorage.loadFavorites();
        /** @type {SongLibraryStore} Hydrated from IndexedDB in init (hydrateSongLibrary) */
        this.songLibrary = { songs: [] };
        /** @type {Map<string, LyricsResult[] | null>} */
        this.lyricsLookupCache = new Map();
        /** @type {PlaylistItem[]} Items awaiting a background lyric lookup */
        this.lyricsFetchQueue = [];
        /** @type {number} Lyric lookups currently in flight (bounded) */
        this.lyricsFetchActive = 0;
        /** @type {Map<string, Promise<LyricStateRecord>>} One shared resolution flight per videoId */
        this.lyricsLookupsInFlight = new Map();
        this.lyricsViewSettings = PlayerStorage.loadLyricsViewSettings();
        /** @type {boolean} */
        this.lyricsPanelVisible = false;
        /** @type {boolean} */
        this.lyricsPanelDismissed = false;
        /** @type {number | null} */
        this.currentLyricsItemId = null;
        /** @type {number} */
        this.currentLyricsLineIndex = -1;
        /** @type {boolean} Whether the now-playing text currently shows a lyric line */
        this.nowPlayingShowsLyric = false;
        /** @type {boolean} Media-key handlers registered (once per page life) */
        this.mediaActionHandlersSet = false;
        /** @type {boolean} */
        this.isProcessingCommand = false;
        /** @type {TranscriptManager | null} Set from the voice core in setupVoiceCore */
        this.transcript = null;

        PlayerCommands.install(this);
        PlayerPlaylist.install(this);
        PlayerLyrics.install(this);
        PlayerSongLibrary.install(this);
        PlayerHistoryUI.install(this);

        this.init();
    }

    saveFavorites() {
        PlayerStorage.saveFavorites(this.favorites);
    }

    saveLyricsViewSettings() {
        PlayerStorage.saveLyricsViewSettings(this.lyricsViewSettings);
    }

    get isListening() {
        return this.voiceCore ? this.voiceCore.isListening : false;
    }

    async init() {
        try {
            if (window.PlayerHistoryDB) {
                window.PlayerHistoryDB.setNoticeHandler((message) => {
                    this.addMessage('claude', 'History storage', message);
                });
            }
            await this.loadConfig();
            this.setupUI();
            this.applyLyricsViewSettings();
            this.setupYouTubeAPI();
            await this.hydrateSongLibrary();
            // Per-song lyric reconciliation over the favorites library:
            // already-resolved songs settle from the permanent store,
            // unresolved ones get looked up through the bounded queue.
            this.reconcileLibraryLyrics();
            this.restoreSavedPlaylist();
            this.loadDemoSongIfRequested();
        } catch (error) {
            this.logError('Initialization error', error);
        }
    }

    setupErrorHandling() {
        // Global error handler
        window.addEventListener('error', (event) => {
            this.logError('JavaScript Error', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error
            });
        });

        // Unhandled promise rejection handler
        window.addEventListener('unhandledrejection', (event) => {
            this.logError('Unhandled Promise Rejection', {
                reason: event.reason,
                promise: event.promise
            });
        });
    }

    addMessage(type, label, text) {
        const logContent = document.getElementById('logContent');
        if (!logContent) return;

        const timestamp = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const line = document.createElement('div');
        line.className = `log-line log-${type}`;
        line.textContent = `[${timestamp}] ${label}: ${text}`;

        logContent.appendChild(line);
        logContent.scrollTop = logContent.scrollHeight;

        if (window.PlayerHistoryDB) {
            window.PlayerHistoryDB.recordLog({
                type,
                label,
                text: String(text),
                line: line.textContent || ''
            });
        }
    }

    logUserMessage(text) {
        this.addMessage('user', 'You:', text);
    }

    logClaudeMessage(text) {
        this.addMessage('claude', 'Claude:', text);
    }

    logError(label, error) {
        let errorText = '';
        if (error instanceof Error) {
            errorText = `${error.name}: ${error.message}`;
            if (error.stack) {
                errorText += `\n${error.stack}`;
            }
        } else if (typeof error === 'object') {
            errorText = JSON.stringify(error, null, 2);
        } else {
            errorText = String(error);
        }
        this.addMessage('error', `Error: ${label}`, errorText);
    }

    toggleLogPanel() {
        const container = document.getElementById('logContainer');
        const content = document.getElementById('logContent');
        const toggleBtn = document.getElementById('logToggleBtn');
        const selectBtn = document.getElementById('selectAllLogBtn');
        const copyBtn = document.getElementById('copyAllLogBtn');
        const clearBtn = document.getElementById('clearLogBtn');
        if (!container || !content) return;

        const isCollapsed = container.classList.toggle('collapsed');
        content.style.display = isCollapsed ? 'none' : '';
        if (toggleBtn) toggleBtn.textContent = isCollapsed ? 'Show' : 'Hide';
        if (selectBtn) selectBtn.style.display = isCollapsed ? 'none' : '';
        if (copyBtn) copyBtn.style.display = isCollapsed ? 'none' : '';
        if (clearBtn) clearBtn.style.display = isCollapsed ? 'none' : '';
    }

    clearLog() {
        const logContent = document.getElementById('logContent');
        if (logContent) {
            logContent.innerHTML = '';
        }
    }

    selectAllLog() {
        const logContent = document.getElementById('logContent');
        if (logContent) {
            const range = document.createRange();
            range.selectNodeContents(logContent);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    copyAllLog() {
        const logContent = document.getElementById('logContent');
        if (logContent) {
            const text = logContent.innerText;
            navigator.clipboard.writeText(text).then(() => {
                this.updateStatus('Log copied to clipboard');
            }).catch(err => {
                // Fallback: select and use document.execCommand
                this.selectAllLog();
                document.execCommand('copy');
                this.updateStatus('Log copied to clipboard');
            });
        }
    }

    async testProxy() {
        // Test if the server-side proxy is available
        try {
            const response = await fetch('proxy.php?test=1');
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'Proxy is working') {
                    this.addMessage('claude', 'Proxy Test', 'Server-side proxy is working');
                } else {
                    this.addMessage('error', 'Proxy Test', 'Unexpected response from proxy');
                }
            } else {
                this.addMessage('error', 'Proxy Test', `Proxy returned HTTP ${response.status}`);
            }
        } catch (error) {
            this.addMessage('error', 'Proxy Test', `Could not reach proxy: ${error.message}`);
        }
    }

    async loadConfig() {
        this.config = PlayerApiKeys.loadConfig();

        if (this.config.claudeApiKey) {
            const keyPreview = this.config.claudeApiKey.substring(0, 10) + '...';
            this.addMessage('claude', 'Claude API Key', `Loaded (${keyPreview})`);
        }
        if (this.config.openaiApiKey) {
            const keyPreview = this.config.openaiApiKey.substring(0, 10) + '...';
            this.addMessage('claude', 'OpenAI API Key', `Loaded (${keyPreview})`);
        }

        const hasAnyKey = this.config.claudeApiKey || this.config.openaiApiKey;

        if (hasAnyKey) {
            this.updateStatus('Ready');
            this.hideApiKeyOverlay();

            if (!this.config.claudeApiKey && this.config.openaiApiKey) {
                this.settings.aiProvider = 'openai';
            }
        } else {
            this.addMessage('claude', 'API Keys', 'Not configured - please enter an API key');
            this.updateStatus('API key required');
            this.showApiKeyOverlay();
        }

        this.updateAllApiKeyUI();
        this.addMessage('claude', 'YouTube Search', `Using server-side proxy (proxy.php) - no API key needed`);
        this.testProxy();
    }

    showApiKeyOverlay() {
        const overlay = document.getElementById('apiKeyOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
    }

    hideApiKeyOverlay() {
        const overlay = document.getElementById('apiKeyOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    updateAllApiKeyUI() {
        // Update Claude API key UI
        this.updateApiKeyUIForProvider('claude', !!this.config?.claudeApiKey);
        // Update OpenAI API key UI
        this.updateApiKeyUIForProvider('openai', !!this.config?.openaiApiKey);
        // Update provider visibility
        this.updateProviderVisibility();
    }

    updateApiKeyUIForProvider(provider, hasKey) {
        const statusEl = document.getElementById(`${provider}ApiKeyStatus`);
        const inputRow = document.getElementById(`${provider}ApiKeyInputRow`);
        const actionsRow = document.getElementById(`${provider}ApiKeyActions`);

        if (!statusEl || !inputRow || !actionsRow) return;

        if (hasKey) {
            const preview = PlayerApiKeys.preview(provider);
            statusEl.textContent = `Configured: ${preview}`;
            statusEl.className = 'api-key-status configured';
            inputRow.style.display = 'none';
            actionsRow.style.display = 'flex';
        } else {
            statusEl.textContent = 'Not configured';
            statusEl.className = 'api-key-status not-configured';
            inputRow.style.display = 'flex';
            actionsRow.style.display = 'none';
        }
    }

    updateProviderVisibility() {
        const provider = this.settings.aiProvider;

        // Settings panel sections
        const claudeSection = document.getElementById('claudeApiSection');
        const openaiSection = document.getElementById('openaiApiSection');
        const claudeModelSection = document.getElementById('claudeModelSection');
        const openaiModelSection = document.getElementById('openaiModelSection');

        if (claudeSection) claudeSection.style.display = provider === 'claude' ? 'block' : 'none';
        if (openaiSection) openaiSection.style.display = provider === 'openai' ? 'block' : 'none';
        if (claudeModelSection) claudeModelSection.style.display = provider === 'claude' ? 'block' : 'none';
        if (openaiModelSection) openaiModelSection.style.display = provider === 'openai' ? 'block' : 'none';
    }

    saveApiKeyForProvider(provider, apiKey) {
        if (!apiKey || apiKey.length < 10) {
            this.updateStatus('Invalid API key');
            return false;
        }

        PlayerApiKeys.set(provider, apiKey);

        if (provider === 'claude') {
            this.config.claudeApiKey = apiKey;
        } else {
            this.config.openaiApiKey = apiKey;
        }

        const keyPreview = apiKey.substring(0, 10) + '...';
        this.addMessage('claude', `${provider === 'claude' ? 'Claude' : 'OpenAI'} API Key`, `Saved (${keyPreview})`);
        this.updateStatus('Ready');
        this.hideApiKeyOverlay();
        this.updateApiKeyUIForProvider(provider, true);

        // Set this provider as active if it wasn't already
        this.settings.aiProvider = provider;
        this.saveSettings();
        this.updateProviderVisibility();

        // Reflect the active provider in the segmented pill control
        PracticeControls.syncSingleSelect('data-ai-provider', provider);

        return true;
    }

    removeApiKeyForProvider(provider) {
        PlayerApiKeys.remove(provider);

        if (provider === 'claude') {
            delete this.config.claudeApiKey;
        } else {
            delete this.config.openaiApiKey;
        }

        this.addMessage('claude', `${provider === 'claude' ? 'Claude' : 'OpenAI'} API Key`, 'Removed');
        this.updateApiKeyUIForProvider(provider, false);

        // Check if we still have at least one key
        const hasAnyKey = this.config?.claudeApiKey || this.config?.openaiApiKey;
        if (!hasAnyKey) {
            this.updateStatus('API key required');
            this.showApiKeyOverlay();
        } else {
            // Switch to the other provider
            this.settings.aiProvider = provider === 'claude' ? 'openai' : 'claude';
            this.saveSettings();
            this.updateProviderVisibility();
        }
    }

    updateApiKeyUI(hasKey) {
        this.updateApiKeyUIForProvider('claude', hasKey);
    }

    saveApiKey(apiKey) {
        return this.saveApiKeyForProvider('claude', apiKey);
    }

    removeApiKey() {
        this.removeApiKeyForProvider('claude');
    }

    setupApiKeyUI() {
        // Setup for both Claude and OpenAI providers
        this.setupProviderApiKeyUI('claude');
        this.setupProviderApiKeyUI('openai');

        // AI provider and OpenAI model use the canonical segmented pill control
        // (same as the Claude model picker), not raw selects.
        PracticeControls.syncSingleSelect('data-ai-provider', this.settings.aiProvider);
        PracticeControls.wireSingleSelect('data-ai-provider', String, this.settings.aiProvider, value => {
            this.settings.aiProvider = value;
            this.saveSettings();
            this.updateProviderVisibility();
            this.syncQueryModelPills();
        });

        PracticeControls.syncSingleSelect('data-openai-model', this.settings.openaiModel);
        PracticeControls.wireSingleSelect('data-openai-model', String, this.settings.openaiModel, value => {
            this.settings.openaiModel = value;
            this.saveSettings();
            this.syncQueryModelPills();
        });

        // Overlay save buttons
        const claudeOverlayInput = /** @type {HTMLInputElement | null} */ (document.getElementById('claudeApiKeyOverlayInput'));
        const claudeOverlaySaveBtn = document.getElementById('saveClaudeApiKeyOverlayBtn');
        if (claudeOverlaySaveBtn && claudeOverlayInput) {
            claudeOverlaySaveBtn.addEventListener('click', () => {
                this.saveApiKeyForProvider('claude', claudeOverlayInput.value.trim());
                claudeOverlayInput.value = '';
            });
            claudeOverlayInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.saveApiKeyForProvider('claude', claudeOverlayInput.value.trim());
                    claudeOverlayInput.value = '';
                }
            });
        }

        const openaiOverlayInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyOverlayInput'));
        const openaiOverlaySaveBtn = document.getElementById('saveOpenaiApiKeyOverlayBtn');
        if (openaiOverlaySaveBtn && openaiOverlayInput) {
            openaiOverlaySaveBtn.addEventListener('click', () => {
                this.saveApiKeyForProvider('openai', openaiOverlayInput.value.trim());
                openaiOverlayInput.value = '';
            });
            openaiOverlayInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.saveApiKeyForProvider('openai', openaiOverlayInput.value.trim());
                    openaiOverlayInput.value = '';
                }
            });
        }

        // Initialize visibility
        this.updateProviderVisibility();
    }

    setupProviderApiKeyUI(provider) {
        const prefix = provider === 'claude' ? 'Claude' : 'Openai';

        const saveBtn = document.getElementById(`save${prefix}ApiKeyBtn`);
        const showBtn = document.getElementById(`show${prefix}ApiKeyBtn`);
        const changeBtn = document.getElementById(`change${prefix}ApiKeyBtn`);
        const removeBtn = document.getElementById(`remove${prefix}ApiKeyBtn`);
        const inputEl = /** @type {HTMLInputElement | null} */ (document.getElementById(`${provider}ApiKeyInput`));

        if (saveBtn && inputEl) {
            saveBtn.addEventListener('click', () => {
                this.saveApiKeyForProvider(provider, inputEl.value.trim());
                inputEl.value = '';
            });
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.saveApiKeyForProvider(provider, inputEl.value.trim());
                    inputEl.value = '';
                }
            });
        }

        if (showBtn) {
            showBtn.addEventListener('click', () => {
                const storedKey = PlayerApiKeys.get(provider);
                if (showBtn.textContent === 'Show') {
                    const statusEl = document.getElementById(`${provider}ApiKeyStatus`);
                    if (statusEl) statusEl.textContent = storedKey;
                    showBtn.textContent = 'Hide';
                } else {
                    this.updateApiKeyUIForProvider(provider, true);
                    showBtn.textContent = 'Show';
                }
            });
        }

        if (changeBtn) {
            changeBtn.addEventListener('click', () => {
                const inputRow = document.getElementById(`${provider}ApiKeyInputRow`);
                const actionsRow = document.getElementById(`${provider}ApiKeyActions`);
                if (inputRow) inputRow.style.display = 'flex';
                if (actionsRow) actionsRow.style.display = 'none';
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (confirm(`Remove your ${provider === 'claude' ? 'Claude' : 'OpenAI'} API key from localStorage?`)) {
                    this.removeApiKeyForProvider(provider);
                }
            });
        }
    }

    setupVoiceCore() {
        this.voiceCore = new VoiceCommandCore({
            settings: { autoSubmitMode: this.settings.autoSubmitMode },
            onBeforeListen: () => {
                // Pause playback while listening - music interferes with
                // recognition accuracy. Resumes during the Claude wait
                // (processMusicSearch), pauses again when the response lands.
                this.wasPlayingBeforeListening = this.isPlaying && !this.isPaused;
                if (this.wasPlayingBeforeListening) {
                    this.pausePlayback();
                }
            },
            onError: (/** @type {string} */ msg) => this.logError('Voice recognition', { message: msg })
        });

        // Transport/control commands ("pause", "next", "shuffle"...) run locally
        this.voiceCore.registerHandler({
            parse: (/** @type {string} */ transcript) => this.parseControlCommand(transcript),
            execute: async (/** @type {any} */ command, /** @type {string} */ transcript) => {
                this.hideClaudeResponse();
                this.logUserMessage(transcript);
                this.executeControlCommand(command);
                this.hidePrompt();
                // Control commands manage their own playback state
                this.wasPlayingBeforeListening = false;
            }
        });

        // Everything else is a music request for Claude
        this.voiceCore.setFallbackHandler(async (/** @type {string} */ transcript) => {
            await this.processMusicSearch(transcript);
        });

        this.voiceCore.init();
        this.transcript = this.voiceCore.transcript;

        // The core's init sets status to Ready; keep the key-gate message
        if (!(this.config?.claudeApiKey || this.config?.openaiApiKey)) {
            this.updateStatus('API key required');
        }
    }

    setupUI() {
        // Setup API key management UI
        this.setupApiKeyUI();

        // Settings panel
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsPanel = document.getElementById('settingsPanel');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');

        settingsBtn.addEventListener('click', () => {
            settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
        });

        closeSettingsBtn.addEventListener('click', () => {
            settingsPanel.style.display = 'none';
        });

        // Update UI with saved settings
        const readClaudeEl = /** @type {HTMLInputElement | null} */ (document.getElementById('readClaudeResponse'));
        const autoSubmitEl = /** @type {HTMLInputElement | null} */ (document.getElementById('autoSubmitMode'));

        if (readClaudeEl) readClaudeEl.checked = this.settings.readClaudeResponse;
        if (autoSubmitEl) autoSubmitEl.checked = this.settings.autoSubmitMode;
        PracticeControls.syncSingleSelect('data-claude-model', this.settings.claudeModel);
        this.updateModeToggle();

        // Voice recognition (shared core) - created after settings restore
        // so the saved auto/manual mode applies from the start. The core
        // wires the Listen and Submit buttons itself.
        this.setupVoiceCore();

        // Settings change handlers - use 'input' for immediate response as user adjusts
        if (readClaudeEl) readClaudeEl.addEventListener('input', (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            this.settings.readClaudeResponse = target.checked;
            this.saveSettings();
        });

        const lyricsNowPlayingEl = /** @type {HTMLInputElement | null} */ (document.getElementById('lyricsOnNowPlayingToggle'));
        if (lyricsNowPlayingEl) {
            lyricsNowPlayingEl.checked = this.settings.lyricsOnNowPlaying;
            lyricsNowPlayingEl.addEventListener('input', (e) => {
                const target = /** @type {HTMLInputElement} */ (e.target);
                this.settings.lyricsOnNowPlaying = target.checked;
                this.saveSettings();
                this.relayLyricToNowPlaying(target.checked ? this.currentLyricsLineIndex : -1);
            });
        }

        if (autoSubmitEl) autoSubmitEl.addEventListener('input', (e) => {
            const target = /** @type {HTMLInputElement} */ (e.target);
            this.setAutoSubmitMode(target.checked);
        });

        PracticeControls.wireSingleSelect('data-claude-model', String, this.settings.claudeModel, value => {
            this.settings.claudeModel = value;
            this.saveSettings();
            this.syncQueryModelPills();
        });

        // Mode toggle button (if it exists in the UI). Listen and Submit
        // buttons are wired by the voice core.
        const modeToggleBtn = document.getElementById('modeToggleBtn');
        if (modeToggleBtn) {
            modeToggleBtn.addEventListener('click', () => {
                this.setAutoSubmitMode(!this.settings.autoSubmitMode);
                // Also update the settings checkbox
                const autoSubmitCheckbox = /** @type {HTMLInputElement | null} */ (document.getElementById('autoSubmitMode'));
                if (autoSubmitCheckbox) {
                    autoSubmitCheckbox.checked = this.settings.autoSubmitMode;
                }
            });
            this.updateModeToggle();
        }

        // Per-query model chooser: the same persisted provider/model
        // settings, reachable at the request box. Both surfaces stay in
        // sync through syncQueryModelPills / the settings-panel pickers.
        PracticeControls.syncSingleSelect('data-query-model', this.activeQueryModelValue());
        PracticeControls.wireSingleSelect('data-query-model', String, this.activeQueryModelValue(), value => {
            const [provider, model] = String(value).split('|');
            this.settings.aiProvider = provider;
            if (provider === 'claude') {
                this.settings.claudeModel = model;
            } else {
                this.settings.openaiModel = model;
            }
            this.saveSettings();
            this.updateProviderVisibility();
            PracticeControls.syncSingleSelect('data-ai-provider', provider);
            PracticeControls.syncSingleSelect('data-claude-model', this.settings.claudeModel);
            PracticeControls.syncSingleSelect('data-openai-model', this.settings.openaiModel);
        });

        const apiKeyProblemDismissBtn = document.getElementById('apiKeyProblemDismissBtn');
        if (apiKeyProblemDismissBtn) {
            apiKeyProblemDismissBtn.addEventListener('click', () => this.hideApiKeyProblem());
        }

        const typedCommandInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('typedCommandInput'));
        const typedCommandSubmitBtn = document.getElementById('typedCommandSubmitBtn');
        if (typedCommandSubmitBtn) {
            typedCommandSubmitBtn.addEventListener('click', () => {
                this.submitTypedCommand();
            });
        }
        if (typedCommandInput) {
            typedCommandInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    this.submitTypedCommand();
                }
            });
        }

        // Log toggle: both button and header label
        const logToggleBtn = document.getElementById('logToggleBtn');
        if (logToggleBtn) {
            logToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleLogPanel();
            });
        }
        const logHeader = document.getElementById('logHeader');
        if (logHeader) {
            logHeader.addEventListener('click', () => {
                this.toggleLogPanel();
            });
        }

        const clearLogBtn = document.getElementById('clearLogBtn');
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', () => {
                this.clearLog();
            });
        }

        const selectAllLogBtn = document.getElementById('selectAllLogBtn');
        if (selectAllLogBtn) {
            selectAllLogBtn.addEventListener('click', () => {
                this.selectAllLog();
            });
        }

        const copyAllLogBtn = document.getElementById('copyAllLogBtn');
        if (copyAllLogBtn) {
            copyAllLogBtn.addEventListener('click', () => {
                this.copyAllLog();
            });
        }

        // Setup global error handlers
        this.setupErrorHandling();

        // Playlist control buttons
        const playPauseBtn = document.getElementById('playPauseBtn');
        playPauseBtn.addEventListener('click', () => {
            this.togglePlayPause();
        });

        const nextBtn = document.getElementById('nextBtn');
        nextBtn.addEventListener('click', () => {
            this.playNext();
        });

        const prevBtn = document.getElementById('prevBtn');
        prevBtn.addEventListener('click', () => {
            this.playPrevious();
        });

        const stopBtn = document.getElementById('stopBtn');
        stopBtn.addEventListener('click', () => {
            this.stopPlayback();
        });

        const rewindBtn = document.getElementById('rewindBtn');
        rewindBtn.addEventListener('click', () => {
            this.rewind();
        });

        const forwardBtn = document.getElementById('forwardBtn');
        forwardBtn.addEventListener('click', () => {
            this.fastForward();
        });

        // Playlist header actions: order, shuffle, clear
        const clearPlaylistBtn = document.getElementById('clearPlaylistBtn');
        if (clearPlaylistBtn) {
            clearPlaylistBtn.addEventListener('click', () => {
                this.clearPlaylist();
                this.updateStatus('Playlist cleared');
            });
        }

        const shufflePlaylistBtn = document.getElementById('shufflePlaylistBtn');
        if (shufflePlaylistBtn) {
            shufflePlaylistBtn.addEventListener('click', () => {
                this.shufflePlaylist();
                this.updateStatus('Playlist shuffled');
            });
        }

        const sortArtistBtn = document.getElementById('sortPlaylistArtistBtn');
        if (sortArtistBtn) {
            sortArtistBtn.addEventListener('click', () => this.sortPlaylist('artist'));
        }

        const sortYearBtn = document.getElementById('sortPlaylistYearBtn');
        if (sortYearBtn) {
            sortYearBtn.addEventListener('click', () => this.sortPlaylist('year'));
        }

        // Live playlist view filter: filter as you type, cancel to see all
        const playlistFilterInput = /** @type {HTMLInputElement | null} */ (document.getElementById('playlistFilterInput'));
        if (playlistFilterInput) {
            playlistFilterInput.addEventListener('input', () => {
                this.setPlaylistFilter(playlistFilterInput.value);
            });
        }
        const playlistFilterCancelBtn = document.getElementById('playlistFilterCancelBtn');
        if (playlistFilterCancelBtn) {
            playlistFilterCancelBtn.addEventListener('click', () => {
                this.clearPlaylistFilter();
            });
        }

        // Song notes display toggle: instant, CSS-driven
        PracticeControls.wireToggle('playlistNotesToggle', this.settings.showSongNotes, checked => {
            this.settings.showSongNotes = checked;
            this.saveSettings();
            this.applySongNotesVisibility();
        });
        this.applySongNotesVisibility();

        const loadFavoritesBtnMain = document.getElementById('loadFavoritesBtnMain');
        if (loadFavoritesBtnMain) {
            loadFavoritesBtnMain.addEventListener('click', () => {
                this.loadFavoritesToPlaylist();
            });
        }

        this.setupSongLibraryUI();
        this.setupMusicHistoryUI();

        // The sticky control line: play/pause, seek jumps, and the
        // current-song button that navigates to its row in the list.
        const transportPlayPauseBtn = document.getElementById('transportPlayPauseBtn');
        if (transportPlayPauseBtn) {
            transportPlayPauseBtn.addEventListener('click', () => this.togglePlayPause());
        }
        /** @type {Array<[string, number]>} */
        const seekBindings = [
            ['transportBack30Btn', -30],
            ['transportBack10Btn', -10],
            ['transportFwd10Btn', 10],
            ['transportFwd30Btn', 30]
        ];
        for (const [id, seconds] of seekBindings) {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', () => this.seekBy(seconds));
        }
        const transportBarInfo = document.getElementById('transportBarInfo');
        if (transportBarInfo) {
            transportBarInfo.addEventListener('click', () => this.scrollToCurrentSong());
        }

        const lyricsPanelBtn = document.getElementById('lyricsPanelBtn');
        if (lyricsPanelBtn) {
            lyricsPanelBtn.addEventListener('click', () => {
                this.toggleLyricsPanel();
            });
        }

        const lyricsHideBtn = document.getElementById('lyricsHideBtn');
        if (lyricsHideBtn) {
            lyricsHideBtn.addEventListener('click', () => {
                this.setLyricsPanelVisible(false);
            });
        }

        const lyricsOverlayBtn = document.getElementById('lyricsOverlayBtn');
        if (lyricsOverlayBtn) {
            lyricsOverlayBtn.addEventListener('click', () => {
                this.openLyricsOverlay();
            });
        }

        const lyricsOverlayCloseBtn = document.getElementById('lyricsOverlayCloseBtn');
        if (lyricsOverlayCloseBtn) {
            lyricsOverlayCloseBtn.addEventListener('click', () => {
                this.closeLyricsOverlay();
            });
        }

        const lyricsOverlaySettingsBtn = document.getElementById('lyricsOverlaySettingsBtn');
        if (lyricsOverlaySettingsBtn) {
            lyricsOverlaySettingsBtn.addEventListener('click', () => {
                this.toggleLyricsConfig();
            });
        }

        const lyricsOverlayConfig = document.getElementById('lyricsOverlayConfig');
        if (lyricsOverlayConfig) {
            lyricsOverlayConfig.addEventListener('click', (e) => {
                if (e.target === lyricsOverlayConfig) {
                    this.closeLyricsConfig();
                }
            });
        }

        const lyricsFontDownBtn = document.getElementById('lyricsFontDownBtn');
        if (lyricsFontDownBtn) {
            lyricsFontDownBtn.addEventListener('click', () => {
                this.adjustLyricsFontScale(-0.12);
            });
        }

        const lyricsFontUpBtn = document.getElementById('lyricsFontUpBtn');
        if (lyricsFontUpBtn) {
            lyricsFontUpBtn.addEventListener('click', () => {
                this.adjustLyricsFontScale(0.12);
            });
        }

        const lyricsWidthToggleBtn = document.getElementById('lyricsWidthToggleBtn');
        if (lyricsWidthToggleBtn) {
            lyricsWidthToggleBtn.addEventListener('click', () => {
                this.lyricsViewSettings.widthMode = this.lyricsViewSettings.widthMode === 'wide' ? 'focus' : 'wide';
                this.applyLyricsViewSettings();
            });
        }

        const lyricsAlignToggleBtn = document.getElementById('lyricsAlignToggleBtn');
        if (lyricsAlignToggleBtn) {
            lyricsAlignToggleBtn.addEventListener('click', () => {
                this.lyricsViewSettings.align = this.lyricsViewSettings.align === 'center' ? 'left' : 'center';
                this.applyLyricsViewSettings();
            });
        }

        const lyricsSpacingToggleBtn = document.getElementById('lyricsSpacingToggleBtn');
        if (lyricsSpacingToggleBtn) {
            lyricsSpacingToggleBtn.addEventListener('click', () => {
                this.lyricsViewSettings.spacing = this.lyricsViewSettings.spacing === 'roomy' ? 'tight' : 'roomy';
                this.applyLyricsViewSettings();
            });
        }

        const lyricsBackdropToggleBtn = document.getElementById('lyricsBackdropToggleBtn');
        if (lyricsBackdropToggleBtn) {
            lyricsBackdropToggleBtn.addEventListener('click', () => {
                this.lyricsViewSettings.backdrop = this.lyricsViewSettings.backdrop === 'dim' ? 'blackout' : 'dim';
                this.applyLyricsViewSettings();
            });
        }

        /** @type {Array<[string, () => void]>} */
        const transportBindings = [
            ['lyricsTransportPrev', () => this.playPrevious()],
            ['lyricsTransportRestart', () => this.restartCurrentTrack()],
            ['lyricsTransportRewind', () => this.rewind()],
            ['lyricsTransportPause', () => this.togglePlayPause()],
            ['lyricsTransportFwd', () => this.fastForward()],
            ['lyricsTransportNext', () => this.playNext()],
        ];
        for (const [id, handler] of transportBindings) {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', handler);
        }

        // Progress bar interactions
        this.setupProgressBar();
        this.updateLyricsButtonLabels();
    }

    stopListening() {
        this.voiceCore?.stopListening();
    }

    setAutoSubmitMode(enabled) {
        this.settings.autoSubmitMode = enabled;
        this.saveSettings();
        this.updateModeToggle();
        // The core resets the transcript and stops listening on mode change
        this.voiceCore?.setAutoSubmitMode(enabled);
    }

    updateSubmitButton(show) {
        this.voiceCore?.updateSubmitButton(show);
    }

    updateModeToggle() {
        const modeToggleBtn = document.getElementById('modeToggleBtn');
        const modeLabel = document.getElementById('modeLabel');
        if (modeToggleBtn && modeLabel) {
            if (this.settings.autoSubmitMode) {
                modeLabel.textContent = 'Auto-Send';
                modeToggleBtn.classList.remove('manual-mode');
                modeToggleBtn.title = 'Sends when you pause speaking. Tap to switch to Hold mode.';
            } else {
                modeLabel.textContent = 'Hold Mode';
                modeToggleBtn.classList.add('manual-mode');
                modeToggleBtn.title = 'Keeps listening until you say "submit". Tap to switch to Auto.';
            }
        }
    }

    saveSettings() {
        PlayerStorage.saveSettings(this.settings);
    }

    /** The provider|model pair the next request will use (query pills). */
    activeQueryModelValue() {
        return this.settings.aiProvider === 'openai'
            ? `openai|${this.settings.openaiModel}`
            : `claude|${this.settings.claudeModel}`;
    }

    /** The exact model id the next request will use, for status/log lines. */
    activeModelLabel() {
        return this.settings.aiProvider === 'openai' ? this.settings.openaiModel : this.settings.claudeModel;
    }

    syncQueryModelPills() {
        PracticeControls.syncSingleSelect('data-query-model', this.activeQueryModelValue());
    }

    /**
     * A key-level provider failure (invalid key, spend/rate limit,
     * billing) must be unmissable: the status line scrolls away and log
     * lines are easy to miss, so this shows a persistent banner naming
     * the provider, the exact error, and where to fix it.
     * @param {Error & { provider?: string, status?: number }} error
     */
    showApiKeyProblem(error) {
        const banner = document.getElementById('apiKeyProblemBanner');
        const text = document.getElementById('apiKeyProblemText');
        if (!banner || !text) return;
        const provider = error.provider === 'openai' ? 'OpenAI' : 'Claude';
        const consoleUrl = error.provider === 'openai' ? 'platform.openai.com' : 'console.anthropic.com';
        text.textContent = `${provider} API key problem${error.status ? ` (HTTP ${error.status})` : ''}: ${error.message} - check limits/billing at ${consoleUrl}`;
        banner.style.display = 'flex';
        if (this.settings.readClaudeResponse) {
            this.speakText(`Your ${provider} API key hit a problem: ${error.message}`);
        }
    }

    hideApiKeyProblem() {
        const banner = document.getElementById('apiKeyProblemBanner');
        if (banner) banner.style.display = 'none';
    }

    normalizeLlmSettings() {
        const claudeAliases = {
            'claude-opus-4-5-20251101': 'claude-opus-4-8',
            'claude-opus-4-5': 'claude-opus-4-8',
            'claude-sonnet-4-6': 'claude-sonnet-5',
            'claude-haiku-4-5-20250514': 'claude-haiku-4-5',
            'claude-haiku-4-5-20251001': 'claude-haiku-4-5'
        };
        const openaiAliases = {
            'gpt-4o': 'gpt-5.5',
            'gpt-4o-mini': 'gpt-4.1',
            'gpt-5.2': 'gpt-5.4'
        };
        this.settings.claudeModel = claudeAliases[this.settings.claudeModel] || this.settings.claudeModel || 'claude-opus-4-8';
        this.settings.openaiModel = openaiAliases[this.settings.openaiModel] || this.settings.openaiModel || 'gpt-5.5';
    }

    async submitTypedCommand() {
        if (this.isProcessingCommand) {
            return;
        }

        const typedCommandInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('typedCommandInput'));
        const textToSubmit = typedCommandInput?.value.trim() || '';
        if (!textToSubmit) {
            this.updateStatus('Type a music request first');
            typedCommandInput?.focus();
            return;
        }

        if (this.isListening) {
            this.stopListening();
        }

        // No refocus after the search returns: grabbing the text box would
        // pop the keyboard / steal focus mid-listen on the results.
        await this.processMusicSearch(textToSubmit);
    }

    updateStatus(message) {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    async processMusicSearch(transcript) {
        const requestText = transcript.trim();
        if (!requestText) {
            this.updateStatus('Enter a music request first');
            return;
        }

        this.hideClaudeResponse();
        this.logUserMessage(requestText);
        this.transcript.show(requestText);

        if (this.wasPlayingBeforeListening) {
            this.playPlaylist();
        }

        this.isProcessingCommand = true;
        this.updateSubmitButton(true);
        this.updateTypedCommandUI(true);
        this.updateStatus(`Processing with ${this.activeModelLabel()}...`);

        try {
            const result = await this.processCommandWithLLM(requestText);
            this.hideApiKeyProblem();

            // Music that resumed during the Claude wait keeps playing while
            // the YouTube searches run and the new playlist fills in.
            this.wasPlayingBeforeListening = false;

            if (!result || !result.songList || result.songList.length === 0) {
                this.updateStatus('No songs found. Try again.');
                this.hidePrompt();
                if (this.settings.readClaudeResponse) {
                    this.speakText('No songs found. Try again.');
                }
                return;
            }

            if (result.prompt) {
                this.showPrompt(result.prompt);
                this.logClaudeMessage(`Prompt sent:\n${result.prompt}`);
            }

            if (window.PlayerHistoryDB) {
                window.PlayerHistoryDB.recordLookup({
                    requestText,
                    provider: this.settings.aiProvider,
                    songCount: result.songList.length,
                    songList: result.songList,
                    promptLength: result.prompt ? result.prompt.length : 0
                });
            }

            this.updateStatus(`Found ${result.songList.length} song(s), searching YouTube...`);
            // A search defines the working playlist; explicit loads
            // (favorites, history) append to it instead.
            const playlistResult = await this.searchAndAddToPlaylist(result.songList, { replaceExisting: true });
            const addedCount = playlistResult?.addedCount || 0;
            const skippedCount = playlistResult?.skippedCount || 0;
            const attemptedTerms = playlistResult?.attemptedTerms || result.songList.map(s => s.searchTerm).filter(Boolean);

            if (addedCount === 0) {
                const termsText = this.formatSearchTermsForDisplay(attemptedTerms);
                this.updateStatus(`No YouTube matches for: ${termsText}`);
                this.addMessage('claude', 'No YouTube matches', `Attempted search terms:\n${attemptedTerms.join('\n')}`);
                return;
            }

            if (this.settings.readClaudeResponse) {
                const songNames = result.songList.map(s => s.searchTerm).slice(0, 3).join(', ');
                const skipText = skippedCount > 0 ? `; ${skippedCount} not added` : '';
                const announcement = `Added ${addedCount} song${addedCount > 1 ? 's' : ''}${skipText}: ${songNames}`;
                await this.speakTextAsync(announcement);
            }

            // A song already playing keeps playing (the new songs queue up
            // behind it); otherwise start the new playlist.
            if (!this.isPlaying) {
                this.playPlaylist();
            }
            this.updateStatus(skippedCount > 0
                ? `Playing ${addedCount} song${addedCount > 1 ? 's' : ''}; ${skippedCount} not added`
                : 'Playing');
        } catch (error) {
            const message = error && error.message ? error.message : 'Music lookup failed';
            if (error && error.name === 'NoSongsFoundError') {
                const requestSummary = this.truncateForStatus(requestText);
                this.updateStatus(`No songs found for: ${requestSummary}`);
                this.addMessage('claude', 'No songs found', `Request that returned no songs:\n${requestText}`);
                if (window.PlayerHistoryDB) {
                    window.PlayerHistoryDB.recordLookup({
                        requestText,
                        provider: this.settings.aiProvider,
                        songCount: 0,
                        songList: [],
                        error: 'NoSongsFoundError'
                    });
                }
                this.hidePrompt();
                if (this.settings.readClaudeResponse) {
                    this.speakText(`No songs found for: ${requestSummary}`);
                }
                return;
            }
            this.logError('Music Lookup Error', error);
            this.updateStatus(`Music lookup failed: ${message}`);
            if (error && error.name === 'ApiKeyError') {
                this.showApiKeyProblem(error);
            } else if (this.settings.readClaudeResponse) {
                this.speakText(`Music lookup failed: ${message}`);
            }
            this.hidePrompt();
        } finally {
            this.wasPlayingBeforeListening = false;
            this.isProcessingCommand = false;
            this.updateSubmitButton(false);
            this.updateTypedCommandUI(false);
        }
    }

    truncateForStatus(text, maxLength = 120) {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (normalized.length <= maxLength) return normalized;
        return `${normalized.slice(0, maxLength - 1)}…`;
    }

    formatSearchTermsForDisplay(terms) {
        const cleanTerms = (terms || []).map(term => String(term || '').trim()).filter(Boolean);
        if (cleanTerms.length === 0) return '(no search terms)';
        return this.truncateForStatus(cleanTerms.join('; '), 160);
    }

    updateTypedCommandUI(busy) {
        const typedCommandInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('typedCommandInput'));
        const typedCommandSubmitBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('typedCommandSubmitBtn'));
        if (typedCommandInput) {
            typedCommandInput.disabled = busy;
        }
        if (typedCommandSubmitBtn) {
            typedCommandSubmitBtn.disabled = busy;
            typedCommandSubmitBtn.textContent = busy ? 'Sending...' : 'Send';
        }
    }

    speakText(text) {
        return this.speakTextAsync(text);
    }

    speakTextAsync(text) {
        if (typeof VoiceOutput !== 'undefined') {
            return VoiceOutput.speak(text);
        }
        console.warn('[VoiceMusicController] VoiceOutput library not loaded');
        return Promise.resolve();
    }

    toggleFavorite(videoId, songData = null) {
        if (this.favorites[videoId]) {
            // Already favorited - remove it
            const oldFavorite = this.favorites[videoId];
            delete this.favorites[videoId];
            this.saveFavorites();
            if (window.PlayerHistoryDB) {
                window.PlayerHistoryDB.recordFavorite(oldFavorite, false);
            }
            return false;
        } else if (songData) {
            // Add to favorites: the Song plus when it was favorited
            const favorite = PlayerSongs.createFavorite(songData);
            if (!favorite) return false;
            this.favorites[videoId] = favorite;
            this.saveFavorites();
            if (window.PlayerHistoryDB) {
                window.PlayerHistoryDB.recordFavorite(favorite, true);
            }
            return true;
        }
        return false;
    }

    isFavorite(videoId) {
        return !!this.favorites[videoId];
    }

    showClaudeResponse(text) {
        // Log to messages panel instead of showing in main UI
        this.addMessage('claude', 'Claude Response:', text);
    }

    hideClaudeResponse() {
        // No-op, responses go to messages panel
    }

    showPrompt(promptText) {
        // Log to messages panel instead of showing in main UI
        this.addMessage('claude', 'Prompt:', promptText);
    }

    hidePrompt() {
        // No-op, prompts go to messages panel
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    window.musicController = new VoiceMusicController();
});
