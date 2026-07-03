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

// Speech engines re-deliver results: every onresult event describes the
// CURRENT state of the session's result list, not an increment. Desktop
// Chrome appends new indices; Android Chrome re-sends the same index with
// grown cumulative text (often marked final each time). The only safe model
// is to mirror the engine's result list by index and rebuild the transcript
// from it on every event -- never append across events.

class TranscriptManager {
    constructor() {
        /** @type {HTMLElement | null} */
        this.container = null;
        /** @type {HTMLElement | null} */
        this.textElement = null;
        /** Finalized text from completed recognition sessions (manual mode
         *  silently restarts recognition between pauses). @type {string} */
        this.committedText = '';
        /** Mirror of the engine's result list for the CURRENT session,
         *  indexed by the engine's own result index.
         *  @type {Array<{ text: string, isFinal: boolean } | undefined>} */
        this.sessionResults = [];
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

    /** A new recognition session started; its result indices start over. */
    beginSession() {
        this.sessionResults = [];
    }

    /**
     * Mirror one engine result. Re-delivered indices overwrite in place,
     * which makes repeated cumulative updates idempotent.
     * @param {number} index
     * @param {string} text
     * @param {boolean} isFinal
     */
    updateSessionResult(index, text, isFinal) {
        this.sessionResults[index] = { text, isFinal };
    }

    /** Fold the finished session's finalized text into the committed text. */
    endSession() {
        this.committedText = this.getFinalizedText();
        this.sessionResults = [];
    }

    /**
     * Join result texts, collapsing cumulative re-deliveries: when a chunk
     * restates everything said so far and extends it (Android's pattern),
     * it replaces the accumulation instead of being appended.
     * @param {string[]} parts
     * @returns {string}
     */
    joinCollapsing(parts) {
        const normalize = (/** @type {string} */ text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
        let joined = '';
        for (const part of parts) {
            const text = part.trim();
            if (!text) continue;
            if (!joined) {
                joined = text;
            } else if (normalize(text).startsWith(normalize(joined))) {
                joined = text;
            } else {
                joined = `${joined} ${text}`;
            }
        }
        return joined;
    }

    /**
     * @param {boolean} includeInterim
     * @returns {string}
     */
    sessionText(includeInterim) {
        const parts = [];
        for (const result of this.sessionResults) {
            if (!result) continue;
            if (result.isFinal || includeInterim) parts.push(result.text);
        }
        return this.joinCollapsing(parts);
    }

    /** @returns {string} Committed plus current-session finalized text. */
    getFinalizedText() {
        return `${this.committedText} ${this.sessionText(false)}`.trim();
    }

    /** @returns {string} Everything, including the live interim tail. */
    getFullText() {
        return `${this.committedText} ${this.sessionText(true)}`.trim();
    }

    /** Render finalized text normally with the interim tail styled live. */
    renderLive() {
        if (!this.container || !this.textElement) return;

        this.clearHideTimeout();
        const finalized = this.getFinalizedText();
        const full = this.getFullText();
        const interimTail = full.startsWith(finalized)
            ? full.slice(finalized.length).trim()
            : '';
        const shownFinal = interimTail || !full ? finalized : full;

        let html = '';
        if (shownFinal) html += `<span class="segment">${this.escapeHtml(shownFinal)}</span>`;
        if (interimTail) {
            html += `${shownFinal ? ' ' : ''}<span class="segment interim">${this.escapeHtml(interimTail)}</span>`;
        }
        this.textElement.innerHTML = html || '<span class="interim">...</span>';
        this.container.style.display = 'block';
    }

    clear() {
        this.committedText = '';
        this.sessionResults = [];
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
        /** @type {() => void} Runs when the user initiates listening (not on auto-restarts) */
        this.onBeforeListen = options.onBeforeListen || (() => { });
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
            this.transcript.beginSession();
            this.updateListenButton(true);
            this.updateStatus(this.settings.autoSubmitMode
                ? 'Listening...'
                : 'Listening... say "submit" when done');
            this.onListeningChange(true);
        };

        this.recognition.onresult = (/** @type {SpeechRecognitionEvent} */ event) => {
            // Mirror the engine's result list; never append across events.
            // (See TranscriptManager: engines re-deliver and grow results.)
            let sawFinal = false;
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                this.transcript.updateSessionResult(i, result[0].transcript, Boolean(result.isFinal));
                if (result.isFinal) sawFinal = true;
            }

            if (this.settings.autoSubmitMode) {
                // Auto mode runs one utterance per session; submit it as
                // soon as the engine finalizes.
                const finalized = this.transcript.getFinalizedText();
                if (sawFinal && finalized) {
                    this.transcript.clear();
                    this.transcript.show(finalized);
                    this.handleVoiceCommand(finalized);
                } else {
                    const interim = this.transcript.getFullText();
                    if (interim) this.transcript.showLive(interim);
                }
                return;
            }

            // Hands-free manual mode: a trailing spoken "submit" sends
            // everything heard so far (minus the word itself).
            const lowerFull = this.transcript.getFullText().toLowerCase();
            if (lowerFull === 'submit' || lowerFull.endsWith(' submit')) {
                this.submitManualTranscript();
                return;
            }

            this.transcript.renderLive();
            this.onTranscriptChange(this.transcript.getFullText());
        };

        this.recognition.onerror = (/** @type {SpeechRecognitionErrorEvent} */ event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error === 'no-speech') {
                // Manual mode restarts silently between segments; in auto
                // mode silence means the user didn't speak.
                if (this.settings.autoSubmitMode) {
                    this.updateStatus('No speech detected. Tap Listen to try again.');
                }
                return;
            }
            if (event.error === 'aborted') return;
            if (event.error === 'network') {
                this.updateStatus('Network error. Check connection.');
            } else if (event.error === 'not-allowed') {
                this.updateStatus('Microphone access denied. Check permissions.');
            }
            this.onError(`Recognition error: ${event.error}`);
        };

        this.recognition.onend = () => {
            this.isListening = false;
            // Manual mode silently restarts between pauses; finalized text
            // must survive the restart while result indices start over.
            this.transcript.endSession();
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
            echoToggle.addEventListener('input', (e) => {
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

        this.onBeforeListen();
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
        // Interim text is the best transcript we have at submit time, so it
        // is included; a trailing spoken "submit" is the send command, not
        // part of the request.
        const text = this.transcript.getFullText().replace(/\s*submit\s*$/i, '').trim();
        if (!this.recognition) return;
        if (!text) {
            this.stopListening();
            return;
        }
        this.manualModeStopRequested = true;
        if (this.isListening) {
            this.recognition.stop();
        }
        // The request is captured in `text`; drop the accumulation state so
        // a later Submit cannot resend it.
        this.transcript.clear();
        this.handleVoiceCommand(text);
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
     * Speak text aloud via the shared VoiceOutput library, honoring this
     * core's voice settings (rate, pitch, selected voice).
     * @param {string} text
     * @param {(() => void) | null} [onEnd]
     */
    speakText(text, onEnd = null) {
        VoiceOutput.speak(text, {
            rate: this.settings.voiceRate,
            pitch: this.settings.voicePitch,
            voiceName: this.settings.voiceName
        }).then(() => {
            if (onEnd) onEnd();
        }).catch(() => {
            if (onEnd) onEnd();
        });
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
