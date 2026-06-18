// @ts-check
// Ebook to Audiobook Converter using OpenAI TTS

// Configure PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// OpenAI TTS limits: 4096 characters per request
const TTS_CHUNK_SIZE = 4000;
const EBOOK_DB_NAME = 'voice-wei-books';
const EBOOK_DB_VERSION = 1;
const EBOOK_STORE_NAME = 'books';

// Voice descriptions for UI
const VOICE_DESCRIPTIONS = {
    alloy: 'Neutral and balanced, good for most content.',
    echo: 'Male voice, clear and articulate. Good for non-fiction.',
    fable: 'British accent, warm and expressive. Great for fiction.',
    onyx: 'Deep male voice, authoritative. Good for dramatic content.',
    nova: 'Female voice, warm and conversational. Good for stories.',
    shimmer: 'Soft female voice, gentle and calm. Good for relaxing content.'
};

// Sample text for voice preview
const VOICE_PREVIEW_TEXT = 'Welcome to your audiobook. This is a preview of how the narration will sound.';

/**
 * @typedef {Object} ImageAsset
 * @property {string} id - Unique identifier
 * @property {string} src - Object URL for the image blob
 * @property {string} alt - Alt text or caption
 * @property {string} filename - Original filename
 * @property {string} mimeType - Image MIME type
 * @property {number} afterChunk - Text chunk index this image appears after (-1 if unknown)
 */

/**
 * @typedef {Object} BookData
 * @property {string} title
 * @property {string} author
 * @property {string} text
 * @property {string[]} chapters
 * @property {string} format
 * @property {ImageAsset[]} images - Extracted images from the book
 */

/**
 * @typedef {Object} StoredBookRecord
 * @property {string} id
 * @property {string} title
 * @property {string} author
 * @property {string} format
 * @property {string} fileName
 * @property {string} fileType
 * @property {number} fileSize
 * @property {number} textLength
 * @property {number} wordCount
 * @property {number} chunkCount
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {Blob} rawFile
 * @property {Blob | null} audioBlob
 * @property {number} audioSize
 * @property {string} convertedAt
 * @property {Settings | null} audioSettings
 */

/**
 * @typedef {Object} Settings
 * @property {string} voice
 * @property {string} model
 * @property {number} speed
 */

class EbookStorage {
    constructor() {
        /** @type {IDBDatabase | null} */
        this.db = null;
    }

    async open() {
        if (this.db) return;

        await new Promise((resolve, reject) => {
            const request = indexedDB.open(EBOOK_DB_NAME, EBOOK_DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(EBOOK_STORE_NAME)) {
                    const store = db.createObjectStore(EBOOK_STORE_NAME, { keyPath: 'id' });
                    store.createIndex('updatedAt', 'updatedAt');
                    store.createIndex('title', 'title');
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(undefined);
            };

            request.onerror = () => reject(request.error || new Error('Could not open ebook storage'));
        });
    }

    /** @param {'readonly' | 'readwrite'} mode */
    store(mode) {
        if (!this.db) {
            throw new Error('Ebook storage is not open');
        }
        return this.db.transaction(EBOOK_STORE_NAME, mode).objectStore(EBOOK_STORE_NAME);
    }

    /** @param {StoredBookRecord} record */
    async put(record) {
        await new Promise((resolve, reject) => {
            const request = this.store('readwrite').put(record);
            request.onsuccess = () => resolve(undefined);
            request.onerror = () => reject(request.error || new Error('Could not save book'));
        });
    }

