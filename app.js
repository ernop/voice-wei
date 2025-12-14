//-------DEBUG FLAGS-------
// Skip Claude API calls and return hardcoded test data (for debugging YouTube search)
const SKIP_CLAUDE = false;

//-------TIMING CONSTANTS-------
// Voice recognition restart delay after speech ends (must be short for responsive manual mode)
const RECOGNITION_RESTART_DELAY_MS = 100;

// How often to update the progress bar during playback
const PROGRESS_UPDATE_INTERVAL_MS = 100;

// Seek jump amount for rewind/fast-forward commands
const SEEK_JUMP_SECONDS = 10;

// Brief delay for DOM to settle before creating YouTube player
const DOM_SETTLE_DELAY_MS = 50;

// Retry delay when player isn't ready yet
const PLAYER_RETRY_DELAY_MS = 500;

// How long to poll for YouTube API before giving up
const YOUTUBE_API_TIMEOUT_MS = 10000;

// Polling interval for YouTube API readiness check
const YOUTUBE_API_POLL_INTERVAL_MS = 100;

// Auto-hide delay for control command transcripts (e.g., "play", "pause")
const TRANSCRIPT_AUTO_HIDE_MS = 3000;


//-------TRANSCRIPT MANAGER-------
// Manages the "You said" transcript display box
class TranscriptManager {
    constructor() {
        this.container = null;
        this.textElement = null;
        this.segments = [];      // Finalized speech segments
        this.interimText = '';   // Current interim (unfinalized) text
        this.hideTimeout = null;
    }

    init() {
        this.container = document.getElementById('transcriptContainer');
        this.textElement = document.getElementById('transcript');
    }

    // Show simple text (for final transcripts or commands)
    show(text, options = {}) {
        if (!this.container || !this.textElement) return;

        const { interim = false, autoHideAfter = null } = options;

        this.clearHideTimeout();
        this.textElement.textContent = text;
        this.textElement.style.opacity = interim ? '0.7' : '1';
        this.container.style.display = 'block';

        if (autoHideAfter) {
            this.hideTimeout = setTimeout(() => this.hide(), autoHideAfter);
        }
    }

    // Show accumulated speech segments with visual separators.
    // Manual mode accumulates text across multiple recognition sessions, so user sees
    // their full request building up even as recognition restarts in background.
    showSegments(segments, interimText = '') {
        if (!this.container || !this.textElement) return;

        this.clearHideTimeout();
        this.segments = segments;
        this.interimText = interimText;

        let html = '';
        segments.forEach((seg, i) => {
            if (i > 0) {
                html += '<span class="segment-divider"> | </span>';
            }
            html += `<span class="segment">${this.escapeHtml(seg)}</span>`;
        });

        if (interimText) {
            if (segments.length > 0) {
                html += '<span class="segment-divider"> | </span>';
            }
            html += `<span class="segment interim">${this.escapeHtml(interimText)}</span>`;
        }

        this.textElement.innerHTML = html || '<span class="interim">...</span>';
        this.container.style.display = 'block';
    }

    // Add a finalized segment
    addSegment(text) {
        const trimmed = text.trim();
        if (trimmed) {
            this.segments.push(trimmed);
        }
        this.interimText = '';
    }

    // Update interim text (text still being spoken)
    setInterim(text) {
        this.interimText = text;
    }

    // Get full transcript text (all segments + interim)
    getFullText() {
        const segmentsText = this.segments.join(' ');
        return (segmentsText + (this.interimText ? ' ' + this.interimText : '')).trim();
    }

    // Get only finalized text (no interim)
    getFinalizedText() {
        return this.segments.join(' ').trim();
    }

    // Clear all transcript state
    clear() {
        this.segments = [];
        this.interimText = '';
        if (this.textElement) {
            this.textElement.textContent = '';
            this.textElement.innerHTML = '';
        }
    }

    // Hide the transcript container
    hide() {
        this.clearHideTimeout();
        if (this.container) {
            this.container.style.display = 'none';
        }
    }

    // Reset everything (clear content and hide)
    reset() {
        this.clear();
        this.hide();
    }

