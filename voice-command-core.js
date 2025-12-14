//-----------------------------------------------------------------------
// VOICE COMMAND CORE
// Abstract voice recognition and command dispatch system.
// Consumers register command handlers; this library handles:
// - Speech recognition (listen/stop)
// - Transcript display and accumulation
// - Status updates
// - Command parsing and dispatch
//-----------------------------------------------------------------------

//-------TIMING CONSTANTS-------
const RECOGNITION_RESTART_DELAY_MS = 100;
const TRANSCRIPT_AUTO_HIDE_MS = 3000;

//-------TRANSCRIPT MANAGER-------
// Manages the "You said" transcript display box
class TranscriptManager {
    constructor() {
        this.container = null;
        this.textElement = null;
        this.segments = [];
        this.interimText = '';
        this.hideTimeout = null;
    }

    init(containerId = 'transcriptContainer', textId = 'transcript') {
        this.container = document.getElementById(containerId);
        this.textElement = document.getElementById(textId);
    }

    show(text, options = {}) {
        if (!this.container || !this.textElement) return;

        const { interim = false, autoHideAfter = null } = options;

        this.clearHideTimeout();
        this.textElement.textContent = text;
        this.textElement.classList.remove('live-interim');
        this.textElement.style.opacity = interim ? '0.7' : '1';
        this.container.style.display = 'block';

        if (autoHideAfter) {
            this.hideTimeout = setTimeout(() => this.hide(), autoHideAfter);
        }
    }

    // Show live interim results while listening (distinct styling)
    showLive(text) {
        if (!this.container || !this.textElement) return;

        this.clearHideTimeout();
        this.textElement.textContent = text + '...';
        this.textElement.classList.add('live-interim');
        this.container.style.display = 'block';
    }

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

    addSegment(text) {
        const trimmed = text.trim();
        if (trimmed) {
            this.segments.push(trimmed);
        }
        this.interimText = '';
    }

    setInterim(text) {
        this.interimText = text;
    }

    getFullText() {
        const segmentsText = this.segments.join(' ');
        return (segmentsText + (this.interimText ? ' ' + this.interimText : '')).trim();
    }

    getFinalizedText() {
        return this.segments.join(' ').trim();
    }

    clear() {
        this.segments = [];
        this.interimText = '';
        if (this.textElement) {
            this.textElement.textContent = '';
            this.textElement.innerHTML = '';
        }
    }

    hide() {
        this.clearHideTimeout();
        if (this.container) {
            this.container.style.display = 'none';
        }
    }

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

//-------VOICE COMMAND CORE-------
class VoiceCommandCore {
    constructor(options = {}) {
        this.recognition = null;
        this.isListening = false;
        this.transcript = new TranscriptManager();
        this.manualModeStopRequested = false;
        this.isProcessingCommand = false;

        // Settings with defaults
        this.settings = {
            autoSubmitMode: true,
            echoCommands: false, // Verbally announce recognized commands before executing
            // Voice output settings
            voiceRate: 1.0,      // 0.1 to 10 (1 = normal speed)
            voicePitch: 1.0,     // 0 to 2 (1 = normal pitch)
            voiceName: null,     // null = browser default, or specific voice name
            ...options.settings
        };

        // Callback for echo - consumer provides speakable description
        this.getCommandDescription = options.getCommandDescription || null;

        // Cache available voices
        this.availableVoices = [];

        // Callbacks for consumers
        this.onStatusChange = options.onStatusChange || (() => { });
        this.onListeningChange = options.onListeningChange || (() => { });
        this.onTranscriptChange = options.onTranscriptChange || (() => { });
        this.onError = options.onError || ((msg) => console.error(msg));

        // Command handlers registered by consumers
        // Each handler: { parse: (transcript) => command|null, execute: (command, transcript) => Promise<void> }
        this.commandHandlers = [];

        // Fallback handler for when no command matches (e.g., send to LLM)
        this.fallbackHandler = options.fallbackHandler || null;

        // UI element IDs (can be customized)
        this.uiIds = {
            listenBtn: 'listenBtn',
            submitBtn: 'submitBtn',
            statusEl: 'status',
            echoToggle: 'echoCommandsToggle',
            transcriptContainer: 'transcriptContainer',
            transcriptText: 'transcript',
            ...options.uiIds
        };
    }

    // Get/set echo commands setting
    get echoCommands() {
        return this.settings.echoCommands;
    }

    set echoCommands(value) {
        this.settings.echoCommands = value;
        // Sync UI toggle if present
        const toggle = document.getElementById(this.uiIds.echoToggle);
        if (toggle && toggle.checked !== value) {
            toggle.checked = value;
        }
    }

