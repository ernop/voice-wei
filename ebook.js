// @ts-check
// Ebook to Audiobook Converter using OpenAI TTS
// v2 - Progressive playback, history tracking, enhanced timeline

// Configure PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// OpenAI TTS limits: 4096 characters per request
const TTS_CHUNK_SIZE = 4000;

// Timing constants
const PROGRESS_UPDATE_INTERVAL_MS = 250;
const POSITION_SAVE_INTERVAL_MS = 5000;

/**
 * @typedef {Object} BookData
 * @property {string} title
 * @property {string} author
 * @property {string} text
 * @property {string[]} chapters
 * @property {string} format
 * @property {string} fileHash
 */

/**
 * @typedef {Object} AudioChunk
 * @property {number} index
 * @property {Blob} blob
 * @property {number} duration
 * @property {number} startTime
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {number} timestamp
 * @property {string} action
 * @property {number} position
 * @property {string} description
 */

/**
 * @typedef {Object} Settings
 * @property {string} voice
 * @property {string} model
 * @property {number} speed
 */

class EbookController {
    constructor() {
        /** @type {string | null} */
        this.apiKey = null;
        /** @type {BookData | null} */
        this.bookData = null;
        /** @type {Settings} */
        this.settings = {
            voice: 'alloy',
            model: 'tts-1',
            speed: 1.0
        };
        /** @type {AudioChunk[]} */
        this.audioChunks = [];
        /** @type {Blob | null} */
        this.fullAudioBlob = null;
        /** @type {boolean} */
        this.isConverting = false;
        /** @type {AbortController | null} */
        this.abortController = null;
        /** @type {number} */
        this.currentChunkIndex = 0;
        /** @type {number} */
        this.totalDuration = 0;
        /** @type {HistoryEntry[]} */
        this.playbackHistory = [];
        /** @type {number} */
        this.savedPosition = 0;
        /** @type {ReturnType<typeof setInterval> | null} */
        this.progressInterval = null;
        /** @type {ReturnType<typeof setInterval> | null} */
        this.positionSaveInterval = null;
        /** @type {number} */
        this.zoomLevel = 1; // 1 = full view, higher = zoomed in
        /** @type {number} */
        this.zoomCenter = 0.5; // Center of zoom (0-1)

        this.init();
    }

    async init() {
        this.loadApiKey();
        this.loadSettings();
        this.setupUI();
        this.setupDragAndDrop();
        this.setupAudioPlayer();
    }

    // API Key Management
    loadApiKey() {
        const storedKey = localStorage.getItem('openaiApiKey');
        if (storedKey && storedKey.length > 10) {
            this.apiKey = storedKey;
            const keyPreview = storedKey.substring(0, 10) + '...';
            this.log('info', `OpenAI API Key loaded (${keyPreview})`);
            this.updateApiKeyUI(true);
        } else {
            this.log('warn', 'OpenAI API Key not configured');
            this.showApiKeyOverlay();
            this.updateApiKeyUI(false);
        }
    }

    /** @param {string} apiKey */
    saveApiKey(apiKey) {
        if (!apiKey || apiKey.length < 10) {
            this.updateStatus('Invalid API key');
            return false;
        }

        localStorage.setItem('openaiApiKey', apiKey);
        this.apiKey = apiKey;

        const keyPreview = apiKey.substring(0, 10) + '...';
        this.log('info', `API Key saved (${keyPreview})`);
        this.updateStatus('API key saved');
        this.hideApiKeyOverlay();
        this.updateApiKeyUI(true);

        const settingsInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyInput'));
        const overlayInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyOverlayInput'));
        if (settingsInput) settingsInput.value = '';
        if (overlayInput) overlayInput.value = '';

        this.updateConvertButton();
        return true;
    }

    removeApiKey() {
        localStorage.removeItem('openaiApiKey');
        this.apiKey = null;
        this.log('info', 'API Key removed');
        this.updateStatus('API key removed');
        this.updateApiKeyUI(false);
        this.showApiKeyOverlay();
        this.updateConvertButton();
    }

    showApiKeyOverlay() {
        const overlay = document.getElementById('apiKeyOverlay');
        if (overlay) overlay.style.display = 'flex';
    }