    clearHideTimeout() {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

class VoiceMusicController {
    constructor() {
        this.recognition = null;
        this.players = new Map();
        this.isListening = false;
        this.currentPlayingId = null;
        this.config = null;
        this.playlist = [];
        this.currentPlaylistIndex = -1;
        this.isPlaying = false;
        this.isPaused = false;
        this.wasPlayingBeforeListening = false;
        this.settings = {
            readClaudeResponse: false,
            autoSubmitMode: true,
            claudeModel: 'claude-opus-4-5-20251101'
        };
        // TTS handled by VoiceOutput library
        this.manualModeStopRequested = false;
        this.progressUpdateInterval = null;
        this.isDraggingProgress = false;
        this.favorites = this.loadFavorites();
        this.isProcessingCommand = false;
        this.transcript = new TranscriptManager();
        this.init();
    }

    loadFavorites() {
        const saved = localStorage.getItem('voiceMusicFavorites');
        if (!saved) return {};

        const parsed = JSON.parse(saved);

        // Handle old format (array of videoIds) - minimal migration
        if (Array.isArray(parsed)) {
            // Old format: just an array of video IDs - abandon it, return empty
            return {};
        }

        // New format: object with full song data keyed by videoId
        return parsed || {};
    }

    saveFavorites() {
        localStorage.setItem('voiceMusicFavorites', JSON.stringify(this.favorites));
    }

    toggleFavorite(videoId, songData = null) {
        if (this.favorites[videoId]) {
            // Already favorited - remove it
            delete this.favorites[videoId];
            this.saveFavorites();
            return false;
        } else if (songData) {
            // Add to favorites with full song data
            this.favorites[videoId] = {
                videoId: songData.videoId,
                name: songData.name || songData.title || '',
                artist: songData.artist || songData.channelTitle || '',
                year: songData.year || '',
                album: songData.album || '',
                title: songData.title || '',
                channelTitle: songData.channelTitle || '',
                duration: songData.duration || '',
                comment: songData.comment || '',
                searchTerm: songData.searchTerm || '',
                favoritedAt: Date.now()
            };
            this.saveFavorites();
            return true;
        }
        return false;
    }

    isFavorite(videoId) {
        return !!this.favorites[videoId];
    }

    loadFavoritesToPlaylist() {
        const favoritesList = Object.values(this.favorites);
        if (favoritesList.length === 0) {
            this.updateStatus('No favorites saved');
            return;
        }

        // Show playlist container and central player
        document.getElementById('playlistContainer').style.display = 'block';
        document.getElementById('centralPlayer').style.display = 'block';

        let addedCount = 0;
        for (const favData of favoritesList) {
            // Minimal fallback: try to get at least artist and name
            const artistName = favData.artist || favData.channelTitle || 'Unknown';
            const songName = favData.name || favData.title || 'Unknown';

            // Skip if we don't have a videoId
            if (!favData.videoId) continue;

            const playlistItem = {
                videoId: favData.videoId,
                name: songName,
                artist: artistName,
                year: favData.year || '',
                album: favData.album || '',
                title: favData.title || songName,
                channelTitle: favData.channelTitle || artistName,
                duration: favData.duration || '--:--',
                comment: favData.comment || '',
                searchTerm: favData.searchTerm || '',
                id: Date.now() + Math.random()
            };

            this.playlist.push(playlistItem);
            this.addPlaylistItemToDOM(playlistItem);
            addedCount++;
        }

        this.updatePlaylistLabel();
        this.updateStatus(`Loaded ${addedCount} favorite${addedCount !== 1 ? 's' : ''}`);
        this.addMessage('user', 'Favorites', `Loaded ${addedCount} favorite songs`);
    }

    async init() {
        try {
            await this.loadConfig();
            this.setupSpeechRecognition();
            this.setupUI();
            this.setupYouTubeAPI();
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
        try {
            const response = await fetch('config.json');
            if (!response.ok) {
                throw new Error('Config file not found');
            }
            this.config = await response.json();

            // Log each API key status individually
            const hasClaude = this.config.claudeApiKey && this.config.claudeApiKey.length > 10;

            // Claude API key status (required)
            if (hasClaude) {
                const keyPreview = this.config.claudeApiKey.substring(0, 10) + '...';
                this.addMessage('claude', 'Claude API Key', `Loaded (${keyPreview})`);
            } else {
                this.addMessage('error', 'Claude API Key', 'MISSING or invalid');
            }

            // YouTube search via server-side proxy (no API key needed, no quota limits)
            this.addMessage('claude', 'YouTube Search', `Using server-side proxy (proxy.php) - no API key needed`);

            // Test proxy availability
            this.testProxy();

            if (!hasClaude) {
                this.updateStatus('Missing Claude API key - check log');
            } else {
                this.updateStatus('Ready');
            }
        } catch (error) {
            console.error('Error loading config:', error);
            this.updateStatus('Config file not found');
            this.addMessage('error', 'Config', 'config.json not found. Copy config.example.json and add your API keys.');
            throw new Error('Configuration required: config.json not found');
        }
    }

    setupSpeechRecognition() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            this.updateStatus('Speech recognition not supported in this browser');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'en-US';

        this.updateRecognitionMode();

        this.recognition.onstart = () => {
            this.isListening = true;
            this.manualModeStopRequested = false;
            this.updateListenButton(true);
            if (this.settings.autoSubmitMode) {
                this.transcript.clear();
                this.updateStatus('Listening...');
            } else {
                // Manual mode: only reset on fresh start, not on auto-restarts
                if (this.transcript.segments.length === 0) {
                    this.updateStatus('Listening... say "submit" when done');
                } else {
                    this.updateStatus('Still listening... say "submit" when done');
                }
                this.transcript.setInterim('');
            }
        };

        this.recognition.onresult = (event) => {
            let transcriptText = '';
            let isFinal = false;

            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcriptText += event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    isFinal = true;
                }
            }

            if (this.settings.autoSubmitMode) {
                // Auto mode: process final result
                if (isFinal) {
                    this.handleVoiceCommand(transcriptText);
                }
            } else {
                // Manual mode: accumulate speech across recognition restarts

                if (isFinal) {
                    this.transcript.addSegment(transcriptText);
                } else {
                    this.transcript.setInterim(transcriptText);
                }

                const fullTranscript = this.transcript.getFullText();

                // Check for "submit" command
                const lowerFull = fullTranscript.toLowerCase().trim();
                const words = lowerFull.split(/\s+/);
                const lastWord = words[words.length - 1];

                // If user says "submit" (as the last word or standalone), auto-submit
                if (lastWord === 'submit' || lowerFull === 'submit') {
                    // Remove "submit" from the last segment or interim
                    let cleanSegments = [...this.transcript.segments];
                    if (this.transcript.interimText && this.transcript.interimText.toLowerCase().trim().endsWith('submit')) {
                        // Submit was in interim - don't add it
                    } else if (cleanSegments.length > 0) {
                        // Submit was in last segment - remove it
                        cleanSegments[cleanSegments.length - 1] =
                            cleanSegments[cleanSegments.length - 1].replace(/\s*submit\s*$/i, '').trim();
                        if (!cleanSegments[cleanSegments.length - 1]) {
                            cleanSegments.pop();
                        }
                    }

                    const textToSubmit = cleanSegments.join(' ').trim();

                    // Stop listening and submit
                    this.manualModeStopRequested = true;
                    this.recognition.stop();

                    // Wait a moment for recognition to fully stop, then submit
                    setTimeout(() => {
                        if (textToSubmit) {
                            this.handleVoiceCommand(textToSubmit);
                            this.transcript.clear();
                            this.updateSubmitButton(false);
                        }
                    }, RECOGNITION_RESTART_DELAY_MS);
                    return;
                }

                this.transcript.showSegments(this.transcript.segments, this.transcript.interimText);
                this.updateSubmitButton(true);

                if (isFinal) {
                    this.updateStatus('Still listening... say "submit" when done');
                }
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);

            // Different errors need different handling - some are expected, some need user action
            if (event.error === 'no-speech') {
                // In manual mode, silence is expected between speech segments - just restart silently.
                // In auto mode, silence means user didn't speak, so prompt them.
                if (!this.settings.autoSubmitMode) {
                    return;
                }
                this.updateStatus('No speech detected. Tap Listen to try again.');
            } else if (event.error === 'aborted') {
                // Recognition was aborted - usually intentional, don't show error
                if (this.manualModeStopRequested) {
                    return; // Intentional stop, onend will handle it
                }
                this.updateStatus('Ready');
            } else if (event.error === 'network') {
                this.updateStatus('Network error. Check connection.');
            } else if (event.error === 'not-allowed') {
                this.updateStatus('Microphone access denied. Check permissions.');
            } else {
                this.updateStatus(`Error: ${event.error}`);
            }

            this.isListening = false;
            this.updateListenButton(false);
            this.updateSubmitButton(false);
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.updateListenButton(false);

            if (this.settings.autoSubmitMode) {
                this.updateStatus('Ready');
                this.updateSubmitButton(false);
            } else {
                // Manual mode: auto-restart after each speech segment.
                // Web Speech API stops after ~15s of silence. We restart it silently
                // to maintain illusion of continuous listening until user says "submit".
                if (!this.manualModeStopRequested) {
                    this.updateStatus('Still listening... say "submit" when done');
                    this.updateSubmitButton(true);
                    setTimeout(() => {
                        if (!this.settings.autoSubmitMode && !this.manualModeStopRequested) {
                            try {
                                this.recognition.start();
                                this.isListening = true;
                                this.updateListenButton(true);
                            } catch (e) {
                                // Recognition might already be running
                                console.log('Could not restart recognition:', e);
                            }
                        }
                    }, RECOGNITION_RESTART_DELAY_MS);
                } else {
                    // User explicitly stopped - show appropriate message
                    this.manualModeStopRequested = false;
                    if (this.transcript.getFullText()) {
                        this.updateStatus('Tap Submit or Listen again');
                        this.updateSubmitButton(true);
                    } else {
                        this.updateStatus('Ready');
                        this.updateSubmitButton(false);
                    }
                }
            }
        };

        // Text-to-speech now handled by VoiceOutput library (voice-output.js)
        // No initialization needed here - VoiceOutput self-initializes
    }