    init() {
        this.setupSpeechRecognition();
        this.loadAvailableVoices();
        this.transcript.init(this.uiIds.transcriptContainer, this.uiIds.transcriptText);
        this.setupUI();
        this.updateStatus('Ready');
    }

    // Load available TTS voices (async - voices may load after page load)
    loadAvailableVoices() {
        if (!('speechSynthesis' in window)) return;

        const loadVoices = () => {
            this.availableVoices = window.speechSynthesis.getVoices();
            // Sort: English voices first, then by name
            this.availableVoices.sort((a, b) => {
                const aEng = a.lang.startsWith('en');
                const bEng = b.lang.startsWith('en');
                if (aEng && !bEng) return -1;
                if (!aEng && bEng) return 1;
                return a.name.localeCompare(b.name);
            });
        };

        loadVoices();
        // Chrome loads voices asynchronously
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    }

    // Get list of available voices for UI
    getAvailableVoices() {
        return this.availableVoices.map(v => ({
            name: v.name,
            lang: v.lang,
            local: v.localService,
            default: v.default
        }));
    }

    // Set voice by name
    setVoice(voiceName) {
        this.settings.voiceName = voiceName;
    }

    // Set voice rate (speed)
    setVoiceRate(rate) {
        this.settings.voiceRate = Math.max(0.1, Math.min(10, rate));
    }

    // Set voice pitch
    setVoicePitch(pitch) {
        this.settings.voicePitch = Math.max(0, Math.min(2, pitch));
    }

    setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.updateStatus('Speech recognition not supported in this browser');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = !this.settings.autoSubmitMode;
        this.recognition.interimResults = !this.settings.autoSubmitMode;
        this.recognition.lang = 'en-US';

        this.recognition.onstart = () => {
            this.isListening = true;
            this.updateListenButton(true);
            this.updateStatus('Listening...');
            this.onListeningChange(true);
        };

