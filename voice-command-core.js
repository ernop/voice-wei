// @ts-check
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

class TranscriptManager {
    constructor() {
        /** @type {HTMLElement | null} */
        this.container = null;
        /** @type {HTMLElement | null} */
        this.textElement = null;
        /** @type {string[]} */
        this.segments = [];
        /** @type {string} */
        this.interimText = '';
        /** @type {ReturnType<typeof setTimeout> | null} */
        this.hideTimeout = null;
    }

    /**
     * @param {string} [containerId]
     * @param {string} [textId]
     */
    init(containerId = 'transcriptContainer', textId = 'transcript') {
        this.container = document.getElementById(containerId);
        this.textElement = document.getElementById(textId);
    }

    /**
     * @param {string} text
     * @param {{ interim?: boolean, autoHideAfter?: number | null }} [options]
     */
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

    /**
     * Show live interim results while listening (distinct styling)
     * @param {string} text
     */
    showLive(text) {
        if (!this.container || !this.textElement) return;

        this.clearHideTimeout();
        this.textElement.textContent = text + '...';
        this.textElement.classList.add('live-interim');
        this.container.style.display = 'block';
    }

    /**
     * @param {string[]} segments
     * @param {string} [interimText]
     */
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

    /** @param {string} text */
    addSegment(text) {
        const trimmed = text.trim();
        if (trimmed) {
            this.segments.push(trimmed);
        }
        this.interimText = '';
    }

    /** @param {string} text */
    setInterim(text) {
        this.interimText = text;
    }

    /** @returns {string} */
    getFullText() {
        const segmentsText = this.segments.join(' ');
        return (segmentsText + (this.interimText ? ' ' + this.interimText : '')).trim();
    }

    /** @returns {string} */
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