    hideApiKeyOverlay() {
        const overlay = document.getElementById('apiKeyOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    /** @param {boolean} hasKey */
    updateApiKeyUI(hasKey) {
        const statusEl = document.getElementById('apiKeyStatus');
        const inputRow = document.getElementById('apiKeyInputRow');
        const actionsRow = document.getElementById('apiKeyActions');

        if (!statusEl || !inputRow || !actionsRow) return;

        if (hasKey) {
            const storedKey = localStorage.getItem('openaiApiKey') || '';
            const preview = storedKey.substring(0, 10) + '...' + storedKey.substring(storedKey.length - 4);
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

    // Settings Management
    loadSettings() {
        const saved = localStorage.getItem('ebookSettings');
        if (saved) {
            this.settings = { ...this.settings, ...JSON.parse(saved) };
        }

        const voiceEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsVoice'));
        const modelEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsModel'));
        const speedEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ttsSpeed'));
        const speedValueEl = document.getElementById('ttsSpeedValue');

        if (voiceEl) voiceEl.value = this.settings.voice;
        if (modelEl) modelEl.value = this.settings.model;
        if (speedEl) speedEl.value = String(this.settings.speed);
        if (speedValueEl) speedValueEl.textContent = `${this.settings.speed}x`;
    }

    saveSettings() {
        localStorage.setItem('ebookSettings', JSON.stringify(this.settings));
    }

    setupUI() {
        // Settings panel
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsPanel = document.getElementById('settingsPanel');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');

        if (settingsBtn && settingsPanel) {
            settingsBtn.addEventListener('click', () => {
                settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
            });
        }

        if (closeSettingsBtn && settingsPanel) {
            closeSettingsBtn.addEventListener('click', () => {
                settingsPanel.style.display = 'none';
            });
        }

        this.setupApiKeyUI();

        // Settings controls
        const voiceEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsVoice'));
        const modelEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsModel'));
        const speedEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ttsSpeed'));
        const speedValueEl = document.getElementById('ttsSpeedValue');

        if (voiceEl) {
            voiceEl.addEventListener('change', () => {
                this.settings.voice = voiceEl.value;
                this.saveSettings();
            });
        }

        if (modelEl) {
            modelEl.addEventListener('change', () => {
                this.settings.model = modelEl.value;
                this.saveSettings();
            });
        }

        if (speedEl && speedValueEl) {
            speedEl.addEventListener('input', () => {
                this.settings.speed = parseFloat(speedEl.value);
                speedValueEl.textContent = `${this.settings.speed}x`;
                this.saveSettings();
            });
        }

        // File upload
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('fileInput'));

        if (uploadArea && fileInput) {
            uploadArea.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                const target = /** @type {HTMLInputElement} */ (e.target);
                if (target.files && target.files[0]) {
                    this.handleFile(target.files[0]);
                }
            });
        }

        // Convert button
        const convertBtn = document.getElementById('convertBtn');
        if (convertBtn) {
            convertBtn.addEventListener('click', () => this.convertToAudio());
        }

        // Clear book button
        const clearBookBtn = document.getElementById('clearBookBtn');
        if (clearBookBtn) {
            clearBookBtn.addEventListener('click', () => this.clearBook());
        }

        // Cancel conversion button
        const cancelBtn = document.getElementById('cancelConversionBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancelConversion());
        }

        // Download button
        const downloadBtn = document.getElementById('downloadAudioBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadAudio());
        }

        // Text preview actions
        const selectAllBtn = document.getElementById('selectAllTextBtn');
        const copyTextBtn = document.getElementById('copyTextBtn');

        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => this.selectAllText());
        }

        if (copyTextBtn) {
            copyTextBtn.addEventListener('click', () => this.copyText());
        }