        this.recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    finalTranscript += result[0].transcript;
                } else {
                    interimTranscript += result[0].transcript;
                }
            }

            if (this.settings.autoSubmitMode) {
                // Auto mode: show live what we're hearing, process on final
                if (interimTranscript) {
                    // Show interim results live (grayed out)
                    this.transcript.showLive(interimTranscript);
                }
                if (finalTranscript) {
                    this.transcript.show(finalTranscript);
                    this.handleVoiceCommand(finalTranscript);
                }
            } else {
                // Manual mode: accumulate segments
                if (finalTranscript) {
                    this.transcript.addSegment(finalTranscript);
                }
                if (interimTranscript) {
                    this.transcript.setInterim(interimTranscript);
                }
                this.transcript.showSegments(this.transcript.segments, this.transcript.interimText);
                this.onTranscriptChange(this.transcript.getFullText());
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                this.onError(`Recognition error: ${event.error}`);
            }
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.updateListenButton(false);

            if (!this.settings.autoSubmitMode && !this.manualModeStopRequested) {
                // Manual mode: restart recognition to keep listening
                setTimeout(() => {
                    if (!this.manualModeStopRequested && !this.isProcessingCommand) {
                        try {
                            this.recognition.start();
                        } catch (e) {
                            // Ignore if already started
                        }
                    }
                }, RECOGNITION_RESTART_DELAY_MS);
            } else {
                this.manualModeStopRequested = false;
                this.updateStatus('Ready');
                this.onListeningChange(false);
            }
        };
    }

    setupUI() {
        const listenBtn = document.getElementById(this.uiIds.listenBtn);
        const submitBtn = document.getElementById(this.uiIds.submitBtn);
        const echoToggle = document.getElementById(this.uiIds.echoToggle);

        if (listenBtn) {
            listenBtn.addEventListener('click', () => {
                if (this.isListening) {
                    if (this.settings.autoSubmitMode) {
                        this.stopListening();
                    } else {
                        // Manual mode: submit accumulated transcript
                        this.submitManualTranscript();
                    }
                } else {
                    this.startListening();
                }
            });
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', () => {
                this.submitManualTranscript();
            });
        }

        // Echo commands toggle
        if (echoToggle) {
            echoToggle.checked = this.settings.echoCommands;
            echoToggle.addEventListener('change', (e) => {
                this.settings.echoCommands = e.target.checked;
            });
        }

        this.updateModeUI();
    }

    updateRecognitionMode() {
        if (this.recognition) {
            this.recognition.continuous = !this.settings.autoSubmitMode;
            this.recognition.interimResults = !this.settings.autoSubmitMode;
        }
    }

    setAutoSubmitMode(enabled) {
        this.settings.autoSubmitMode = enabled;
        this.updateRecognitionMode();
        this.updateModeUI();
        this.transcript.reset();
        if (this.isListening) {
            this.stopListening();
        }
    }

    startListening() {
        if (!this.recognition) {
            this.updateStatus('Speech recognition not available');
            return;
        }

        this.transcript.reset();
        this.manualModeStopRequested = false;

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
            if (!this.transcript.getFullText()) {
                this.transcript.clear();
            }
        }
    }

    submitManualTranscript() {
        const text = this.transcript.getFinalizedText();
        if (text) {
            this.manualModeStopRequested = true;
            if (this.isListening) {
                this.recognition.stop();
            }
            this.handleVoiceCommand(text);
        }
    }

    async handleVoiceCommand(transcript) {
        try {
            this.isProcessingCommand = true;

            // Try each registered command handler
            for (const handler of this.commandHandlers) {
                const command = handler.parse(transcript);
                if (command) {
                    this.transcript.show(transcript, { autoHideAfter: TRANSCRIPT_AUTO_HIDE_MS });
                    await handler.execute(command, transcript);
                    this.isProcessingCommand = false;
                    this.updateSubmitButton(false);
                    return;
                }
            }

            // No command matched - use fallback if available
            if (this.fallbackHandler) {
                this.transcript.show(transcript);
                this.updateSubmitButton(true);
                await this.fallbackHandler(transcript);
            } else {
                this.updateStatus('Command not recognized');
                this.transcript.show(transcript, { autoHideAfter: TRANSCRIPT_AUTO_HIDE_MS });
            }

            this.isProcessingCommand = false;
            this.updateSubmitButton(false);
        } catch (error) {
            console.error('Error handling command:', error);
            this.onError(`Error: ${error.message}`);
            this.isProcessingCommand = false;
            this.updateSubmitButton(false);
        }
    }

    // Register a command handler
    // handler: { parse: (transcript) => command|null, execute: async (command, transcript) => void }
    registerHandler(handler) {
        this.commandHandlers.push(handler);
    }

    // Set the fallback handler for unrecognized commands
    setFallbackHandler(handler) {
        this.fallbackHandler = handler;
    }

    updateListenButton(listening) {
        const btn = document.getElementById(this.uiIds.listenBtn);
        if (!btn) return;

        const textEl = btn.querySelector('.button-text');
        if (listening) {
            btn.classList.add('listening');
            if (textEl) textEl.textContent = 'Listening...';
            this.updateSubmitButton(true);
        } else {
            btn.classList.remove('listening');
            if (textEl) textEl.textContent = 'Listen';
            if (!this.isProcessingCommand) {
                this.updateSubmitButton(false);
            }
        }
    }

    updateSubmitButton(show) {
        const submitBtn = document.getElementById(this.uiIds.submitBtn);
        const listenBtn = document.getElementById(this.uiIds.listenBtn);
        if (submitBtn && listenBtn) {
            if (show && !this.settings.autoSubmitMode) {
                submitBtn.style.display = 'flex';
                listenBtn.style.maxWidth = '50%';
            } else {
                submitBtn.style.display = 'none';
                listenBtn.style.maxWidth = '100%';
            }
        }
    }

    updateModeUI() {
        // Override in consumer if needed
    }

    updateStatus(message) {
        const statusEl = document.getElementById(this.uiIds.statusEl);
        if (statusEl) {
            statusEl.textContent = message;
        }
        this.onStatusChange(message);
    }

    // Utility: speak text aloud
    // Uses VoiceOutput library if available, otherwise falls back to native speechSynthesis
    speakText(text, onEnd = null) {
        if (typeof VoiceOutput !== 'undefined') {
            VoiceOutput.speak(text).then(() => {
                if (onEnd) onEnd();
            }).catch(() => {
                if (onEnd) onEnd();
            });
        } else if ('speechSynthesis' in window) {
            // Native Web Speech API with configurable voice settings
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);

            // Apply voice settings
            utterance.rate = this.settings.voiceRate;
            utterance.pitch = this.settings.voicePitch;

            // Set specific voice if configured
            if (this.settings.voiceName && this.availableVoices.length > 0) {
                const voice = this.availableVoices.find(v => v.name === this.settings.voiceName);
                if (voice) {
                    utterance.voice = voice;
                }
            }

            if (onEnd) {
                utterance.onend = onEnd;
            }
            window.speechSynthesis.speak(utterance);
        } else {
            console.warn('[VoiceCommandCore] No speech synthesis available');
            if (onEnd) onEnd();
        }
    }

    speakTextAsync(text) {
        return new Promise((resolve) => {
            this.speakText(text, resolve);
        });
    }
}

// Export for use by consumers
window.VoiceCommandCore = VoiceCommandCore;
window.TranscriptManager = TranscriptManager;