    /**
     * @param {string} text
     * @returns {string}
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

//-------VOICE COMMAND CORE-------

class VoiceCommandCore {
    /** @param {any} [options] */
    constructor(options = {}) {
        /** @type {InstanceType<typeof window.SpeechRecognition> | null} */
        this.recognition = null;
        /** @type {boolean} */
        this.isListening = false;
        /** @type {TranscriptManager} */
        this.transcript = new TranscriptManager();
        /** @type {boolean} */
        this.manualModeStopRequested = false;
        /** @type {boolean} */
        this.isProcessingCommand = false;

        /** @type {{ autoSubmitMode: boolean, echoCommands: boolean, voiceRate: number, voicePitch: number, voiceName: string | null }} */
        this.settings = {
            autoSubmitMode: true,
            echoCommands: false,
            voiceRate: 1.0,
            voicePitch: 1.0,
            voiceName: null,
            ...options.settings
        };

        /** @type {((command: unknown) => string) | null} */
        this.getCommandDescription = options.getCommandDescription || null;

        /** @type {SpeechSynthesisVoice[]} */
        this.availableVoices = [];

        /** @type {(msg: string) => void} */
        this.onStatusChange = options.onStatusChange || (() => { });
        /** @type {(listening: boolean) => void} */
        this.onListeningChange = options.onListeningChange || (() => { });
        /** @type {(text: string) => void} */
        this.onTranscriptChange = options.onTranscriptChange || (() => { });
        /** @type {(msg: string) => void} */
        this.onError = options.onError || ((msg) => console.error(msg));

        /** @type {Array<{ parse: (transcript: string) => unknown | null, execute: (command: unknown, transcript: string) => Promise<void> }>} */
        this.commandHandlers = [];

        /** @type {((transcript: string) => Promise<void>) | null} */
        this.fallbackHandler = options.fallbackHandler || null;

        /** @type {{ listenBtn: string, submitBtn: string, statusEl: string, echoToggle: string, transcriptContainer: string, transcriptText: string }} */
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

    /** @returns {boolean} */
    get echoCommands() {
        return this.settings.echoCommands;
    }

    /** @param {boolean} value */
    set echoCommands(value) {
        this.settings.echoCommands = value;
        const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById(this.uiIds.echoToggle));
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

    loadAvailableVoices() {
        if (!('speechSynthesis' in window)) return;

        const loadVoices = () => {
            this.availableVoices = window.speechSynthesis.getVoices();
            this.availableVoices.sort((a, b) => {
                const aEng = a.lang.startsWith('en');
                const bEng = b.lang.startsWith('en');
                if (aEng && !bEng) return -1;
                if (!aEng && bEng) return 1;
                return a.name.localeCompare(b.name);
            });
        };

        loadVoices();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    }

    /** @returns {Array<{ name: string, lang: string, local: boolean, default: boolean }>} */
    getAvailableVoices() {
        return this.availableVoices.map(v => ({
            name: v.name,
            lang: v.lang,
            local: v.localService,
            default: v.default
        }));
    }

    /** @param {string | null} voiceName */
    setVoice(voiceName) {
        this.settings.voiceName = voiceName;
    }

    /** @param {number} rate */
    setVoiceRate(rate) {
        this.settings.voiceRate = Math.max(0.1, Math.min(10, rate));
    }

    /** @param {number} pitch */
    setVoicePitch(pitch) {
        this.settings.voicePitch = Math.max(0, Math.min(2, pitch));
    }

    setupSpeechRecognition() {
        const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) {
            this.updateStatus('Speech recognition not supported in this browser');
            return;
        }

        this.recognition = new SpeechRecognitionCtor();
        this.recognition.continuous = !this.settings.autoSubmitMode;
        this.recognition.interimResults = !this.settings.autoSubmitMode;
        this.recognition.lang = 'en-US';

        this.recognition.onstart = () => {
            this.isListening = true;
            this.updateListenButton(true);
            this.updateStatus('Listening...');
            this.onListeningChange(true);
        };

        this.recognition.onresult = (/** @type {SpeechRecognitionEvent} */ event) => {
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
                if (interimTranscript) {
                    this.transcript.showLive(interimTranscript);
                }
                if (finalTranscript) {
                    this.transcript.show(finalTranscript);
                    this.handleVoiceCommand(finalTranscript);
                }
            } else {
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

        this.recognition.onerror = (/** @type {SpeechRecognitionErrorEvent} */ event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                this.onError(`Recognition error: ${event.error}`);
            }
        };

        this.recognition.onend = () => {
            this.isListening = false;
            this.updateListenButton(false);

            if (!this.settings.autoSubmitMode && !this.manualModeStopRequested) {
                setTimeout(() => {
                    if (!this.manualModeStopRequested && !this.isProcessingCommand && this.recognition) {
                        try {
                            this.recognition.start();
                        } catch (_e) {
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
        const echoToggle = /** @type {HTMLInputElement | null} */ (document.getElementById(this.uiIds.echoToggle));

        if (listenBtn) {
            listenBtn.addEventListener('click', () => {
                if (this.isListening) {
                    if (this.settings.autoSubmitMode) {
                        this.stopListening();
                    } else {
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

        if (echoToggle) {
            echoToggle.checked = this.settings.echoCommands;
            echoToggle.addEventListener('change', (e) => {
                const target = /** @type {HTMLInputElement} */ (e.target);
                this.settings.echoCommands = target.checked;
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

    /** @param {boolean} enabled */
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
        } catch (_error) {
            console.error('Error starting recognition:', _error);
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
        if (text && this.recognition) {
            this.manualModeStopRequested = true;
            if (this.isListening) {
                this.recognition.stop();
            }
            this.handleVoiceCommand(text);
        }
    }

    /** @param {string} transcript */
    async handleVoiceCommand(transcript) {
        try {
            this.isProcessingCommand = true;

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
            const msg = error instanceof Error ? error.message : String(error);
            this.onError(`Error: ${msg}`);
            this.isProcessingCommand = false;
            this.updateSubmitButton(false);
        }
    }

    /** @param {{ parse: (transcript: string) => unknown | null, execute: (command: unknown, transcript: string) => Promise<void> }} handler */
    registerHandler(handler) {
        this.commandHandlers.push(handler);
    }

    /** @param {(transcript: string) => Promise<void>} handler */
    setFallbackHandler(handler) {
        this.fallbackHandler = handler;
    }

    /** @param {boolean} listening */
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

    /** @param {boolean} show */
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

    /** @param {string} message */
    updateStatus(message) {
        const statusEl = document.getElementById(this.uiIds.statusEl);
        if (statusEl) {
            statusEl.textContent = message;
        }
        this.onStatusChange(message);
    }

    /**
     * Speak text aloud using VoiceOutput library or native speechSynthesis
     * @param {string} text
     * @param {(() => void) | null} [onEnd]
     */
    speakText(text, onEnd = null) {
        if (typeof VoiceOutput !== 'undefined') {
            VoiceOutput.speak(text).then(() => {
                if (onEnd) onEnd();
            }).catch(() => {
                if (onEnd) onEnd();
            });
        } else if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);

            utterance.rate = this.settings.voiceRate;
            utterance.pitch = this.settings.voicePitch;

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

    /**
     * @param {string} text
     * @returns {Promise<void>}
     */
    speakTextAsync(text) {
        return new Promise((resolve) => {
            this.speakText(text, resolve);
        });
    }
}

// Export for use by consumers
window.VoiceCommandCore = VoiceCommandCore;
window.TranscriptManager = TranscriptManager;