    updateRecognitionMode() {
        if (!this.recognition) return;

        if (this.settings.autoSubmitMode) {
            // Auto mode: stop after first result
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
        } else {
            // Manual mode: continuous with interim results
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
        }
    }

    setupUI() {
        // Initialize transcript manager
        this.transcript.init();

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

        // Load saved settings
        const savedSettings = localStorage.getItem('voiceMusicSettings');
        if (savedSettings) {
            this.settings = { ...this.settings, ...JSON.parse(savedSettings) };
        }

        // Update UI with saved settings
        document.getElementById('readClaudeResponse').checked = this.settings.readClaudeResponse;
        document.getElementById('autoSubmitMode').checked = this.settings.autoSubmitMode;
        document.getElementById('claudeModel').value = this.settings.claudeModel;
        this.updateModeToggle();

        // Settings change handlers
        document.getElementById('readClaudeResponse').addEventListener('change', (e) => {
            this.settings.readClaudeResponse = e.target.checked;
            this.saveSettings();
        });

        document.getElementById('autoSubmitMode').addEventListener('change', (e) => {
            this.settings.autoSubmitMode = e.target.checked;
            this.saveSettings();
            this.updateRecognitionMode();
            this.updateSubmitButton(false);
            this.updateModeToggle();
            // Clear accumulated state when switching modes
            this.transcript.reset();
            if (this.isListening) {
                this.stopListening();
            }
        });

        document.getElementById('claudeModel').addEventListener('change', (e) => {
            this.settings.claudeModel = e.target.value;
            this.saveSettings();
        });

        // Listen button
        const listenBtn = document.getElementById('listenBtn');
        listenBtn.addEventListener('click', () => {
            if (this.isListening) {
                this.stopListening();
            } else {
                this.startListening();
            }
        });

        // Mode toggle button (if it exists in the UI)
        const modeToggleBtn = document.getElementById('modeToggleBtn');
        if (modeToggleBtn) {
            modeToggleBtn.addEventListener('click', () => {
                this.settings.autoSubmitMode = !this.settings.autoSubmitMode;
                this.saveSettings();
                this.updateRecognitionMode();
                this.updateModeToggle();
                this.updateSubmitButton(false);
                // Clear accumulated state when switching modes
                this.transcript.reset();
                // Also update the settings checkbox
                const autoSubmitCheckbox = document.getElementById('autoSubmitMode');
                if (autoSubmitCheckbox) {
                    autoSubmitCheckbox.checked = this.settings.autoSubmitMode;
                }
                if (this.isListening) {
                    this.stopListening();
                }
            });
            this.updateModeToggle();
        }

        // Submit button
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.addEventListener('click', () => {
            this.manualModeStopRequested = true;
            if (this.isListening) {
                this.recognition.stop();
            }
            const textToSubmit = this.transcript.getFullText();
            if (textToSubmit) {
                this.handleVoiceCommand(textToSubmit);
                this.transcript.reset();
                this.updateSubmitButton(false);
            }
        });

        // Log buttons
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

        // Clear playlist button
        const clearPlaylistBtn = document.getElementById('clearPlaylistBtn');
        if (clearPlaylistBtn) {
            clearPlaylistBtn.addEventListener('click', () => {
                this.clearPlaylist();
                this.updateStatus('Playlist cleared');
            });
        }

        // Load favorites buttons (main and in playlist header)
        const loadFavoritesBtnMain = document.getElementById('loadFavoritesBtnMain');
        if (loadFavoritesBtnMain) {
            loadFavoritesBtnMain.addEventListener('click', () => {
                this.loadFavoritesToPlaylist();
            });
        }

        const loadFavoritesBtn = document.getElementById('loadFavoritesBtn');
        if (loadFavoritesBtn) {
            loadFavoritesBtn.addEventListener('click', () => {
                this.loadFavoritesToPlaylist();
            });
        }

        // Progress bar interactions
        this.setupProgressBar();
    }