    /** @param {string} id */
    async get(id) {
        return /** @type {Promise<StoredBookRecord | null>} */ (new Promise((resolve, reject) => {
            const request = this.store('readonly').get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('Could not load book'));
        }));
    }

    async getAll() {
        const records = await /** @type {Promise<StoredBookRecord[]>} */ (new Promise((resolve, reject) => {
            const request = this.store('readonly').getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error || new Error('Could not list saved books'));
        }));

        records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return records;
    }

    /** @param {string} id */
    async delete(id) {
        await new Promise((resolve, reject) => {
            const request = this.store('readwrite').delete(id);
            request.onsuccess = () => resolve(undefined);
            request.onerror = () => reject(request.error || new Error('Could not delete saved book'));
        });
    }
}

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
        /** @type {EbookStorage | null} */
        this.storage = null;
        /** @type {StoredBookRecord[]} */
        this.savedBooks = [];
        /** @type {string | null} */
        this.currentBookStorageId = null;
        /** @type {File | null} */
        this.currentRawFile = null;
        /** @type {Blob | null} */
        this.audioBlob = null;
        /** @type {string | null} */
        this.audioObjectUrl = null;
        /** @type {boolean} */
        this.isConverting = false;
        /** @type {AbortController | null} */
        this.abortController = null;

        this.init();
    }

    async init() {
        this.loadApiKey();
        this.loadSettings();
        this.setupUI();
        this.setupDragAndDrop();
        await this.setupStorage();
    }

    async setupStorage() {
        if (!('indexedDB' in window)) {
            this.log('warn', 'Browser storage unavailable: IndexedDB is required for saved books');
            this.updateStorageEstimate();
            return;
        }

        this.storage = new EbookStorage();
        try {
            await this.storage.open();
            await this.refreshSavedBooks();
            await this.updateStorageEstimate();
            this.log('info', 'Saved books storage ready');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.storage = null;
            this.log('error', `Saved books storage unavailable: ${message}`);
            this.updateStorageEstimate();
        }
    }

    // API Key Management
    loadApiKey() {
        const storedKey = localStorage.getItem('openaiApiKey');
        if (storedKey && storedKey.length > 10) {
            this.apiKey = storedKey;
            this.log('info', 'OpenAI API Key loaded');
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

        this.log('info', 'API Key saved');
        this.updateStatus('API key saved');
        this.hideApiKeyOverlay();
        this.updateApiKeyUI(true);

        // Clear inputs
        const settingsInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyInput'));
        const overlayInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyOverlayInput'));
        if (settingsInput) settingsInput.value = '';
        if (overlayInput) overlayInput.value = '';

        // Enable convert button if book is loaded
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

        // Update UI
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

    updateVoiceDescription() {
        const descEl = document.getElementById('voiceDescription');
        if (descEl) {
            descEl.textContent = VOICE_DESCRIPTIONS[this.settings.voice] || '';
        }
    }

    /** @type {HTMLAudioElement | null} */
    previewAudio = null;

    async previewVoice() {
        if (!this.apiKey) {
            this.updateStatus('API key required for voice preview');
            return;
        }

        const previewBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('previewVoiceBtn'));
        if (!previewBtn) return;

        // If already playing, stop
        if (this.previewAudio && !this.previewAudio.paused) {
            this.previewAudio.pause();
            this.previewAudio = null;
            previewBtn.classList.remove('playing');
            previewBtn.innerHTML = '&#9654;';
            return;
        }

        previewBtn.disabled = true;
        previewBtn.innerHTML = '...';
        this.log('info', `Previewing voice: ${this.settings.voice}`);

        try {
            const response = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    input: VOICE_PREVIEW_TEXT,
                    voice: this.settings.voice,
                    speed: this.settings.speed,
                    response_format: 'mp3'
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API error: ${response.status}`);
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            this.previewAudio = new Audio(audioUrl);
            this.previewAudio.addEventListener('ended', () => {
                previewBtn.classList.remove('playing');
                previewBtn.innerHTML = '&#9654;';
                URL.revokeObjectURL(audioUrl);
            });

            previewBtn.classList.add('playing');
            previewBtn.innerHTML = '&#9632;';
            previewBtn.disabled = false;
            await this.previewAudio.play();

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Voice preview failed: ${message}`);
            this.updateStatus('Preview failed');
            previewBtn.innerHTML = '&#9654;';
            previewBtn.disabled = false;
        }
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

        // API key management
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
                this.updateVoiceDescription();
            });
            // Set initial description
            this.updateVoiceDescription();
        }

        // Voice preview button
        const previewBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('previewVoiceBtn'));
        if (previewBtn) {
            previewBtn.addEventListener('click', () => this.previewVoice());
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

        // Saved library actions
        const savedBookList = document.getElementById('savedBookList');
        if (savedBookList) {
            savedBookList.addEventListener('click', (e) => this.handleSavedBookAction(e));
        }

        const persistentStorageBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('requestPersistentStorageBtn'));
        if (persistentStorageBtn) {
            persistentStorageBtn.addEventListener('click', () => this.requestPersistentStorage());
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

        // Image overlay handlers
        const closeOverlay = document.getElementById('closeImageOverlay');
        const prevImage = document.getElementById('prevImage');
        const nextImage = document.getElementById('nextImage');
        const imageOverlay = document.getElementById('imageOverlay');

        if (closeOverlay) {
            closeOverlay.addEventListener('click', () => this.closeImageFullscreen());
        }
        if (prevImage) {
            prevImage.addEventListener('click', () => this.navigateImage(-1));
        }
        if (nextImage) {
            nextImage.addEventListener('click', () => this.navigateImage(1));
        }
        if (imageOverlay) {
            imageOverlay.addEventListener('click', (e) => {
                if (e.target === imageOverlay) {
                    this.closeImageFullscreen();
                }
            });
            // Keyboard navigation
            document.addEventListener('keydown', (e) => {
                if (imageOverlay.style.display === 'none') return;
                if (e.key === 'Escape') this.closeImageFullscreen();
                if (e.key === 'ArrowLeft') this.navigateImage(-1);
                if (e.key === 'ArrowRight') this.navigateImage(1);
            });
        }
    }

    setupApiKeyUI() {
        // Settings panel API key handlers
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

        // Overlay API key handlers
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

    /** @param {Event} event */
    async handleSavedBookAction(event) {
        const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);
        const button = /** @type {HTMLButtonElement | null} */ (target?.closest('button[data-action]') || null);
        if (!button) return;

        const id = button.getAttribute('data-id');
        const action = button.getAttribute('data-action');
        if (!id || !action) return;

        try {
            if (action === 'load') {
                await this.loadStoredBook(id);
            } else if (action === 'download-raw') {
                await this.downloadStoredRaw(id);
            } else if (action === 'download-audio') {
                await this.downloadStoredAudio(id);
            } else if (action === 'delete') {
                await this.deleteStoredBook(id);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Saved book action failed: ${message}`);
        }
    }

    async requestPersistentStorage() {
        if (!navigator.storage?.persist) {
            this.log('warn', 'Persistent storage requests are not supported in this browser');
            return;
        }

        const persisted = await navigator.storage.persist();
        this.log(persisted ? 'info' : 'warn', persisted ? 'Browser granted persistent storage' : 'Browser did not grant persistent storage');
        await this.updateStorageEstimate();
    }

    async refreshSavedBooks() {
        const listEl = document.getElementById('savedBookList');
        if (!listEl) return;

        if (!this.storage) {
            listEl.innerHTML = '<div class="library-empty">Saved books are unavailable in this browser.</div>';
            return;
        }

        this.savedBooks = await this.storage.getAll();

        if (this.savedBooks.length === 0) {
            listEl.innerHTML = '<div class="library-empty">No saved books yet.</div>';
            return;
        }

        listEl.innerHTML = this.savedBooks.map(record => {
            const audioMeta = record.audioBlob
                ? `MP3 ${this.formatFileSize(record.audioSize)}`
                : 'No MP3 yet';
            const convertedMeta = record.convertedAt
                ? `Converted ${this.formatDateTime(record.convertedAt)}`
                : 'Not converted';
            const canDownloadAudio = record.audioBlob
                ? `<button class="saved-book-action" type="button" data-action="download-audio" data-id="${this.escapeHtml(record.id)}">Download MP3</button>`
                : '';

            return `
                <div class="saved-book-item">
                    <div class="saved-book-summary">
                        <div class="saved-book-title">${this.escapeHtml(record.title)}</div>
                        <div class="saved-book-meta">
                            <span>${this.escapeHtml(record.format.toUpperCase())}</span>
                            <span>Original ${this.formatFileSize(record.fileSize)}</span>
                            <span>${this.formatNumber(record.wordCount)} words</span>
                            <span>${audioMeta}</span>
                            <span>${convertedMeta}</span>
                        </div>
                    </div>
                    <div class="saved-book-actions">
                        <button class="saved-book-action" type="button" data-action="load" data-id="${this.escapeHtml(record.id)}">Load</button>
                        <button class="saved-book-action" type="button" data-action="download-raw" data-id="${this.escapeHtml(record.id)}">Download original</button>
                        ${canDownloadAudio}
                        <button class="saved-book-action danger" type="button" data-action="delete" data-id="${this.escapeHtml(record.id)}">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async updateStorageEstimate() {
        const estimateEl = document.getElementById('storageEstimate');
        const persistBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('requestPersistentStorageBtn'));
        if (!estimateEl) return;

        if (!navigator.storage?.estimate) {
            estimateEl.textContent = 'Storage quota unavailable';
            if (persistBtn) persistBtn.disabled = true;
            return;
        }

        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const quotaText = quota > 0 ? ` / ${this.formatFileSize(quota)}` : '';
        estimateEl.textContent = `Storage used: ${this.formatFileSize(usage)}${quotaText}`;

        if (persistBtn && navigator.storage?.persisted) {
            const persisted = await navigator.storage.persisted();
            persistBtn.disabled = persisted;
            persistBtn.textContent = persisted ? 'Persistent' : 'Keep storage';
        }
    }

    /** @param {File} file */
    async saveCurrentBookToLibrary(file) {
        if (!this.storage || !this.bookData) return;

        const record = this.buildStoredBookRecord(file);
        try {
            await this.storage.put(record);
            this.currentBookStorageId = record.id;
            this.log('info', `Saved original upload in browser storage (${this.formatFileSize(file.size)})`);
            await this.refreshSavedBooks();
            await this.updateStorageEstimate();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Could not save original upload: ${message}`);
        }
    }

    /** @param {File} file */
    buildStoredBookRecord(file) {
        if (!this.bookData) {
            throw new Error('No book loaded');
        }

        const now = new Date().toISOString();
        const wordCount = this.countWords(this.bookData.text);
        return {
            id: `book-${Date.now()}-${Math.round(Math.random() * 1000000000)}`,
            title: this.bookData.title,
            author: this.bookData.author,
            format: this.bookData.format,
            fileName: file.name,
            fileType: file.type || 'application/octet-stream',
            fileSize: file.size,
            textLength: this.bookData.text.length,
            wordCount,
            chunkCount: Math.ceil(this.bookData.text.length / TTS_CHUNK_SIZE),
            createdAt: now,
            updatedAt: now,
            rawFile: file,
            audioBlob: null,
            audioSize: 0,
            convertedAt: '',
            audioSettings: null
        };
    }

    async saveCurrentAudioToLibrary() {
        if (!this.storage || !this.currentBookStorageId || !this.audioBlob) return;

        try {
            const record = await this.storage.get(this.currentBookStorageId);
            if (!record) return;

            record.audioBlob = this.audioBlob;
            record.audioSize = this.audioBlob.size;
            record.convertedAt = new Date().toISOString();
            record.updatedAt = record.convertedAt;
            record.audioSettings = { ...this.settings };

            await this.storage.put(record);
            this.log('info', `Saved MP3 in browser storage (${this.formatFileSize(this.audioBlob.size)})`);
            await this.refreshSavedBooks();
            await this.updateStorageEstimate();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Could not save MP3 in browser storage: ${message}`);
        }
    }

    /** @param {string} id */
    async loadStoredBook(id) {
        if (!this.storage) return;

        const record = await this.storage.get(id);
        if (!record) {
            throw new Error('Saved book not found');
        }

        const file = new File([record.rawFile], record.fileName, {
            type: record.fileType,
            lastModified: Date.parse(record.updatedAt)
        });
        await this.loadBookFromFile(file, false, record);
        this.log('info', `Loaded saved book: ${record.title}`);
    }

    /** @param {string} id */
    async downloadStoredRaw(id) {
        if (!this.storage) return;

        const record = await this.storage.get(id);
        if (!record) {
            throw new Error('Saved book not found');
        }

        this.downloadBlob(record.rawFile, record.fileName);
        this.log('info', `Downloaded original: ${record.fileName}`);
    }

    /** @param {string} id */
    async downloadStoredAudio(id) {
        if (!this.storage) return;

        const record = await this.storage.get(id);
        if (!record || !record.audioBlob) {
            throw new Error('Saved MP3 not found');
        }

        const filename = `${record.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;
        this.downloadBlob(record.audioBlob, filename);
        this.log('info', `Downloaded saved MP3: ${filename}`);
    }

    /** @param {string} id */
    async deleteStoredBook(id) {
        if (!this.storage) return;

        await this.storage.delete(id);
        if (this.currentBookStorageId === id) {
            this.currentBookStorageId = null;
        }
        this.log('info', 'Deleted saved book from browser storage');
        await this.refreshSavedBooks();
        await this.updateStorageEstimate();
    }

    /** @param {File} file */
    async handleFile(file) {
        await this.loadBookFromFile(file, true, null);
    }

    /**
     * @param {File} file
     * @param {boolean} saveToLibrary
     * @param {StoredBookRecord | null} storedRecord
     */
    async loadBookFromFile(file, saveToLibrary, storedRecord) {
        const extension = file.name.split('.').pop()?.toLowerCase();
        this.log('info', `Processing file: ${file.name} (${this.formatFileSize(file.size)})`);
        this.updateStatus('Processing file...');

        try {
            this.releaseBookResources();
            this.bookData = await this.parseBookFile(file);
            this.currentRawFile = file;
            this.currentBookStorageId = storedRecord?.id || null;
            this.audioBlob = storedRecord?.audioBlob || null;

            this.displayBook();
            this.showAudioBlob(this.audioBlob);
            this.updateStatus('Book loaded successfully');

            if (saveToLibrary) {
                await this.saveCurrentBookToLibrary(file);
            }

            const imageInfo = this.bookData.images.length > 0 ? `, ${this.bookData.images.length} images` : '';
            this.log('info', `Loaded "${this.bookData.title}" - ${this.formatCharCount(this.bookData.text.length)}${imageInfo}`);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Failed to process file: ${message}`);
            this.updateStatus('Error processing file');
        }
    }

    /** @param {File} file */
    async parseBookFile(file) {
        const extension = file.name.split('.').pop()?.toLowerCase();
        let text = '';
        let title = file.name.replace(/\.[^.]+$/, '');
        let author = '';
        /** @type {string[]} */
        let chapters = [];
        /** @type {ImageAsset[]} */
        let images = [];

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
                images = epubData.images || [];
                break;
            case 'pdf':
                const pdfData = await this.parsePdf(file);
                text = pdfData.text;
                images = pdfData.images || [];
                break;
            case 'html':
            case 'htm':
                text = await this.parseHtml(file);
                break;
            default:
                throw new Error(`Unsupported file format: ${extension}`);
        }

        if (!text || text.trim().length === 0) {
            throw new Error('No text content found in file');
        }

        text = this.cleanText(text);

        return {
            title,
            author,
            text,
            chapters,
            format: extension || 'unknown',
            images
        };
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

        // Find container.xml to locate the content
        const containerXml = await zip.file('META-INF/container.xml')?.async('text');
        if (!containerXml) {
            throw new Error('Invalid EPUB: missing container.xml');
        }

        // Parse container to find content.opf path
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'text/xml');
        const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');

        if (!rootfilePath) {
            throw new Error('Invalid EPUB: cannot find content.opf');
        }

        // Parse content.opf for metadata and spine
        const opfContent = await zip.file(rootfilePath)?.async('text');
        if (!opfContent) {
            throw new Error('Invalid EPUB: cannot read content.opf');
        }

        const opfDoc = parser.parseFromString(opfContent, 'text/xml');

        // Extract metadata
        const title = opfDoc.querySelector('metadata title, dc\\:title')?.textContent || '';
        const author = opfDoc.querySelector('metadata creator, dc\\:creator')?.textContent || '';

        // Get base path for relative references
        const basePath = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);

        // Get spine items (reading order)
        const spineItems = opfDoc.querySelectorAll('spine itemref');
        const manifest = opfDoc.querySelectorAll('manifest item');

        // Build href map and media-type map from manifest
        /** @type {Map<string, string>} */
        const hrefMap = new Map();
        /** @type {Map<string, string>} */
        const mediaTypeMap = new Map();
        manifest.forEach(item => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            const mediaType = item.getAttribute('media-type');
            if (id && href) {
                hrefMap.set(id, href);
                if (mediaType) {
                    mediaTypeMap.set(href, mediaType);
                }
            }
        });

        // Extract text and track image references from each spine item
        let fullText = '';
        /** @type {string[]} */
        const chapters = [];
        /** @type {ImageAsset[]} */
        const images = [];
        /** @type {Set<string>} */
        const processedImages = new Set();
        let textChunkIndex = 0;

        for (const itemref of spineItems) {
            const idref = itemref.getAttribute('idref');
            if (!idref) continue;

            const href = hrefMap.get(idref);
            if (!href) continue;

            const filePath = basePath + href;
            const fileDir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
            const content = await zip.file(filePath)?.async('text');

            if (content) {
                const doc = parser.parseFromString(content, 'text/html');
                const bodyText = doc.body?.textContent || '';

                // Try to extract chapter title
                const h1 = doc.querySelector('h1, h2');
                if (h1?.textContent) {
                    chapters.push(h1.textContent.trim());
                }

                // Extract images from this content
                const imgElements = doc.querySelectorAll('img, image');
                for (const img of imgElements) {
                    const imgSrc = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
                    if (!imgSrc) continue;

                    // Resolve relative path
                    const imgPath = imgSrc.startsWith('/') ? imgSrc.substring(1) : fileDir + imgSrc;
                    const normalizedPath = this.normalizePath(imgPath);
                    
                    if (processedImages.has(normalizedPath)) continue;
                    processedImages.add(normalizedPath);

                    try {
                        const imgFile = zip.file(normalizedPath);
                        if (imgFile) {
                            const imgData = await imgFile.async('blob');
                            const mimeType = mediaTypeMap.get(imgSrc) || this.getMimeTypeFromFilename(normalizedPath);
                            const imgBlob = new Blob([imgData], { type: mimeType });
                            const imgUrl = URL.createObjectURL(imgBlob);

                            images.push({
                                id: `img-${images.length}`,
                                src: imgUrl,
                                alt: img.getAttribute('alt') || '',
                                filename: normalizedPath.split('/').pop() || 'image',
                                mimeType,
                                afterChunk: textChunkIndex
                            });
                        }
                    } catch (e) {
                        // Skip images that can't be loaded
                        this.log('warn', `Could not load image: ${normalizedPath}`);
                    }
                }

                fullText += bodyText + '\n\n';
                textChunkIndex++;
            }
        }

        return { text: fullText, title, author, chapters, images };
    }

    /**
     * Normalize a file path (resolve ../ and ./)
     * @param {string} path
     * @returns {string}
     */
    normalizePath(path) {
        const parts = path.split('/').filter(p => p && p !== '.');
        const result = [];
        for (const part of parts) {
            if (part === '..') {
                result.pop();
            } else {
                result.push(part);
            }
        }
        return result.join('/');
    }

    /**
     * Get MIME type from filename
     * @param {string} filename
     * @returns {string}
     */
    getMimeTypeFromFilename(filename) {
        const ext = filename.split('.').pop()?.toLowerCase();
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp'
        };
        return mimeTypes[ext || ''] || 'image/jpeg';
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
        /** @type {ImageAsset[]} */
        const images = [];

        this.log('info', `PDF has ${numPages} pages`);

        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((/** @type {any} */ item) => item.str)
                .join(' ');
            fullText += pageText + '\n\n';

            // Extract images from this page (render page to canvas for now)
            // Note: Full PDF image extraction requires more complex operator parsing
            // For now, we'll extract page renders for pages with little text
            if (pageText.trim().length < 100) {
                try {
                    const viewport = page.getViewport({ scale: 1.5 });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    if (context) {
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        await page.render({ canvasContext: context, viewport }).promise;
                        
                        const blob = await new Promise((resolve) => {
                            canvas.toBlob(resolve, 'image/png');
                        });
                        
                        if (blob) {
                            images.push({
                                id: `pdf-page-${i}`,
                                src: URL.createObjectURL(blob),
                                alt: `Page ${i}`,
                                filename: `page-${i}.png`,
                                mimeType: 'image/png',
                                afterChunk: i - 1
                            });
                        }
                    }
                } catch (e) {
                    // Skip pages that can't be rendered
                }
            }

            // Update progress for large PDFs
            if (numPages > 10 && i % 10 === 0) {
                this.updateStatus(`Reading PDF... ${Math.round(i / numPages * 100)}%`);
            }
        }

        return { text: fullText, images };
    }

    /** @param {File} file */
    async parseHtml(file) {
        const html = await this.readTextFile(file);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove script and style elements
        doc.querySelectorAll('script, style, nav, header, footer').forEach(el => el.remove());

        return doc.body?.textContent || '';
    }

    /** @param {string} text */
    cleanText(text) {
        return text
            // Normalize whitespace
            .replace(/[\t\f\v]+/g, ' ')
            // Replace multiple newlines with double newline
            .replace(/\n{3,}/g, '\n\n')
            // Remove excessive spaces
            .replace(/ {2,}/g, ' ')
            // Trim lines
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .trim();
    }

    displayBook() {
        if (!this.bookData) return;

        // Show book info section
        const bookInfo = document.getElementById('bookInfo');
        const textPreviewSection = document.getElementById('textPreviewSection');
        if (bookInfo) bookInfo.style.display = 'block';
        if (textPreviewSection) textPreviewSection.style.display = 'block';

        // Update book details
        const titleEl = document.getElementById('bookTitle');
        const authorEl = document.getElementById('bookAuthor');
        const statsEl = document.getElementById('bookStats');
        const textPreview = document.getElementById('textPreview');

        if (titleEl) titleEl.textContent = this.bookData.title;
        if (authorEl) authorEl.textContent = this.bookData.author ? `by ${this.bookData.author}` : '';

        const wordCount = this.countWords(this.bookData.text);
        const charCount = this.bookData.text.length;
        const chunkCount = Math.ceil(charCount / TTS_CHUNK_SIZE);

        if (statsEl) {
            statsEl.textContent = `${this.formatNumber(wordCount)} words | ${this.formatCharCount(charCount)} | ${chunkCount} chunks`;
        }

        // Display text preview
        if (textPreview) {
            textPreview.textContent = this.bookData.text;
        }

        // Show chapters if available
        const chapterNav = document.getElementById('chapterNav');
        const chapterList = document.getElementById('chapterList');
        if (this.bookData.chapters.length > 0) {
            if (chapterNav) chapterNav.style.display = 'block';
            if (chapterList) {
                chapterList.innerHTML = this.bookData.chapters
                    .map((ch, i) => `<div class="chapter-item">${i + 1}. ${this.escapeHtml(ch)}</div>`)
                    .join('');
            }
        } else {
            if (chapterNav) chapterNav.style.display = 'none';
            if (chapterList) chapterList.innerHTML = '';
        }

        // Show images if available
        this.displayImages();

        // Enable convert button
        this.updateConvertButton();
    }

    displayImages() {
        const imageGallery = document.getElementById('imageGallery');
        const imageSection = document.getElementById('imageSection');
        
        if (!imageGallery || !imageSection) return;
        
        if (!this.bookData || !this.bookData.images || this.bookData.images.length === 0) {
            imageSection.style.display = 'none';
            return;
        }

        imageSection.style.display = 'block';
        const imageCountEl = document.getElementById('imageCount');
        if (imageCountEl) {
            imageCountEl.textContent = `${this.bookData.images.length} image${this.bookData.images.length !== 1 ? 's' : ''}`;
        }

        imageGallery.innerHTML = this.bookData.images.map((img, i) => `
            <div class="gallery-item" data-index="${i}">
                <img src="${img.src}" alt="${this.escapeHtml(img.alt || img.filename)}" loading="lazy" />
                <div class="gallery-caption">${this.escapeHtml(img.alt || img.filename)}</div>
            </div>
        `).join('');

        // Add click handlers for fullscreen view
        imageGallery.querySelectorAll('.gallery-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.getAttribute('data-index') || '0');
                this.showImageFullscreen(index);
            });
        });
    }

    releaseBookResources() {
        if (this.bookData?.images) {
            for (const img of this.bookData.images) {
                URL.revokeObjectURL(img.src);
            }
        }

        if (this.audioObjectUrl) {
            URL.revokeObjectURL(this.audioObjectUrl);
            this.audioObjectUrl = null;
        }
    }

    /** @param {Blob | null} blob */
    showAudioBlob(blob) {
        const audioSection = document.getElementById('audioSection');
        const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));

        if (!blob) {
            if (audioSection) audioSection.style.display = 'none';
            if (audioPlayer) audioPlayer.src = '';
            return;
        }

        if (this.audioObjectUrl) {
            URL.revokeObjectURL(this.audioObjectUrl);
        }

        this.audioObjectUrl = URL.createObjectURL(blob);
        if (audioSection) audioSection.style.display = 'block';
        if (audioPlayer) audioPlayer.src = this.audioObjectUrl;
    }

    /** @param {number} index */
    showImageFullscreen(index) {
        if (!this.bookData?.images?.[index]) return;
        
        const img = this.bookData.images[index];
        const overlay = document.getElementById('imageOverlay');
        const fullImg = document.getElementById('fullscreenImage');
        const caption = document.getElementById('fullscreenCaption');
        
        if (overlay && fullImg && caption) {
            fullImg.setAttribute('src', img.src);
            caption.textContent = img.alt || img.filename;
            overlay.style.display = 'flex';
            
            // Store current index for navigation
            overlay.setAttribute('data-current', String(index));
        }
    }

    closeImageFullscreen() {
        const overlay = document.getElementById('imageOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    navigateImage(direction) {
        const overlay = document.getElementById('imageOverlay');
        if (!overlay || !this.bookData?.images) return;
        
        const current = parseInt(overlay.getAttribute('data-current') || '0');
        const newIndex = current + direction;
        
        if (newIndex >= 0 && newIndex < this.bookData.images.length) {
            this.showImageFullscreen(newIndex);
        }
    }

    updateConvertButton() {
        const convertBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('convertBtn'));
        if (convertBtn) {
            convertBtn.disabled = !this.bookData || !this.apiKey;
        }
    }

    clearBook() {
        this.releaseBookResources();
        this.bookData = null;
        this.currentRawFile = null;
        this.currentBookStorageId = null;
        this.audioBlob = null;

        // Hide sections
        const bookInfo = document.getElementById('bookInfo');
        const textPreviewSection = document.getElementById('textPreviewSection');
        const chapterNav = document.getElementById('chapterNav');
        const audioSection = document.getElementById('audioSection');
        const conversionProgress = document.getElementById('conversionProgress');
        const imageSection = document.getElementById('imageSection');

        if (bookInfo) bookInfo.style.display = 'none';
        if (textPreviewSection) textPreviewSection.style.display = 'none';
        if (chapterNav) chapterNav.style.display = 'none';
        if (audioSection) audioSection.style.display = 'none';
        if (imageSection) imageSection.style.display = 'none';
        if (conversionProgress) conversionProgress.style.display = 'none';

        // Clear text preview
        const textPreview = document.getElementById('textPreview');
        if (textPreview) textPreview.textContent = '';

        // Reset audio player
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

        // Show progress section
        const conversionProgress = document.getElementById('conversionProgress');
        const audioSection = document.getElementById('audioSection');
        if (conversionProgress) conversionProgress.style.display = 'block';
        if (audioSection) audioSection.style.display = 'none';

        // Split text into chunks
        const chunks = this.splitTextIntoChunks(this.bookData.text);
        this.log('info', `Starting conversion: ${chunks.length} chunks`);

        /** @type {ArrayBuffer[]} */
        const audioChunks = [];
        let completedChunks = 0;

        try {
            for (let i = 0; i < chunks.length; i++) {
                if (this.abortController.signal.aborted) {
                    throw new Error('Conversion cancelled');
                }

                this.updateConversionProgress(i + 1, chunks.length, 'Converting...');

                const audioData = await this.textToSpeech(chunks[i]);
                audioChunks.push(audioData);
                completedChunks++;

                this.log('info', `Chunk ${i + 1}/${chunks.length} completed`);
            }

            // Combine audio chunks
            this.updateConversionProgress(chunks.length, chunks.length, 'Combining audio...');
            this.audioBlob = await this.combineAudioChunks(audioChunks);

            // Show audio player
            if (conversionProgress) conversionProgress.style.display = 'none';
            this.showAudioBlob(this.audioBlob);
            await this.saveCurrentAudioToLibrary();

            this.updateStatus('Conversion complete!');
            this.log('info', `Conversion complete - ${this.formatFileSize(this.audioBlob.size)}`);

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
                // Handle sentences longer than chunk size
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

    /** @param {ArrayBuffer[]} chunks */
    async combineAudioChunks(chunks) {
        // Simple concatenation for MP3 chunks
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
        const combined = new Uint8Array(totalLength);

        let offset = 0;
        for (const chunk of chunks) {
            combined.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
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

        // Estimate remaining time (rough estimate: ~3 seconds per chunk)
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
        if (!this.audioBlob || !this.bookData) {
            return;
        }

        const filename = `${this.bookData.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;
        this.downloadBlob(this.audioBlob, filename);

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

    // Logging
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

    // Utility methods
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

    /** @param {string} isoDate */
    formatDateTime(isoDate) {
        if (!isoDate) return 'never';
        return new Date(isoDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    /** @param {number} seconds */
    formatDuration(seconds) {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}m ${secs}s`;
    }

    /** @param {string} text */
    countWords(text) {
        return text.split(/\s+/).filter(w => w.length > 0).length;
    }

    /**
     * @param {Blob} blob
     * @param {string} filename
     */
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