        // Log clear button
        const clearLogBtn = document.getElementById('clearLogBtn');
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', () => this.clearLog());
        }

        // Quick jump buttons
        this.setupQuickJumpButtons();

        // Zoom controls
        this.setupZoomControls();
    }

    setupApiKeyUI() {
        const saveBtn = document.getElementById('saveApiKeyBtn');
        const showBtn = document.getElementById('showApiKeyBtn');
        const changeBtn = document.getElementById('changeApiKeyBtn');
        const removeBtn = document.getElementById('removeApiKeyBtn');
        const inputEl = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyInput'));

        if (saveBtn && inputEl) {
            saveBtn.addEventListener('click', () => {
                this.saveApiKey(inputEl.value.trim());
            });
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.saveApiKey(inputEl.value.trim());
                }
            });
        }

        if (showBtn) {
            showBtn.addEventListener('click', () => {
                const storedKey = localStorage.getItem('openaiApiKey') || '';
                if (showBtn.textContent === 'Show') {
                    const statusEl = document.getElementById('apiKeyStatus');
                    if (statusEl) statusEl.textContent = storedKey;
                    showBtn.textContent = 'Hide';
                } else {
                    this.updateApiKeyUI(true);
                    showBtn.textContent = 'Show';
                }
            });
        }

        if (changeBtn) {
            changeBtn.addEventListener('click', () => {
                const inputRow = document.getElementById('apiKeyInputRow');
                const actionsRow = document.getElementById('apiKeyActions');
                if (inputRow) inputRow.style.display = 'flex';
                if (actionsRow) actionsRow.style.display = 'none';
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (confirm('Remove your API key from localStorage?')) {
                    this.removeApiKey();
                }
            });
        }

        const overlayInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyOverlayInput'));
        const overlaySaveBtn = document.getElementById('saveApiKeyOverlayBtn');

        if (overlaySaveBtn && overlayInput) {
            overlaySaveBtn.addEventListener('click', () => {
                this.saveApiKey(overlayInput.value.trim());
            });
            overlayInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.saveApiKey(overlayInput.value.trim());
                }
            });
        }
    }

    setupQuickJumpButtons() {
        const jumpBtns = document.querySelectorAll('.jump-btn');
        jumpBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const seconds = parseInt(btn.getAttribute('data-seconds') || '0', 10);
                this.jumpBySeconds(seconds);
            });
        });
    }

    setupZoomControls() {
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const zoomResetBtn = document.getElementById('zoomResetBtn');

        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => this.adjustZoom(2));
        }
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => this.adjustZoom(0.5));
        }
        if (zoomResetBtn) {
            zoomResetBtn.addEventListener('click', () => this.resetZoom());
        }
    }

    /** @param {number} factor */
    adjustZoom(factor) {
        const oldZoom = this.zoomLevel;
        this.zoomLevel = Math.max(1, Math.min(20, this.zoomLevel * factor));

        // Adjust zoom center to keep current position visible
        const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (audioPlayer && audioPlayer.duration) {
            this.zoomCenter = audioPlayer.currentTime / audioPlayer.duration;
        }

        this.updateZoomDisplay();
        this.log('info', `Zoom: ${this.zoomLevel.toFixed(1)}x`);
    }

    resetZoom() {
        this.zoomLevel = 1;
        this.zoomCenter = 0.5;
        this.updateZoomDisplay();
    }

    updateZoomDisplay() {
        const zoomLabel = document.getElementById('zoomLabel');
        if (zoomLabel) {
            zoomLabel.textContent = `${this.zoomLevel.toFixed(1)}x`;
        }

        // Update timeline width based on zoom
        const timelineInner = document.getElementById('timelineInner');
        if (timelineInner) {
            timelineInner.style.width = `${this.zoomLevel * 100}%`;

            // Scroll to keep current position centered
            const timelineContainer = document.getElementById('timelineContainer');
            if (timelineContainer && this.zoomLevel > 1) {
                const scrollPos = (this.zoomCenter * timelineInner.offsetWidth) - (timelineContainer.offsetWidth / 2);
                timelineContainer.scrollLeft = Math.max(0, scrollPos);
            }
        }
    }

    setupAudioPlayer() {
        const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audioPlayer) return;

        audioPlayer.addEventListener('play', () => {
            this.addHistoryEntry('play', audioPlayer.currentTime, 'Started playback');
            this.startProgressUpdates();
        });

        audioPlayer.addEventListener('pause', () => {
            this.addHistoryEntry('pause', audioPlayer.currentTime, 'Paused playback');
            this.stopProgressUpdates();
        });

        audioPlayer.addEventListener('seeked', () => {
            this.addHistoryEntry('seek', audioPlayer.currentTime, `Jumped to ${this.formatTime(audioPlayer.currentTime)}`);
        });

        audioPlayer.addEventListener('ended', () => {
            this.addHistoryEntry('ended', audioPlayer.currentTime, 'Finished playback');
            this.stopProgressUpdates();
        });

        audioPlayer.addEventListener('timeupdate', () => {
            this.updateTimelinePosition();
        });

        // Custom timeline click handling
        const timelineTrack = document.getElementById('timelineTrack');
        if (timelineTrack) {
            timelineTrack.addEventListener('click', (e) => {
                this.handleTimelineClick(e);
            });
        }

        // Start position save interval
        this.positionSaveInterval = setInterval(() => {
            if (audioPlayer && !audioPlayer.paused && this.bookData) {
                this.savePlaybackPosition(audioPlayer.currentTime);
            }
        }, POSITION_SAVE_INTERVAL_MS);
    }

    /** @param {MouseEvent} e */
    handleTimelineClick(e) {
        const timelineTrack = document.getElementById('timelineTrack');
        const timelineInner = document.getElementById('timelineInner');
        const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));

        if (!timelineTrack || !timelineInner || !audioPlayer || !audioPlayer.duration) return;

        const rect = timelineInner.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        const newTime = percentage * audioPlayer.duration;

        const oldTime = audioPlayer.currentTime;
        audioPlayer.currentTime = newTime;

        this.addHistoryEntry('jump', newTime, `Jumped from ${this.formatTime(oldTime)} to ${this.formatTime(newTime)}`);
    }

    /** @param {number} seconds */
    jumpBySeconds(seconds) {
        const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audioPlayer) return;

        const oldTime = audioPlayer.currentTime;
        const newTime = Math.max(0, Math.min(audioPlayer.duration || 0, oldTime + seconds));
        audioPlayer.currentTime = newTime;

        const direction = seconds > 0 ? '+' : '';
        this.addHistoryEntry('jump', newTime, `${direction}${seconds}s: ${this.formatTime(oldTime)} -> ${this.formatTime(newTime)}`);
    }

    /**
     * @param {string} action
     * @param {number} position
     * @param {string} description
     */
    addHistoryEntry(action, position, description) {
        const entry = {
            timestamp: Date.now(),
            action,
            position,
            description
        };

        this.playbackHistory.unshift(entry);

        // Keep only last 100 entries
        if (this.playbackHistory.length > 100) {
            this.playbackHistory.pop();
        }

        this.renderPlaybackHistory();
        this.savePlaybackHistory();
    }

    renderPlaybackHistory() {
        const historyList = document.getElementById('playbackHistoryList');
        if (!historyList) return;

        if (this.playbackHistory.length === 0) {
            historyList.innerHTML = '<p class="history-empty">No playback history yet</p>';
            return;
        }

        historyList.innerHTML = this.playbackHistory.map((entry, index) => {
            const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const positionStr = this.formatTime(entry.position);
            const icon = this.getActionIcon(entry.action);

            return `<div class="history-item" data-index="${index}" data-position="${entry.position}">
                <span class="history-icon">${icon}</span>
                <span class="history-time">${time}</span>
                <span class="history-position">[${positionStr}]</span>
                <span class="history-desc">${this.escapeHtml(entry.description)}</span>
            </div>`;
        }).join('');

        // Add click handlers
        historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const position = parseFloat(item.getAttribute('data-position') || '0');
                this.jumpToPosition(position);
            });
        });
    }

    /** @param {string} action */
    getActionIcon(action) {
        const icons = {
            'play': '&#9654;',
            'pause': '&#10074;&#10074;',
            'seek': '&#8644;',
            'jump': '&#8618;',
            'ended': '&#9632;'
        };
        return icons[action] || '&#8226;';
    }

    /** @param {number} position */
    jumpToPosition(position) {
        const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audioPlayer) return;

        const oldTime = audioPlayer.currentTime;
        audioPlayer.currentTime = position;
        this.addHistoryEntry('jump', position, `History jump: ${this.formatTime(oldTime)} -> ${this.formatTime(position)}`);
    }

    savePlaybackHistory() {
        if (!this.bookData) return;
        const key = `ebookHistory_${this.bookData.fileHash}`;
        localStorage.setItem(key, JSON.stringify(this.playbackHistory.slice(0, 50)));
    }

    loadPlaybackHistory() {
        if (!this.bookData) return;
        const key = `ebookHistory_${this.bookData.fileHash}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            this.playbackHistory = JSON.parse(saved);
            this.renderPlaybackHistory();
        }
    }

    /** @param {number} position */
    savePlaybackPosition(position) {
        if (!this.bookData) return;
        const key = `ebookPosition_${this.bookData.fileHash}`;
        localStorage.setItem(key, String(position));
    }

    loadPlaybackPosition() {
        if (!this.bookData) return 0;
        const key = `ebookPosition_${this.bookData.fileHash}`;
        const saved = localStorage.getItem(key);
        return saved ? parseFloat(saved) : 0;
    }

    startProgressUpdates() {
        this.stopProgressUpdates();
        this.progressInterval = setInterval(() => {
            this.updateTimelinePosition();
        }, PROGRESS_UPDATE_INTERVAL_MS);
    }

    stopProgressUpdates() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    updateTimelinePosition() {
        const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        const timelineFill = document.getElementById('timelineFill');
        const timelineHandle = document.getElementById('timelineHandle');
        const currentTimeEl = document.getElementById('currentTimeDisplay');
        const totalTimeEl = document.getElementById('totalTimeDisplay');
        const remainingTimeEl = document.getElementById('remainingTimeDisplay');

        if (!audioPlayer || !audioPlayer.duration) return;

        const percentage = (audioPlayer.currentTime / audioPlayer.duration) * 100;

        if (timelineFill) timelineFill.style.width = `${percentage}%`;
        if (timelineHandle) timelineHandle.style.left = `${percentage}%`;
        if (currentTimeEl) currentTimeEl.textContent = this.formatTime(audioPlayer.currentTime);
        if (totalTimeEl) totalTimeEl.textContent = this.formatTime(audioPlayer.duration);
        if (remainingTimeEl) {
            const remaining = audioPlayer.duration - audioPlayer.currentTime;
            remainingTimeEl.textContent = `-${this.formatTime(remaining)}`;
        }
    }

    setupDragAndDrop() {
        const uploadArea = document.getElementById('uploadArea');
        if (!uploadArea) return;

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files[0]) {
                this.handleFile(e.dataTransfer.files[0]);
            }
        });
    }

    /** @param {File} file */
    async handleFile(file) {
        const extension = file.name.split('.').pop()?.toLowerCase();
        this.log('info', `Processing file: ${file.name} (${this.formatFileSize(file.size)})`);
        this.updateStatus('Processing file...');

        try {
            let text = '';
            let title = file.name.replace(/\.[^.]+$/, '');
            let author = '';
            /** @type {string[]} */
            let chapters = [];

            switch (extension) {
                case 'txt':
                    text = await this.readTextFile(file);
                    break;
                case 'epub':
                    const epubData = await this.parseEpub(file);
                    text = epubData.text;
                    title = epubData.title || title;
                    author = epubData.author || '';
                    chapters = epubData.chapters || [];
                    break;
                case 'pdf':
                    text = await this.parsePdf(file);
                    break;
                case 'html':
                case 'htm':
                    text = await this.parseHtml(file);
                    break;
                case 'mobi':
                    this.log('warn', 'MOBI format has limited support - text extraction may be incomplete');
                    text = await this.parseMobi(file);
                    break;
                default:
                    throw new Error(`Unsupported file format: ${extension}`);
            }

            if (!text || text.trim().length === 0) {
                throw new Error('No text content found in file');
            }

            text = this.cleanText(text);

            // Generate a hash for the file to track position
            const fileHash = await this.hashString(file.name + file.size + text.substring(0, 1000));

            this.bookData = {
                title,
                author,
                text,
                chapters,
                format: extension || 'unknown',
                fileHash
            };

            // Load saved history and position
            this.loadPlaybackHistory();
            this.savedPosition = this.loadPlaybackPosition();

            this.displayBook();
            this.updateStatus('Book loaded successfully');
            this.log('info', `Loaded "${title}" - ${this.formatCharCount(text.length)}`);

            if (this.savedPosition > 0) {
                this.log('info', `Saved position found: ${this.formatTime(this.savedPosition)}`);
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Failed to process file: ${message}`);
            this.updateStatus('Error processing file');
        }
    }

    /** @param {string} str */
    async hashString(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
    }

    /** @param {File} file */
    async readTextFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(/** @type {string} */ (e.target?.result) || '');
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    /** @param {File} file */
    async parseEpub(file) {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library not loaded');
        }

        const zip = await JSZip.loadAsync(file);
        const containerXml = await zip.file('META-INF/container.xml')?.async('text');
        if (!containerXml) {
            throw new Error('Invalid EPUB: missing container.xml');
        }

        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'text/xml');
        const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');

        if (!rootfilePath) {
            throw new Error('Invalid EPUB: cannot find content.opf');
        }

        const opfContent = await zip.file(rootfilePath)?.async('text');
        if (!opfContent) {
            throw new Error('Invalid EPUB: cannot read content.opf');
        }

        const opfDoc = parser.parseFromString(opfContent, 'text/xml');
        const title = opfDoc.querySelector('metadata title, dc\\:title')?.textContent || '';
        const author = opfDoc.querySelector('metadata creator, dc\\:creator')?.textContent || '';
        const basePath = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);
        const spineItems = opfDoc.querySelectorAll('spine itemref');
        const manifest = opfDoc.querySelectorAll('manifest item');

        /** @type {Map<string, string>} */
        const hrefMap = new Map();
        manifest.forEach(item => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            if (id && href) {
                hrefMap.set(id, href);
            }
        });

        let fullText = '';
        /** @type {string[]} */
        const chapters = [];

        for (const itemref of spineItems) {
            const idref = itemref.getAttribute('idref');
            if (!idref) continue;

            const href = hrefMap.get(idref);
            if (!href) continue;

            const filePath = basePath + href;
            const content = await zip.file(filePath)?.async('text');

            if (content) {
                const doc = parser.parseFromString(content, 'text/html');
                const bodyText = doc.body?.textContent || '';
                const h1 = doc.querySelector('h1, h2');
                if (h1?.textContent) {
                    chapters.push(h1.textContent.trim());
                }
                fullText += bodyText + '\n\n';
            }
        }

        return { text: fullText, title, author, chapters };
    }

    /** @param {File} file */
    async parsePdf(file) {
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF.js library not loaded');
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let fullText = '';
        const numPages = pdf.numPages;

        this.log('info', `PDF has ${numPages} pages`);

        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((/** @type {any} */ item) => item.str)
                .join(' ');
            fullText += pageText + '\n\n';

            if (numPages > 10 && i % 10 === 0) {
                this.updateStatus(`Reading PDF... ${Math.round(i / numPages * 100)}%`);
            }
        }

        return fullText;
    }

    /** @param {File} file */
    async parseHtml(file) {
        const html = await this.readTextFile(file);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('script, style, nav, header, footer').forEach(el => el.remove());
        return doc.body?.textContent || '';
    }

    /** @param {File} file */
    async parseMobi(file) {
        // MOBI is a complex format - try basic text extraction
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        // Try to find and extract readable text portions
        let text = '';
        let inText = false;
        let textBuffer = '';

        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            // Look for printable ASCII characters
            if (byte >= 32 && byte <= 126) {
                textBuffer += String.fromCharCode(byte);
                inText = true;
            } else if (byte === 10 || byte === 13) {
                textBuffer += '\n';
            } else {
                if (inText && textBuffer.length > 50) {
                    text += textBuffer + '\n';
                }
                textBuffer = '';
                inText = false;
            }
        }

        if (textBuffer.length > 50) {
            text += textBuffer;
        }

        if (text.length < 100) {
            throw new Error('Could not extract text from MOBI file. Try converting to EPUB first.');
        }

        return text;
    }

    /** @param {string} text */
    cleanText(text) {
        return text
            .replace(/[\t\f\v]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/ {2,}/g, ' ')
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .trim();
    }

    displayBook() {
        if (!this.bookData) return;

        const bookInfo = document.getElementById('bookInfo');
        const textPreviewSection = document.getElementById('textPreviewSection');
        const playbackHistorySection = document.getElementById('playbackHistorySection');

        if (bookInfo) bookInfo.style.display = 'block';
        if (textPreviewSection) textPreviewSection.style.display = 'block';
        if (playbackHistorySection) playbackHistorySection.style.display = 'block';

        const titleEl = document.getElementById('bookTitle');
        const authorEl = document.getElementById('bookAuthor');
        const statsEl = document.getElementById('bookStats');
        const textPreview = document.getElementById('textPreview');

        if (titleEl) titleEl.textContent = this.bookData.title;
        if (authorEl) authorEl.textContent = this.bookData.author ? `by ${this.bookData.author}` : '';

        const wordCount = this.bookData.text.split(/\s+/).filter(w => w.length > 0).length;
        const charCount = this.bookData.text.length;
        const chunkCount = Math.ceil(charCount / TTS_CHUNK_SIZE);

        if (statsEl) {
            statsEl.textContent = `${this.formatNumber(wordCount)} words | ${this.formatCharCount(charCount)} | ${chunkCount} chunks`;
        }

        if (textPreview) {
            textPreview.textContent = this.bookData.text;
        }

        if (this.bookData.chapters.length > 0) {
            const chapterNav = document.getElementById('chapterNav');
            const chapterList = document.getElementById('chapterList');
            if (chapterNav) chapterNav.style.display = 'block';
            if (chapterList) {
                chapterList.innerHTML = this.bookData.chapters
                    .map((ch, i) => `<div class="chapter-item">${i + 1}. ${this.escapeHtml(ch)}</div>`)
                    .join('');
            }
        }

        this.updateConvertButton();
    }

    updateConvertButton() {
        const convertBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('convertBtn'));
        if (convertBtn) {
            convertBtn.disabled = !this.bookData || !this.apiKey;
        }
    }

    clearBook() {
        this.bookData = null;
        this.audioChunks = [];
        this.fullAudioBlob = null;
        this.playbackHistory = [];
        this.savedPosition = 0;

        const bookInfo = document.getElementById('bookInfo');
        const textPreviewSection = document.getElementById('textPreviewSection');
        const chapterNav = document.getElementById('chapterNav');
        const audioSection = document.getElementById('audioSection');
        const conversionProgress = document.getElementById('conversionProgress');
        const playbackHistorySection = document.getElementById('playbackHistorySection');

        if (bookInfo) bookInfo.style.display = 'none';
        if (textPreviewSection) textPreviewSection.style.display = 'none';
        if (chapterNav) chapterNav.style.display = 'none';
        if (audioSection) audioSection.style.display = 'none';
        if (conversionProgress) conversionProgress.style.display = 'none';
        if (playbackHistorySection) playbackHistorySection.style.display = 'none';

        const textPreview = document.getElementById('textPreview');
        if (textPreview) textPreview.textContent = '';

        const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (audioPlayer) audioPlayer.src = '';

        this.updateStatus('Upload an ebook to get started');
        this.log('info', 'Book cleared');
    }

    async convertToAudio() {
        if (!this.bookData || !this.apiKey) {
            this.updateStatus('Missing book data or API key');
            return;
        }

        if (this.isConverting) {
            return;
        }

        this.isConverting = true;
        this.abortController = new AbortController();
        this.audioChunks = [];
        this.totalDuration = 0;

        const conversionProgress = document.getElementById('conversionProgress');
        const audioSection = document.getElementById('audioSection');
        if (conversionProgress) conversionProgress.style.display = 'block';
        if (audioSection) audioSection.style.display = 'block';

        const chunks = this.splitTextIntoChunks(this.bookData.text);
        this.log('info', `Starting conversion: ${chunks.length} chunks`);

        try {
            for (let i = 0; i < chunks.length; i++) {
                if (this.abortController.signal.aborted) {
                    throw new Error('Conversion cancelled');
                }

                this.updateConversionProgress(i + 1, chunks.length, 'Converting...');

                const audioData = await this.textToSpeech(chunks[i]);

                // Create blob and get duration
                const blob = new Blob([audioData], { type: 'audio/mpeg' });
                const duration = await this.getAudioDuration(blob);

                const audioChunk = {
                    index: i,
                    blob,
                    duration,
                    startTime: this.totalDuration
                };

                this.audioChunks.push(audioChunk);
                this.totalDuration += duration;

                this.log('info', `Chunk ${i + 1}/${chunks.length} completed (${this.formatTime(duration)})`);

                // Update playable audio progressively
                await this.updateProgressiveAudio();
            }

            // Combine all chunks for download
            this.updateConversionProgress(chunks.length, chunks.length, 'Finalizing...');
            this.fullAudioBlob = await this.combineAudioChunks(this.audioChunks.map(c => c.blob));

            this.updateStatus('Conversion complete!');
            this.log('info', `Conversion complete - ${this.formatFileSize(this.fullAudioBlob.size)} - ${this.formatTime(this.totalDuration)}`);

            // Restore saved position if available
            if (this.savedPosition > 0) {
                const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
                if (audioPlayer) {
                    audioPlayer.currentTime = Math.min(this.savedPosition, audioPlayer.duration || 0);
                    this.log('info', `Restored position: ${this.formatTime(this.savedPosition)}`);
                }
            }

            if (conversionProgress) conversionProgress.style.display = 'none';

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Conversion failed: ${message}`);
            this.updateStatus('Conversion failed');

            if (conversionProgress) conversionProgress.style.display = 'none';
        } finally {
            this.isConverting = false;
            this.abortController = null;
        }
    }

    async updateProgressiveAudio() {
        if (this.audioChunks.length === 0) return;

        // Combine completed chunks
        const combinedBlob = await this.combineAudioChunks(this.audioChunks.map(c => c.blob));

        const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (audioPlayer) {
            const currentTime = audioPlayer.currentTime;
            const wasPlaying = !audioPlayer.paused;

            const newUrl = URL.createObjectURL(combinedBlob);
            audioPlayer.src = newUrl;

            // Restore position and playing state
            audioPlayer.currentTime = currentTime;
            if (wasPlaying) {
                audioPlayer.play().catch(() => {});
            }
        }
    }

    /** @param {Blob} blob */
    async getAudioDuration(blob) {
        return new Promise((resolve) => {
            const audio = new Audio();
            audio.addEventListener('loadedmetadata', () => {
                resolve(audio.duration || 0);
            });
            audio.addEventListener('error', () => {
                resolve(0);
            });
            audio.src = URL.createObjectURL(blob);
        });
    }

    cancelConversion() {
        if (this.abortController) {
            this.abortController.abort();
            this.log('info', 'Conversion cancelled');
            this.updateStatus('Conversion cancelled');
        }
    }

    /** @param {string} text */
    splitTextIntoChunks(text) {
        /** @type {string[]} */
        const chunks = [];
        const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];

        let currentChunk = '';

        for (const sentence of sentences) {
            if ((currentChunk + sentence).length > TTS_CHUNK_SIZE) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                }
                if (sentence.length > TTS_CHUNK_SIZE) {
                    const words = sentence.split(/\s+/);
                    let wordChunk = '';
                    for (const word of words) {
                        if ((wordChunk + ' ' + word).length > TTS_CHUNK_SIZE) {
                            chunks.push(wordChunk.trim());
                            wordChunk = word;
                        } else {
                            wordChunk += ' ' + word;
                        }
                    }
                    currentChunk = wordChunk;
                } else {
                    currentChunk = sentence;
                }
            } else {
                currentChunk += sentence;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }

    /** @param {string} text */
    async textToSpeech(text) {
        if (!this.apiKey) {
            throw new Error('API key not configured');
        }

        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.settings.model,
                input: text,
                voice: this.settings.voice,
                speed: this.settings.speed,
                response_format: 'mp3'
            }),
            signal: this.abortController?.signal
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `API error: ${response.status}`);
        }

        return response.arrayBuffer();
    }

    /** @param {Blob[]} blobs */
    async combineAudioChunks(blobs) {
        const arrays = await Promise.all(blobs.map(b => b.arrayBuffer()));
        const totalLength = arrays.reduce((acc, arr) => acc + arr.byteLength, 0);
        const combined = new Uint8Array(totalLength);

        let offset = 0;
        for (const arr of arrays) {
            combined.set(new Uint8Array(arr), offset);
            offset += arr.byteLength;
        }

        return new Blob([combined], { type: 'audio/mpeg' });
    }

    /**
     * @param {number} current
     * @param {number} total
     * @param {string} status
     */
    updateConversionProgress(current, total, status) {
        const statusEl = document.getElementById('conversionStatus');
        const progressFill = document.getElementById('conversionProgressFill');
        const chunksEl = document.getElementById('progressChunks');
        const timeEl = document.getElementById('progressTime');

        if (statusEl) statusEl.textContent = status;
        if (progressFill) progressFill.style.width = `${(current / total) * 100}%`;
        if (chunksEl) chunksEl.textContent = `${current} / ${total} chunks`;

        const remaining = (total - current) * 3;
        if (timeEl) {
            if (remaining > 0) {
                timeEl.textContent = `Estimated: ${this.formatDuration(remaining)}`;
            } else {
                timeEl.textContent = 'Almost done...';
            }
        }
    }

    downloadAudio() {
        if (!this.fullAudioBlob || !this.bookData) {
            return;
        }

        const filename = `${this.bookData.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;
        const url = URL.createObjectURL(this.fullAudioBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.log('info', `Downloaded: ${filename}`);
    }

    selectAllText() {
        const textPreview = document.getElementById('textPreview');
        if (textPreview) {
            const range = document.createRange();
            range.selectNodeContents(textPreview);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }
    }

    copyText() {
        const textPreview = document.getElementById('textPreview');
        if (textPreview) {
            navigator.clipboard.writeText(textPreview.textContent || '').then(() => {
                this.updateStatus('Text copied to clipboard');
            }).catch(() => {
                this.selectAllText();
                document.execCommand('copy');
                this.updateStatus('Text copied to clipboard');
            });
        }
    }

    /**
     * @param {'info' | 'warn' | 'error'} type
     * @param {string} message
     */
    log(type, message) {
        const logContent = document.getElementById('logContent');
        if (!logContent) return;

        const timestamp = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const line = document.createElement('div');
        line.className = `log-line log-${type === 'warn' ? 'user' : type === 'error' ? 'error' : 'claude'}`;
        line.textContent = `[${timestamp}] ${message}`;

        logContent.appendChild(line);
        logContent.scrollTop = logContent.scrollHeight;
    }

    clearLog() {
        const logContent = document.getElementById('logContent');
        if (logContent) logContent.innerHTML = '';
    }

    /** @param {string} message */
    updateStatus(message) {
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = message;
    }

    /** @param {number} bytes */
    formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /** @param {number} chars */
    formatCharCount(chars) {
        if (chars < 1000) return `${chars} chars`;
        return `${(chars / 1000).toFixed(1)}K chars`;
    }

    /** @param {number} num */
    formatNumber(num) {
        return num.toLocaleString();
    }

    /** @param {number} seconds */
    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /** @param {number} seconds */
    formatDuration(seconds) {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}m ${secs}s`;
    }

    /** @param {string} text */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    new EbookController();
});