    setupProgressBar() {
        const progressTrack = document.getElementById('progressBarTrack');
        if (!progressTrack) return;

        const handleSeek = (e) => {
            const rect = progressTrack.getBoundingClientRect();
            const x = e.clientX || (e.touches && e.touches[0].clientX);
            const percentage = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
            this.seekToPercentage(percentage);
        };

        // Mouse events
        progressTrack.addEventListener('mousedown', (e) => {
            this.isDraggingProgress = true;
            progressTrack.classList.add('dragging');
            handleSeek(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isDraggingProgress) {
                handleSeek(e);
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.isDraggingProgress) {
                this.isDraggingProgress = false;
                const progressTrack = document.getElementById('progressBarTrack');
                if (progressTrack) progressTrack.classList.remove('dragging');
            }
        });

        // Touch events
        progressTrack.addEventListener('touchstart', (e) => {
            this.isDraggingProgress = true;
            progressTrack.classList.add('dragging');
            handleSeek(e);
        });

        progressTrack.addEventListener('touchmove', (e) => {
            if (this.isDraggingProgress) {
                e.preventDefault();
                handleSeek(e);
            }
        });

        progressTrack.addEventListener('touchend', () => {
            this.isDraggingProgress = false;
            progressTrack.classList.remove('dragging');
        });

        // Click to seek
        progressTrack.addEventListener('click', handleSeek);
    }

    seekToPercentage(percentage) {
        if (!this.currentPlayingId) return;

        const player = this.players.get(this.currentPlayingId);
        if (player && typeof player.getDuration === 'function' && typeof player.seekTo === 'function') {
            const duration = player.getDuration();
            if (duration && duration > 0) {
                const seekTime = duration * percentage;
                player.seekTo(seekTime, true);
                this.updateProgressBar(seekTime, duration);
            }
        }
    }

    startProgressUpdates() {
        this.stopProgressUpdates();
        this.progressUpdateInterval = setInterval(() => {
            this.updateCurrentProgress();
        }, PROGRESS_UPDATE_INTERVAL_MS);
    }

    stopProgressUpdates() {
        if (this.progressUpdateInterval) {
            clearInterval(this.progressUpdateInterval);
            this.progressUpdateInterval = null;
        }
    }

    updateCurrentProgress() {
        if (!this.currentPlayingId || this.isDraggingProgress) return;

        const player = this.players.get(this.currentPlayingId);
        if (player && typeof player.getCurrentTime === 'function' && typeof player.getDuration === 'function') {
            const currentTime = player.getCurrentTime();
            const duration = player.getDuration();
            if (duration && duration > 0) {
                this.updateProgressBar(currentTime, duration);
            }
        }
    }

    updateProgressBar(currentTime, duration) {
        const fill = document.getElementById('progressBarFill');
        const handle = document.getElementById('progressBarHandle');
        const currentTimeEl = document.getElementById('currentTime');
        const totalTimeEl = document.getElementById('totalTime');

        if (fill && handle && currentTimeEl && totalTimeEl) {
            const percentage = (currentTime / duration) * 100;
            fill.style.width = `${percentage}%`;
            handle.style.left = `${percentage}%`;
            currentTimeEl.textContent = this.formatTime(currentTime);
            totalTimeEl.textContent = this.formatTime(duration);
        }
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }


    setupYouTubeAPI() {
        if (typeof YT === 'undefined') {
            window.onYouTubeIframeAPIReady = () => {
                this.playerReady();
            };
        } else {
            this.playerReady();
        }
    }

    playerReady() {
        console.log('YouTube API ready');

        // Run any pending player creation functions
        if (window.youtubeApiReady && Array.isArray(window.youtubeApiReady)) {
            window.youtubeApiReady.forEach(fn => {
                if (typeof fn === 'function') {
                    fn();
                }
            });
            window.youtubeApiReady = [];
        }
    }

    startListening() {
        if (!this.recognition) {
            this.updateStatus('Speech recognition not available');
            return;
        }

        // Pause playback while listening - music interferes with speech recognition accuracy.
        // Track state so we can resume during Claude API wait, then pause again when response arrives.
        this.wasPlayingBeforeListening = this.isPlaying && !this.isPaused;
        if (this.wasPlayingBeforeListening) {
            this.pausePlayback();
        }

        // Clear transcript when starting fresh (user clicked Listen to start new command)
        // This ensures old "You said" text disappears when starting a new input
        this.transcript.reset();

        try {
            this.recognition.start();
        } catch (error) {
            console.error('Error starting recognition:', error);
            this.updateStatus('Click Listen again');
        }
    }

    stopListening() {
        if (this.recognition && this.isListening) {
            this.manualModeStopRequested = true;
            this.recognition.stop();
            // Let onend handle the rest - it will update status and buttons
            // Clear transcript state if there's no text to preserve
            if (!this.transcript.getFullText()) {
                this.transcript.clear();
            }
        }
    }

    updateListenButton(listening) {
        const btn = document.getElementById('listenBtn');
        if (listening) {
            btn.classList.add('listening');
            btn.querySelector('.button-text').textContent = 'Listening...';
            this.updateSubmitButton(true);
        } else {
            btn.classList.remove('listening');
            btn.querySelector('.button-text').textContent = 'Listen';
            if (!this.isProcessingCommand) {
                this.updateSubmitButton(false);
            }
        }
    }

    updateSubmitButton(show) {
        const submitBtn = document.getElementById('submitBtn');
        const listenBtn = document.getElementById('listenBtn');
        if (submitBtn && listenBtn) {
            if (show) {
                submitBtn.style.display = 'flex';
                listenBtn.style.maxWidth = '50%';
            } else {
                submitBtn.style.display = 'none';
                listenBtn.style.maxWidth = '100%';
            }
        }
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
        localStorage.setItem('voiceMusicSettings', JSON.stringify(this.settings));
    }

    updateStatus(message) {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    async handleVoiceCommand(transcript) {
        try {
            this.hideClaudeResponse();
            this.logUserMessage(transcript);

            // Check if it's a control command first
            const command = this.parseControlCommand(transcript);
            if (command) {
                // Show transcript briefly for commands, then auto-hide
                this.transcript.show(transcript, { autoHideAfter: TRANSCRIPT_AUTO_HIDE_MS });
                this.executeControlCommand(command);
                this.hidePrompt();
                // Don't resume playback for control commands - they handle their own state
                this.wasPlayingBeforeListening = false;
                this.updateSubmitButton(false);
                return;
            }

            // Show transcript for music searches (no auto-hide)
            this.transcript.show(transcript);

            // Resume playback while waiting for Claude response
            if (this.wasPlayingBeforeListening) {
                this.playPlaylist();
            }

            // Otherwise, treat as music search
            this.isProcessingCommand = true;
            this.updateSubmitButton(true);
            this.updateStatus('Processing with Claude...');

            const result = await this.processCommandWithLLM(transcript);

            // Pause playback when response arrives
            if (this.wasPlayingBeforeListening && this.isPlaying) {
                this.pausePlayback();
            }
            this.wasPlayingBeforeListening = false;

            if (!result || !result.songList || result.songList.length === 0) {
                this.updateStatus('No songs found. Try again.');
                this.hidePrompt();
                if (this.settings.readClaudeResponse) {
                    this.speakText('No songs found. Try again.');
                }
                return;
            }

            // Show the prompt that was sent
            if (result.prompt) {
                this.showPrompt(result.prompt);
                this.logClaudeMessage(`Prompt sent:\n${result.prompt}`);
            }

            this.updateStatus(`Found ${result.songList.length} song(s), searching YouTube...`);
            await this.searchAndAddToPlaylist(result.songList);

            // If read mode is ON: announce results, wait for speech to finish, then play
            // If read mode is OFF: just play immediately
            if (this.settings.readClaudeResponse) {
                const songNames = result.songList.map(s => s.searchTerm).slice(0, 3).join(', ');
                const announcement = `Found ${result.songList.length} song${result.songList.length > 1 ? 's' : ''}: ${songNames}`;
                await this.speakTextAsync(announcement);
            }

            // Auto-play the playlist
            this.playPlaylist();
            this.updateStatus('Playing');
            this.isProcessingCommand = false;
            this.updateSubmitButton(false);
        } catch (error) {
            console.error('Error handling voice command:', error);
            this.logError('Voice Command Error', error);
            this.updateStatus('Error processing command. Try again.');
            this.hidePrompt();
            this.wasPlayingBeforeListening = false;
            this.isProcessingCommand = false;
            this.updateSubmitButton(false);
        }
    }

    // Text-to-speech via centralized VoiceOutput library
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
    }

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
    }

    showHelp() {
        const helpText = `Voice Commands: play, pause, stop, next, previous, fast forward, rewind, shuffle, clear, what's playing`;

        this.updateStatus(helpText);
        this.addMessage('user', 'Help:', 'play, pause, stop, next, previous, fast forward, rewind, shuffle, clear, what\'s playing');
        this.speakText('Voice commands: play, pause, stop, next, previous, fast forward, rewind, shuffle, clear, and what\'s playing.');
    }

    announceCurrentSong() {
        if (!this.currentPlayingId || this.currentPlaylistIndex < 0) {
            this.updateStatus('Nothing is playing');
            this.speakText('Nothing is currently playing');
            return;
        }

        const currentItem = this.playlist[this.currentPlaylistIndex];
        if (currentItem) {
            const announcement = `Now playing: ${currentItem.title} by ${currentItem.channelTitle || 'Unknown Artist'}`;
            this.updateStatus(announcement);
            this.speakText(announcement);
        }
    }

    shufflePlaylist() {
        if (this.playlist.length === 0) return;

        // Fisher-Yates shuffle
        for (let i = this.playlist.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
        }

        // Re-render playlist table body
        const playlistBody = document.getElementById('playlistBody');
        playlistBody.innerHTML = '';

        // Remove old player divs
        const container = document.getElementById('playlistContainer');
        const playerDivs = container.querySelectorAll('.youtube-player');
        playerDivs.forEach(div => div.remove());

        // Re-add items
        this.playlist.forEach(item => {
            this.addPlaylistItemToDOM(item);
        });

        // Reset current index
        if (this.currentPlaylistIndex >= 0) {
            const currentItem = this.playlist[this.currentPlaylistIndex];
            if (currentItem) {
                this.updateCentralPlayer(currentItem);
            }
        }
    }

    async processCommandWithLLM(transcript) {
        // Debug mode: skip Claude API and return hardcoded test data
        if (SKIP_CLAUDE) {
            this.addMessage('claude', 'DEBUG', 'Skipping Claude API - using hardcoded Cecilia');
            const testSongList = [{
                name: "Cecilia",
                artist: "Simon & Garfunkel",
                year: "1970",
                album: "Bridge Over Troubled Water",
                comment: "DEBUG: Hardcoded test song",
                searchTerm: "Simon & Garfunkel Cecilia"
            }];
            return { songList: testSongList, prompt: '[DEBUG MODE - Claude skipped]' };
        }

        if (!this.config || !this.config.claudeApiKey) {
            throw new Error('Claude API key not configured');
        }

        try {
            const prompt = `A user is requesting music. They might also ask for comments on each song.

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

            const requestBody = {
                model: this.settings.claudeModel,
                max_tokens: 4000,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            };

            this.logClaudeMessage(`Music search request to ${this.settings.claudeModel}:\n${prompt}`);

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
                throw new Error(error.error?.message || 'API request failed');
            }

            const data = await response.json();
            const responseText = data.content[0].text.trim();

            this.logClaudeMessage(`Response:\n${responseText}`);

            // Extract JSON array from response
            // Find the first [ and last ] to get the complete array
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
        } catch (error) {
            console.error('Claude API error:', error);
            this.logError('Music Search API Error', error);
            throw error;
        }
    }

    async searchAndAddToPlaylist(songList) {
        const playlistContainer = document.getElementById('playlistContainer');
        const playlistEl = document.getElementById('playlist');

        // Show playlist container and central player
        playlistContainer.style.display = 'block';

        if (songList.length > 0) {
            document.getElementById('centralPlayer').style.display = 'block';
        }

        let addedCount = 0;
        this.addMessage('claude', 'Processing', `Adding ${songList.length} songs to playlist...`);

        for (let i = 0; i < songList.length; i++) {
            const song = songList[i];
            try {
                // Require searchTerm - Claude must provide this field
                if (!song.searchTerm) {
                    this.addMessage('error', 'Missing searchTerm', `Song ${i + 1}: ${JSON.stringify(song).substring(0, 100)}`);
                    continue;
                }

                this.addMessage('claude', `Song ${i + 1}`, `Searching: ${song.searchTerm}`);
                const videoData = await this.searchYouTube(song.searchTerm);

                if (!videoData) {
                    this.addMessage('error', `Song ${i + 1}`, `No YouTube results for: ${song.searchTerm}`);
                    continue;
                }

                this.addMessage('claude', `Song ${i + 1}`, `Found: ${videoData.title}`);

                // Decode any HTML entities in Claude's response (e.g., &amp; -> &)
                const playlistItem = {
                    name: song.name ? this.decodeHtml(song.name) : '',
                    artist: song.artist ? this.decodeHtml(song.artist) : '',
                    year: song.year || '',
                    album: song.album ? this.decodeHtml(song.album) : '',
                    comment: song.comment ? this.decodeHtml(song.comment) : '',
                    searchTerm: song.searchTerm,
                    ...videoData,
                    id: Date.now() + Math.random()
                };
                this.playlist.push(playlistItem);
                this.addPlaylistItemToDOM(playlistItem);
                addedCount++;
                this.updatePlaylistLabel();
                this.addMessage('claude', `Song ${i + 1}`, `Added to playlist`);
            } catch (error) {
                console.error(`Error searching for "${song.searchTerm}":`, error);
                this.addMessage('error', `Song ${i + 1}`, `Error: ${error.message}`);

                // Stop batch on persistent errors to avoid wasting time
                if (error.message.includes('403') || error.message.includes('503')) {
                    this.addMessage('error', 'Stopping', 'Search service unavailable - skipping remaining songs');
                    break;
                }
            }
        }

        this.addMessage('claude', 'Complete', `Added ${addedCount} of ${songList.length} songs`);

        if (addedCount === 0 && songList.length > 0) {
            this.speakText('Could not find any of those songs on YouTube');
        }
    }

    updatePlaylistLabel() {
        const label = document.getElementById('playlistLabel');
        if (label) {
            const count = this.playlist.length;
            label.textContent = `Playlist (${count})`;
        }
    }

    async searchYouTube(query) {
        // Use server-side proxy (proxy.php) which calls Piped/Invidious directly
        // Server-side avoids CORS issues and doesn't need third-party CORS proxies
        const proxyUrl = `proxy.php?q=${encodeURIComponent(query)}`;

        this.addMessage('claude', 'Search', `Searching for: ${query}`);

        const response = await fetch(proxyUrl);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error || `HTTP ${response.status}`;
            this.addMessage('error', 'Search Failed', errorMsg);
            throw new Error(`Search failed: ${errorMsg}`);
        }

        const data = await response.json();

        // Check for error response
        if (data.error) {
            this.addMessage('error', 'Search Error', data.error);
            throw new Error(data.error);
        }

        // Get results from our standardized proxy response
        const results = data.results || [];

        if (results.length > 0) {
            const video = results[0];
            this.addMessage('claude', 'Found', `${video.title} (via ${data.source || 'proxy'})`);
            return {
                videoId: video.videoId,
                title: video.title || 'Unknown',
                channelTitle: video.channelTitle || 'Unknown Artist',
                duration: this.formatSeconds(video.duration)
            };
        }

        this.addMessage('error', 'No Results', `No videos found for: ${query}`);
        return null;
    }

    formatSeconds(totalSeconds) {
        if (!totalSeconds || isNaN(totalSeconds)) return '--:--';
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    addPlaylistItemToDOM(item) {
        const playlistBody = document.getElementById('playlistBody');
        const row = document.createElement('tr');
        row.dataset.itemId = item.id;
        row.dataset.videoId = item.videoId;

        const isFav = this.isFavorite(item.videoId);
        const artistName = item.artist || item.channelTitle || 'Unknown';
        const songName = item.name || item.title || 'Unknown';
        const yearText = item.year || '';
        const albumText = item.album || '';

        row.innerHTML = `
            <td><button class="favorite-btn ${isFav ? 'favorited' : ''}" data-video-id="${item.videoId}" aria-label="Toggle favorite">${isFav ? '\u2605' : '\u2606'}</button></td>
            <td>${this.escapeHtml(artistName)}</td>
            <td>${this.escapeHtml(songName)}</td>
            <td>${yearText}</td>
            <td>${this.escapeHtml(albumText)}</td>
            <td>${item.duration || '--:--'}</td>
        `;

        // Favorite button click - pass full song data
        const favBtn = row.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const videoId = favBtn.dataset.videoId;
            const isNowFavorited = this.toggleFavorite(videoId, item);
            favBtn.classList.toggle('favorited', isNowFavorited);
            favBtn.textContent = isNowFavorited ? '\u2605' : '\u2606';
        });

        // Tap/click to play (on the row, not the favorite button)
        row.addEventListener('click', (e) => {
            if (e.target.closest('.favorite-btn')) return;
            this.playVideo(item);
        });

        // Append row to table body
        playlistBody.appendChild(row);

        // Create hidden player container outside the table
        const playlistContainer = document.getElementById('playlistContainer');
        const playerDiv = document.createElement('div');
        playerDiv.id = `player-${item.id}`;
        playerDiv.className = 'youtube-player';
        playerDiv.style.display = 'none';
        playlistContainer.appendChild(playerDiv);

        // Create YouTube player after element is in DOM
        const playerId = `player-${item.id}`;
        const createPlayer = () => {
            if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
                console.error('YouTube API not loaded yet');
                return;
            }

            const playerElement = document.getElementById(playerId);
            if (!playerElement) {
                console.error('Player element not found:', playerId);
                return;
            }

            try {
                const player = new YT.Player(playerId, {
                    height: '200',
                    width: '100%',
                    videoId: item.videoId,
                    playerVars: {
                        autoplay: 0,
                        controls: 1,
                        modestbranding: 1,
                        rel: 0
                    },
                    events: {
                        onReady: (event) => {
                            console.log('Player ready for:', item.videoId);
                            // Store the player reference when ready
                            this.players.set(item.id, event.target);
                        },
                        onStateChange: (event) => {
                            // Auto-advance to next when video ends
                            if (event.data === YT.PlayerState.ENDED) {
                                this.playNext();
                            }
                        },
                        onError: (event) => {
                            console.error('Player error:', event.data);
                            this.updateStatus('Error loading video');
                        }
                    }
                });

                // Store player immediately (methods may not be available until onReady)
                this.players.set(item.id, player);
            } catch (error) {
                console.error('Error creating YouTube player:', error);
            }
        };

        // Wait a tick for DOM to settle, then create player
        setTimeout(() => {
            if (typeof YT !== 'undefined' && typeof YT.Player !== 'undefined') {
                createPlayer();
            } else {
                // YouTube API not ready - use two strategies for robustness:
                // 1. Push to callback queue (if onYouTubeIframeAPIReady fires later)
                // 2. Poll for API (handles race conditions and late script loads)
                if (!window.youtubeApiReady) {
                    window.youtubeApiReady = [];
                }
                window.youtubeApiReady.push(createPlayer);

                const checkApi = setInterval(() => {
                    // Stop polling if element was removed (e.g., playlist cleared)
                    if (!document.getElementById(playerId)) {
                        clearInterval(checkApi);
                        return;
                    }
                    if (typeof YT !== 'undefined' && typeof YT.Player !== 'undefined') {
                        clearInterval(checkApi);
                        createPlayer();
                    }
                }, YOUTUBE_API_POLL_INTERVAL_MS);

                // Give up after timeout
                setTimeout(() => clearInterval(checkApi), YOUTUBE_API_TIMEOUT_MS);
            }
        }, DOM_SETTLE_DELAY_MS);
    }

    playVideo(item) {
        // Stop currently playing video
        if (this.currentPlayingId && this.currentPlayingId !== item.id) {
            const currentPlayer = this.players.get(this.currentPlayingId);
            if (currentPlayer && typeof currentPlayer.pauseVideo === 'function') {
                try {
                    currentPlayer.pauseVideo();
                } catch (e) {
                    console.error('Error pausing video:', e);
                }
            }
            // Remove playing class from all rows
            document.querySelectorAll('#playlistBody tr').forEach(el => {
                el.classList.remove('playing');
            });
        }

        // Play new video
        const player = this.players.get(item.id);
        if (player && typeof player.playVideo === 'function') {
            try {
                player.playVideo();
                this.currentPlayingId = item.id;
                this.isPlaying = true;
                this.isPaused = false;

                // Update playlist index
                this.currentPlaylistIndex = this.playlist.findIndex(song => song.id === item.id);

                // Update central player display
                this.updateCentralPlayer(item);

                // Update UI to show which is playing in playlist
                const itemEl = document.querySelector(`[data-item-id="${item.id}"]`);
                if (itemEl) {
                    itemEl.classList.add('playing');
                }

                // Update play/pause button
                this.updatePlayPauseButton();

                // Start progress bar updates
                this.startProgressUpdates();

                // Log the play action
                const songTitle = item.name || item.title || 'Unknown';
                this.addMessage('user', 'Now Playing', `${songTitle}`);
            } catch (e) {
                console.error('Error playing video:', e);
                this.logError('Playback Error', e);
                this.updateStatus('Error playing video. Try again.');
            }
        } else {
            console.error('Player not ready for video:', item.id, player);
            this.updateStatus('Player loading... try again in a moment.');
            // Retry after a short delay
            setTimeout(() => {
                const retryPlayer = this.players.get(item.id);
                if (retryPlayer && typeof retryPlayer.playVideo === 'function') {
                    this.playVideo(item);
                }
            }, PLAYER_RETRY_DELAY_MS);
        }
    }

    updateCentralPlayer(item) {
        const titleEl = document.getElementById('playerSongTitle');
        const artistEl = document.getElementById('playerSongArtist');

        if (item) {
            titleEl.textContent = item.name || item.title || '';
            artistEl.textContent = item.artist || item.channelTitle || '';
        } else {
            titleEl.textContent = '';
            artistEl.textContent = '';
        }
    }

    stopPlayback() {
        if (this.currentPlayingId) {
            const player = this.players.get(this.currentPlayingId);
            if (player && typeof player.stopVideo === 'function') {
                try {
                    player.stopVideo();
                    this.isPlaying = false;
                    this.isPaused = false;
                    this.updatePlayPauseButton();
                    this.stopProgressUpdates();
                    this.updateProgressBar(0, 1);
                } catch (e) {
                    console.error('Error stopping video:', e);
                }
            }
        }
    }

    playPlaylist() {
        if (this.playlist.length === 0) {
            this.updateStatus('Playlist is empty');
            return;
        }

        if (this.isPaused && this.currentPlayingId) {
            // Resume current
            const player = this.players.get(this.currentPlayingId);
            if (player && typeof player.playVideo === 'function') {
                player.playVideo();
                this.isPlaying = true;
                this.isPaused = false;
                this.updatePlayPauseButton();
                this.startProgressUpdates();
            }
        } else if (this.currentPlaylistIndex >= 0 && this.currentPlaylistIndex < this.playlist.length) {
            // Continue from current position
            this.playVideo(this.playlist[this.currentPlaylistIndex]);
        } else {
            // Start from beginning
            this.currentPlaylistIndex = 0;
            this.playVideo(this.playlist[0]);
        }
    }

    pausePlayback() {
        if (this.currentPlayingId) {
            const player = this.players.get(this.currentPlayingId);
            if (player && typeof player.pauseVideo === 'function') {
                player.pauseVideo();
                this.isPlaying = false;
                this.isPaused = true;
                this.updatePlayPauseButton();
                this.stopProgressUpdates();
            }
        }
    }

    togglePlayPause() {
        if (this.isPlaying && !this.isPaused) {
            this.pausePlayback();
        } else {
            this.playPlaylist();
        }
    }

    playNext() {
        if (this.playlist.length === 0) return;

        let nextIndex = this.currentPlaylistIndex + 1;
        if (nextIndex >= this.playlist.length) {
            nextIndex = 0; // Loop to beginning
        }

        this.currentPlaylistIndex = nextIndex;
        this.playVideo(this.playlist[nextIndex]);
    }

    playPrevious() {
        if (this.playlist.length === 0) return;

        let prevIndex = this.currentPlaylistIndex - 1;
        if (prevIndex < 0) {
            prevIndex = this.playlist.length - 1; // Loop to end
        }

        this.currentPlaylistIndex = prevIndex;
        this.playVideo(this.playlist[prevIndex]);
    }

    fastForward() {
        if (this.currentPlayingId) {
            const player = this.players.get(this.currentPlayingId);
            if (player && typeof player.getCurrentTime === 'function' && typeof player.seekTo === 'function') {
                try {
                    const currentTime = player.getCurrentTime();
                    player.seekTo(currentTime + SEEK_JUMP_SECONDS, true);
                } catch (e) {
                    console.error('Error fast forwarding:', e);
                }
            }
        }
    }

    rewind() {
        if (this.currentPlayingId) {
            const player = this.players.get(this.currentPlayingId);
            if (player && typeof player.getCurrentTime === 'function' && typeof player.seekTo === 'function') {
                try {
                    const currentTime = player.getCurrentTime();
                    player.seekTo(Math.max(0, currentTime - SEEK_JUMP_SECONDS), true);
                } catch (e) {
                    console.error('Error rewinding:', e);
                }
            }
        }
    }

    updatePlayPauseButton() {
        const btn = document.getElementById('playPauseBtn');
        if (this.isPlaying && !this.isPaused) {
            btn.textContent = '⏸';
            btn.setAttribute('aria-label', 'Pause');
        } else {
            btn.textContent = '▶';
            btn.setAttribute('aria-label', 'Play');
        }
    }

    clearPlaylist() {
        // Stop any playing video
        if (this.currentPlayingId) {
            const player = this.players.get(this.currentPlayingId);
            if (player && typeof player.stopVideo === 'function') {
                try {
                    player.stopVideo();
                } catch (e) {
                    // Ignore
                }
            }
        }

        this.stopProgressUpdates();
        this.playlist = [];
        this.currentPlaylistIndex = -1;
        this.isPlaying = false;
        this.isPaused = false;
        document.getElementById('playlistBody').innerHTML = '';

        // Remove any player divs that were appended to the container
        const container = document.getElementById('playlistContainer');
        const playerDivs = container.querySelectorAll('.youtube-player');
        playerDivs.forEach(div => div.remove());

        document.getElementById('playlistContainer').style.display = 'none';
        document.getElementById('centralPlayer').style.display = 'none';
        this.players.forEach(player => {
            try {
                player.destroy();
            } catch (e) {
                // Ignore errors
            }
        });
        this.players.clear();
        this.currentPlayingId = null;
        this.updatePlayPauseButton();
        this.updateCentralPlayer(null);
        this.updatePlaylistLabel();

        // Also hide transcript/response containers
        this.hideClaudeResponse();
        this.hidePrompt();
        const transcriptContainer = document.getElementById('transcriptContainer');
        if (transcriptContainer) {
            transcriptContainer.style.display = 'none';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    decodeHtml(text) {
        // YouTube API returns HTML-encoded titles (e.g., &amp; instead of &)
        // Decode them before storing to avoid double-encoding when displayed
        const div = document.createElement('div');
        div.innerHTML = text;
        return div.textContent;
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
    new VoiceMusicController();
});
