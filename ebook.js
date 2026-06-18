// @ts-check
// Books: browser-local ebook library, reader, segmented MP3 generator, and player.

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const EBOOK_DB_NAME = 'voice-wei-books';
const EBOOK_DB_VERSION = 3;
const BOOK_STORE = 'books';
const SECTION_STORE = 'sections';
const SEGMENT_STORE = 'segments';
const TTS_CHUNK_SIZE = 3800;
const ESTIMATED_WORDS_PER_MINUTE = 155;
const AUTO_AHEAD_SECONDS = 60 * 60;

const VOICE_DESCRIPTIONS = {
    alloy: 'Neutral and balanced, good for most content.',
    echo: 'Male voice, clear and articulate. Good for non-fiction.',
    fable: 'British accent, warm and expressive. Great for fiction.',
    onyx: 'Deep male voice, authoritative. Good for dramatic content.',
    nova: 'Female voice, warm and conversational. Good for stories.',
    shimmer: 'Soft female voice, gentle and calm. Good for relaxing content.'
};

const VOICE_PREVIEW_TEXT = 'Welcome to your audiobook. This is a preview of how the narration will sound.';

/**
 * @typedef {Object} Settings
 * @property {string} voice
 * @property {string} model
 * @property {number} speed
 */

/**
 * @typedef {Object} BookRecord
 * @property {string} id
 * @property {number} schemaVersion
 * @property {string} title
 * @property {string} author
 * @property {string} format
 * @property {string} fileName
 * @property {string} fileType
 * @property {number} fileSize
 * @property {Blob} rawFile
 * @property {number} sectionCount
 * @property {number} segmentCount
 * @property {number} generatedSegmentCount
 * @property {number} wordCount
 * @property {number} charCount
 * @property {number} estimatedDurationSec
 * @property {number} generatedDurationSec
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} lastOpenedAt
 * @property {string} readingSectionId
 * @property {number} readingCharOffset
 * @property {string} listeningSegmentId
 * @property {number} listeningOffsetSec
 * @property {Blob | null | undefined} legacyAudioBlob
 * @property {number | undefined} legacyAudioSize
 */

/**
 * @typedef {Object} BookSection
 * @property {string} key
 * @property {string} bookId
 * @property {string} id
 * @property {number} spineIndex
 * @property {string} title
 * @property {string} text
 * @property {string} html
 * @property {number} charStart
 * @property {number} charEnd
 * @property {number} wordCount
 */

/** @typedef {'pending' | 'generating' | 'done' | 'error'} SegmentStatus */

/**
 * @typedef {Object} AudioSegment
 * @property {string} key
 * @property {string} bookId
 * @property {string} id
 * @property {string} sectionId
 * @property {number} segmentIndex
 * @property {number} sectionSegmentIndex
 * @property {number} charStart
 * @property {number} charEnd
 * @property {string} text
 * @property {number} wordCount
 * @property {number} estimatedDurationSec
 * @property {SegmentStatus} status
 * @property {Blob | null} blob
 * @property {number} audioSize
 * @property {number} durationSec
 * @property {string} generatedAt
 * @property {Settings | null} audioSettings
 * @property {string} error
 */

class BooksStorage {
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
                if (!db.objectStoreNames.contains(BOOK_STORE)) {
                    const books = db.createObjectStore(BOOK_STORE, { keyPath: 'id' });
                    books.createIndex('updatedAt', 'updatedAt');
                    books.createIndex('title', 'title');
                }
                if (!db.objectStoreNames.contains(SECTION_STORE)) {
                    const sections = db.createObjectStore(SECTION_STORE, { keyPath: 'key' });
                    sections.createIndex('bookId', 'bookId');
                    sections.createIndex('bookSpine', ['bookId', 'spineIndex']);
                }
                if (!db.objectStoreNames.contains(SEGMENT_STORE)) {
                    const segments = db.createObjectStore(SEGMENT_STORE, { keyPath: 'key' });
                    segments.createIndex('bookId', 'bookId');
                    segments.createIndex('bookSegment', ['bookId', 'segmentIndex']);
                    segments.createIndex('bookSection', ['bookId', 'sectionId']);
                    segments.createIndex('bookStatus', ['bookId', 'status']);
                }
            };
            request.onsuccess = () => {
                this.db = request.result;
                resolve(undefined);
            };
            request.onerror = () => reject(request.error || new Error('Could not open Books storage'));
        });
    }

    /** @param {string} storeName @param {'readonly' | 'readwrite'} mode */
    store(storeName, mode) {
        if (!this.db) throw new Error('Books storage is not open');
        return this.db.transaction(storeName, mode).objectStore(storeName);
    }

    /** @param {BookRecord} book */
    async putBook(book) {
        await this.put(BOOK_STORE, book);
    }

    /** @param {string} id */
    async getBook(id) {
        return /** @type {Promise<BookRecord | null>} */ (this.get(BOOK_STORE, id));
    }

    async getBooks() {
        const books = await /** @type {Promise<BookRecord[]>} */ (this.getAll(BOOK_STORE));
        books.sort((a, b) => (b.lastOpenedAt || b.updatedAt).localeCompare(a.lastOpenedAt || a.updatedAt));
        return books;
    }

    /** @param {BookSection[]} sections */
    async putSections(sections) {
        for (const section of sections) await this.put(SECTION_STORE, section);
    }

    /** @param {AudioSegment[]} segments */
    async putSegments(segments) {
        for (const segment of segments) await this.put(SEGMENT_STORE, segment);
    }

    /** @param {AudioSegment} segment */
    async putSegment(segment) {
        await this.put(SEGMENT_STORE, segment);
    }

    /** @param {string} key */
    async getSegment(key) {
        return /** @type {Promise<AudioSegment | null>} */ (this.get(SEGMENT_STORE, key));
    }

    /** @param {string} bookId */
    async getSections(bookId) {
        const sections = await /** @type {Promise<BookSection[]>} */ (this.getAllByIndex(SECTION_STORE, 'bookId', bookId));
        sections.sort((a, b) => a.spineIndex - b.spineIndex);
        return sections;
    }

    /** @param {string} bookId */
    async getSegments(bookId) {
        const segments = await /** @type {Promise<AudioSegment[]>} */ (this.getAllByIndex(SEGMENT_STORE, 'bookId', bookId));
        segments.sort((a, b) => a.segmentIndex - b.segmentIndex);
        return segments;
    }

    /** @param {string} bookId */
    async deleteBookCascade(bookId) {
        const sections = await this.getSections(bookId);
        const segments = await this.getSegments(bookId);
        for (const section of sections) await this.delete(SECTION_STORE, section.key);
        for (const segment of segments) await this.delete(SEGMENT_STORE, segment.key);
        await this.delete(BOOK_STORE, bookId);
    }

    /** @param {string} storeName @param {any} value */
    async put(storeName, value) {
        await new Promise((resolve, reject) => {
            const request = this.store(storeName, 'readwrite').put(value);
            request.onsuccess = () => resolve(undefined);
            request.onerror = () => reject(request.error || new Error(`Could not save ${storeName}`));
        });
    }

    /** @param {string} storeName @param {string} key */
    async get(storeName, key) {
        return new Promise((resolve, reject) => {
            const request = this.store(storeName, 'readonly').get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error(`Could not load ${storeName}`));
        });
    }

    /** @param {string} storeName */
    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const request = this.store(storeName, 'readonly').getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error || new Error(`Could not list ${storeName}`));
        });
    }

    /** @param {string} storeName @param {string} indexName @param {any} value */
    async getAllByIndex(storeName, indexName, value) {
        return new Promise((resolve, reject) => {
            const request = this.store(storeName, 'readonly').index(indexName).getAll(value);
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error || new Error(`Could not list ${storeName}`));
        });
    }

    /** @param {string} storeName @param {string} key */
    async delete(storeName, key) {
        await new Promise((resolve, reject) => {
            const request = this.store(storeName, 'readwrite').delete(key);
            request.onsuccess = () => resolve(undefined);
            request.onerror = () => reject(request.error || new Error(`Could not delete ${storeName}`));
        });
    }
}

class BooksController {
    constructor() {
        /** @type {BooksStorage | null} */
        this.storage = null;
        /** @type {BookRecord[]} */
        this.books = [];
        /** @type {BookRecord | null} */
        this.currentBook = null;
        /** @type {BookSection[]} */
        this.sections = [];
        /** @type {AudioSegment[]} */
        this.segments = [];
        /** @type {Settings} */
        this.settings = { voice: 'alloy', model: 'tts-1', speed: 1 };
        /** @type {string | null} */
        this.apiKey = null;
        /** @type {AbortController | null} */
        this.generationAbort = null;
        this.isGenerating = false;
        this.autoGenerateAhead = false;
        this.libraryQuery = '';
        this.readerQuery = '';
        /** @type {string | null} */
        this.currentSegmentId = null;
        /** @type {string | null} */
        this.currentAudioUrl = null;
        /** @type {HTMLAudioElement | null} */
        this.preloadAudio = null;
        /** @type {string | null} */
        this.preloadSegmentId = null;
        /** @type {string | null} */
        this.preloadUrl = null;
        this.lastProgressSavedAt = 0;
        /** @type {HTMLAudioElement | null} */
        this.previewAudio = null;
        this.init();
    }

    async init() {
        this.loadApiKey();
        this.loadSettings();
        this.setupUI();
        await this.setupStorage();
    }

    async setupStorage() {
        if (!('indexedDB' in window)) {
            this.updateStatus('IndexedDB is required for saved books.');
            this.log('error', 'IndexedDB is unavailable in this browser');
            return;
        }
        this.storage = new BooksStorage();
        await this.storage.open();
        await this.keepStorageByDefault();
        await this.migrateLegacyBooks();
        await this.refreshLibrary();
        await this.updateStorageEstimate();
        this.log('info', 'Books library ready');
    }

    loadApiKey() {
        const storedKey = localStorage.getItem('openaiApiKey');
        if (storedKey && storedKey.length > 10) {
            this.apiKey = storedKey;
            this.updateApiKeyUI(true);
        } else {
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
        this.updateApiKeyUI(true);
        this.hideApiKeyOverlay();
        this.updateStatus('API key saved');
        this.log('info', 'OpenAI API key saved');
        const settingsInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyInput'));
        const overlayInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyOverlayInput'));
        if (settingsInput) settingsInput.value = '';
        if (overlayInput) overlayInput.value = '';
        return true;
    }

    removeApiKey() {
        localStorage.removeItem('openaiApiKey');
        this.apiKey = null;
        this.updateApiKeyUI(false);
        this.updateStatus('API key removed');
        this.log('info', 'OpenAI API key removed');
    }

    /** @param {boolean} hasKey */
    updateApiKeyUI(hasKey) {
        const statusEl = document.getElementById('apiKeyStatus');
        const inputRow = document.getElementById('apiKeyInputRow');
        const actionsRow = document.getElementById('apiKeyActions');
        if (!statusEl || !inputRow || !actionsRow) return;
        if (hasKey) {
            const storedKey = localStorage.getItem('openaiApiKey') || '';
            statusEl.textContent = `Configured: ${storedKey.substring(0, 7)}...${storedKey.substring(storedKey.length - 4)}`;
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

    showApiKeyOverlay() {
        const overlay = document.getElementById('apiKeyOverlay');
        if (overlay) overlay.style.display = 'flex';
    }

    hideApiKeyOverlay() {
        const overlay = document.getElementById('apiKeyOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    loadSettings() {
        const saved = localStorage.getItem('ebookSettings');
        if (saved) this.settings = { ...this.settings, ...JSON.parse(saved) };
        const voiceEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsVoice'));
        const modelEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsModel'));
        const speedEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ttsSpeed'));
        const speedValueEl = document.getElementById('ttsSpeedValue');
        if (voiceEl) voiceEl.value = this.settings.voice;
        if (modelEl) modelEl.value = this.settings.model;
        if (speedEl) speedEl.value = String(this.settings.speed);
        if (speedValueEl) speedValueEl.textContent = `${this.settings.speed}x`;
        this.updateVoiceDescription();
    }

    saveSettings() {
        localStorage.setItem('ebookSettings', JSON.stringify(this.settings));
    }

    updateVoiceDescription() {
        const descEl = document.getElementById('voiceDescription');
        if (descEl) descEl.textContent = VOICE_DESCRIPTIONS[this.settings.voice] || '';
    }

    setupUI() {
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsPanel = document.getElementById('settingsPanel');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');
        if (settingsBtn && settingsPanel) {
            settingsBtn.addEventListener('click', () => {
                settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
            });
        }
        if (closeSettingsBtn && settingsPanel) {
            closeSettingsBtn.addEventListener('click', () => settingsPanel.style.display = 'none');
        }
        this.setupApiKeyUI();
        this.setupSettingsUI();
        this.setupLibraryUI();
        this.setupWorkspaceUI();
        this.setupPlayerUI();
    }

    setupApiKeyUI() {
        const saveBtn = document.getElementById('saveApiKeyBtn');
        const showBtn = document.getElementById('showApiKeyBtn');
        const changeBtn = document.getElementById('changeApiKeyBtn');
        const removeBtn = document.getElementById('removeApiKeyBtn');
        const inputEl = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyInput'));
        const overlayInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyOverlayInput'));
        const overlaySaveBtn = document.getElementById('saveApiKeyOverlayBtn');
        if (saveBtn && inputEl) {
            saveBtn.addEventListener('click', () => this.saveApiKey(inputEl.value.trim()));
            inputEl.addEventListener('keydown', e => {
                if (e.key === 'Enter') this.saveApiKey(inputEl.value.trim());
            });
        }
        if (overlaySaveBtn && overlayInput) {
            overlaySaveBtn.addEventListener('click', () => this.saveApiKey(overlayInput.value.trim()));
            overlayInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') this.saveApiKey(overlayInput.value.trim());
            });
        }
        if (showBtn) {
            showBtn.addEventListener('click', () => {
                const storedKey = localStorage.getItem('openaiApiKey') || '';
                const statusEl = document.getElementById('apiKeyStatus');
                if (!statusEl) return;
                if (showBtn.textContent === 'Show') {
                    statusEl.textContent = storedKey;
                    showBtn.textContent = 'Hide';
                } else {
                    this.updateApiKeyUI(Boolean(this.apiKey));
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
        if (removeBtn) removeBtn.addEventListener('click', () => this.removeApiKey());
    }

    setupSettingsUI() {
        const voiceEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsVoice'));
        const modelEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsModel'));
        const speedEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ttsSpeed'));
        const speedValueEl = document.getElementById('ttsSpeedValue');
        const previewBtn = document.getElementById('previewVoiceBtn');
        if (voiceEl) {
            voiceEl.addEventListener('change', () => {
                this.settings.voice = voiceEl.value;
                this.saveSettings();
                this.updateVoiceDescription();
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
        if (previewBtn) previewBtn.addEventListener('click', () => this.previewVoice());
    }

    setupLibraryUI() {
        const uploadButton = document.getElementById('uploadButton');
        const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('fileInput'));
        const savedBookList = document.getElementById('savedBookList');
        const librarySearch = /** @type {HTMLInputElement | null} */ (document.getElementById('librarySearch'));
        if (uploadButton && fileInput) uploadButton.addEventListener('click', () => fileInput.click());
        if (fileInput) {
            fileInput.addEventListener('change', e => {
                const target = /** @type {HTMLInputElement} */ (e.target);
                if (target.files && target.files[0]) this.importFile(target.files[0]);
                target.value = '';
            });
        }
        if (savedBookList) savedBookList.addEventListener('click', e => this.handleLibraryAction(e));
        if (librarySearch) {
            librarySearch.addEventListener('input', () => {
                this.libraryQuery = librarySearch.value.trim().toLowerCase();
                this.renderLibrary();
            });
        }
    }

    setupWorkspaceUI() {
        const spineList = document.getElementById('spineList');
        const readerView = document.getElementById('readerView');
        const readerSearch = /** @type {HTMLInputElement | null} */ (document.getElementById('readerSearch'));
        const readerSearchClearBtn = document.getElementById('readerSearchClearBtn');
        const readerFullscreenBtn = document.getElementById('readerFullscreenBtn');
        const autoToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('autoGenerateAheadToggle'));
        if (spineList) spineList.addEventListener('click', e => this.handleSpineClick(e));
        if (readerView) readerView.addEventListener('click', e => this.handleReaderClick(e));
        if (readerSearch) {
            readerSearch.addEventListener('input', () => {
                this.readerQuery = readerSearch.value.trim();
                this.renderReader();
            });
        }
        if (readerSearchClearBtn && readerSearch) {
            readerSearchClearBtn.addEventListener('click', () => {
                readerSearch.value = '';
                this.readerQuery = '';
                this.renderReader();
            });
        }
        if (readerFullscreenBtn) {
            readerFullscreenBtn.addEventListener('click', () => this.toggleReaderFullscreen());
        }
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && document.body.classList.contains('reader-fullscreen-mode')) {
                this.setReaderFullscreen(false);
            }
        });
        if (autoToggle) {
            autoToggle.addEventListener('change', () => {
                this.autoGenerateAhead = autoToggle.checked;
                if (this.autoGenerateAhead) this.ensureGeneratedAhead();
            });
        }
        this.bindButton('generateNext15Btn', () => this.generateNextDuration(15 * 60, false));
        this.bindButton('generateNextHourBtn', () => this.generateNextDuration(60 * 60, false));
        this.bindButton('generateSectionBtn', () => this.generateCurrentSection());
        this.bindButton('generateAllBtn', () => this.generateAllRemaining());
        this.bindButton('cancelGenerationBtn', () => this.cancelGeneration());
        this.bindButton('downloadOriginalBtn', () => this.downloadCurrentOriginal());
        this.bindButton('downloadCurrentSegmentBtn', () => this.downloadCurrentSegment());
        this.bindButton('downloadAllSegmentsBtn', () => this.downloadAllSegments());
        this.bindButton('downloadCombinedBtn', () => this.downloadCombinedSegments());
        this.bindButton('deleteCurrentSegmentAudioBtn', () => this.deleteCurrentSegmentAudio());
        this.bindButton('deleteAllAudioBtn', () => this.deleteCurrentBookAudio());
        this.bindButton('clearLogBtn', () => this.clearLog());
    }

    toggleReaderFullscreen() {
        this.setReaderFullscreen(!document.body.classList.contains('reader-fullscreen-mode'));
    }

    /** @param {boolean} enabled */
    setReaderFullscreen(enabled) {
        document.body.classList.toggle('reader-fullscreen-mode', enabled);
        const button = document.getElementById('readerFullscreenBtn');
        if (button) button.textContent = enabled ? 'Exit fullscreen' : 'Fullscreen';
        if (enabled) this.scrollCurrentSegmentIntoView(false);
    }

    setupPlayerUI() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (audio) {
            audio.addEventListener('timeupdate', () => this.handleAudioTimeUpdate());
            audio.addEventListener('ended', () => this.playNextGenerated(true));
            audio.addEventListener('loadedmetadata', () => this.restoreListeningOffset());
        }
        this.bindButton('playFromProgressBtn', () => this.playFromProgress());
        this.bindButton('previousSegmentBtn', () => this.playAdjacentGenerated(-1));
        this.bindButton('nextSegmentBtn', () => this.playAdjacentGenerated(1));
    }

    /** @param {string} id @param {() => void} handler */
    bindButton(id, handler) {
        const button = document.getElementById(id);
        if (button) button.addEventListener('click', handler);
    }

    async previewVoice() {
        if (!this.apiKey) {
            this.showApiKeyOverlay();
            this.updateStatus('API key required for voice preview');
            return;
        }
        const previewBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('previewVoiceBtn'));
        if (!previewBtn) return;
        if (this.previewAudio && !this.previewAudio.paused) {
            this.previewAudio.pause();
            this.previewAudio = null;
            previewBtn.textContent = 'Preview';
            return;
        }
        previewBtn.disabled = true;
        previewBtn.textContent = 'Loading...';
        try {
            const response = await this.fetchSpeech(VOICE_PREVIEW_TEXT, null);
            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            this.previewAudio = new Audio(audioUrl);
            this.previewAudio.addEventListener('ended', () => {
                previewBtn.textContent = 'Preview';
                URL.revokeObjectURL(audioUrl);
            });
            previewBtn.disabled = false;
            previewBtn.textContent = 'Stop';
            await this.previewAudio.play();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Voice preview failed: ${message}`);
            previewBtn.disabled = false;
            previewBtn.textContent = 'Preview';
        }
    }

    async refreshLibrary() {
        if (!this.storage) return;
        this.books = await this.storage.getBooks();
        this.renderLibrary();
    }

    renderLibrary() {
        const list = document.getElementById('savedBookList');
        if (!list) return;
        const books = this.books.filter(book => {
            if (!this.libraryQuery) return true;
            return `${book.title} ${book.author} ${book.fileName}`.toLowerCase().includes(this.libraryQuery);
        });
        if (books.length === 0) {
            list.innerHTML = '<div class="library-empty">No matching saved books.</div>';
            return;
        }
        list.innerHTML = books.map(book => {
            const selectedClass = this.currentBook?.id === book.id ? ' selected' : '';
            const readPercent = this.getBookReadPercent(book);
            const generatedText = `${book.generatedSegmentCount || 0}/${book.segmentCount || 0} segments`;
            return `
                <div class="saved-book-item${selectedClass}">
                    <div class="saved-book-title">${this.escapeHtml(book.title)}</div>
                    <div class="saved-book-author">${this.escapeHtml(book.author || 'Unknown author')}</div>
                    <div class="saved-book-meta">
                        ${this.escapeHtml(book.format.toUpperCase())} · ${this.formatFileSize(book.fileSize)} · ${this.formatDuration(book.estimatedDurationSec)} est · ${generatedText}
                    </div>
                    <div class="saved-book-progress" title="Reading progress">
                        <div class="saved-book-progress-fill" style="width: ${readPercent}%"></div>
                    </div>
                    <div class="saved-book-actions">
                        <button class="small-action-btn" type="button" data-action="open" data-id="${this.escapeHtml(book.id)}">Open</button>
                        <button class="small-action-btn" type="button" data-action="original" data-id="${this.escapeHtml(book.id)}">Original</button>
                        <button class="small-action-btn" type="button" data-action="combined" data-id="${this.escapeHtml(book.id)}">MP3</button>
                        <button class="small-action-btn danger" type="button" data-action="delete-audio" data-id="${this.escapeHtml(book.id)}">Delete MP3s</button>
                        <button class="small-action-btn" type="button" data-action="delete" data-id="${this.escapeHtml(book.id)}">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    /** @param {Event} event */
    async handleLibraryAction(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const button = /** @type {HTMLButtonElement | null} */ (target?.closest('button[data-action]') || null);
        if (!button) return;
        const id = button.getAttribute('data-id');
        const action = button.getAttribute('data-action');
        if (!id || !action) return;
        if (action === 'open') await this.openBook(id);
        if (action === 'original') await this.downloadOriginalById(id);
        if (action === 'combined') await this.downloadCombinedById(id);
        if (action === 'delete-audio') await this.deleteBookAudio(id);
        if (action === 'delete') await this.deleteBook(id);
    }

    /** @param {File} file */
    async importFile(file) {
        if (!this.storage) return;
        this.updateStatus('Importing book...');
        this.log('info', `Importing ${file.name} (${this.formatFileSize(file.size)})`);
        const imported = await this.parseFile(file, this.createId('book'));
        await this.storage.putBook(imported.book);
        await this.storage.putSections(imported.sections);
        await this.storage.putSegments(imported.segments);
        await this.refreshLibrary();
        await this.updateStorageEstimate();
        await this.openBook(imported.book.id);
        this.updateStatus('Book imported and saved on this device');
        this.log('info', `Imported ${imported.book.title}: ${imported.sections.length} sections, ${imported.segments.length} audio segments planned`);
    }

    async migrateLegacyBooks() {
        if (!this.storage) return;
        const books = await this.storage.getBooks();
        for (const oldBook of books) {
            if (oldBook.schemaVersion >= 3) continue;
            if (!oldBook.rawFile) continue;
            try {
                const file = new File([oldBook.rawFile], oldBook.fileName || `${oldBook.title || 'book'}.${oldBook.format || 'txt'}`, {
                    type: oldBook.fileType || 'application/octet-stream',
                    lastModified: Date.parse(oldBook.updatedAt || oldBook.createdAt || new Date().toISOString())
                });
                const imported = await this.parseFile(file, oldBook.id);
                imported.book.createdAt = oldBook.createdAt || imported.book.createdAt;
                imported.book.updatedAt = new Date().toISOString();
                imported.book.lastOpenedAt = oldBook.lastOpenedAt || '';
                if (oldBook.legacyAudioBlob) {
                    imported.book.legacyAudioBlob = oldBook.legacyAudioBlob;
                    imported.book.legacyAudioSize = oldBook.legacyAudioSize || oldBook.legacyAudioBlob.size;
                } else if (/** @type {any} */ (oldBook).audioBlob) {
                    imported.book.legacyAudioBlob = /** @type {any} */ (oldBook).audioBlob;
                    imported.book.legacyAudioSize = /** @type {any} */ (oldBook).audioSize || /** @type {any} */ (oldBook).audioBlob.size;
                }
                await this.storage.putBook(imported.book);
                await this.storage.putSections(imported.sections);
                await this.storage.putSegments(imported.segments);
                this.log('info', `Migrated saved book: ${imported.book.title}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.log('error', `Could not migrate saved book: ${message}`);
            }
        }
    }

    /**
     * @param {File} file
     * @param {string} bookId
     */
    async parseFile(file, bookId) {
        const extension = file.name.split('.').pop()?.toLowerCase() || 'txt';
        let title = file.name.replace(/\.[^.]+$/, '');
        let author = '';
        /** @type {{ title: string, text: string, html?: string }[]} */
        let rawSections = [];
        if (extension === 'epub') {
            const epub = await this.parseEpub(file);
            title = epub.title || title;
            author = epub.author || '';
            rawSections = epub.sections;
        } else if (extension === 'pdf') {
            rawSections = await this.parsePdf(file);
        } else if (extension === 'html' || extension === 'htm') {
            rawSections = await this.parseHtml(file);
        } else if (extension === 'txt') {
            rawSections = this.sectionsFromText(await this.readTextFile(file));
        } else {
            throw new Error(`Unsupported file format: ${extension}`);
        }
        rawSections = rawSections
            .map((section, index) => ({
                title: section.title || `Section ${index + 1}`,
                text: this.cleanText(section.text || ''),
                html: section.html ? this.sanitizeReaderHtml(section.html) : ''
            }))
            .filter(section => section.text.length > 0);
        if (rawSections.length === 0) throw new Error('No readable text found');

        /** @type {BookSection[]} */
        const sections = [];
        /** @type {AudioSegment[]} */
        const segments = [];
        let charCursor = 0;
        let segmentIndex = 0;
        let totalWords = 0;
        for (let i = 0; i < rawSections.length; i++) {
            const raw = rawSections[i];
            const sectionId = `sec-${i}`;
            const wordCount = this.countWords(raw.text);
            const section = {
                key: this.sectionKey(bookId, sectionId),
                bookId,
                id: sectionId,
                spineIndex: i,
                title: raw.title,
                text: raw.text,
                html: raw.html || '',
                charStart: charCursor,
                charEnd: charCursor + raw.text.length,
                wordCount
            };
            sections.push(section);
            totalWords += wordCount;
            const pieces = this.splitIntoSegmentPieces(raw.text);
            for (let j = 0; j < pieces.length; j++) {
                const piece = pieces[j];
                const segmentId = `seg-${segmentIndex}`;
                const segmentWords = this.countWords(piece.text);
                segments.push({
                    key: this.segmentKey(bookId, segmentId),
                    bookId,
                    id: segmentId,
                    sectionId,
                    segmentIndex,
                    sectionSegmentIndex: j,
                    charStart: section.charStart + piece.start,
                    charEnd: section.charStart + piece.end,
                    text: piece.text,
                    wordCount: segmentWords,
                    estimatedDurationSec: this.estimateDuration(segmentWords),
                    status: 'pending',
                    blob: null,
                    audioSize: 0,
                    durationSec: 0,
                    generatedAt: '',
                    audioSettings: null,
                    error: ''
                });
                segmentIndex++;
            }
            charCursor = section.charEnd + 2;
        }
        const now = new Date().toISOString();
        const book = {
            id: bookId,
            schemaVersion: 3,
            title,
            author,
            format: extension,
            fileName: file.name,
            fileType: file.type || 'application/octet-stream',
            fileSize: file.size,
            rawFile: file,
            sectionCount: sections.length,
            segmentCount: segments.length,
            generatedSegmentCount: 0,
            wordCount: totalWords,
            charCount: charCursor,
            estimatedDurationSec: this.estimateDuration(totalWords),
            generatedDurationSec: 0,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: now,
            readingSectionId: sections[0]?.id || '',
            readingCharOffset: 0,
            listeningSegmentId: segments[0]?.id || '',
            listeningOffsetSec: 0,
            legacyAudioBlob: null,
            legacyAudioSize: 0
        };
        return { book, sections, segments };
    }

    /** @param {File} file */
    async parseEpub(file) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip library not loaded');
        const zip = await JSZip.loadAsync(file);
        const containerXml = await zip.file('META-INF/container.xml')?.async('text');
        if (!containerXml) throw new Error('Invalid EPUB: missing container.xml');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'text/xml');
        const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
        if (!rootfilePath) throw new Error('Invalid EPUB: cannot find content.opf');
        const opfContent = await zip.file(rootfilePath)?.async('text');
        if (!opfContent) throw new Error('Invalid EPUB: cannot read content.opf');
        const opfDoc = parser.parseFromString(opfContent, 'text/xml');
        const title = opfDoc.querySelector('metadata title, dc\\:title')?.textContent?.trim() || '';
        const author = opfDoc.querySelector('metadata creator, dc\\:creator')?.textContent?.trim() || '';
        const basePath = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);
        const manifest = new Map();
        const mediaTypes = new Map();
        opfDoc.querySelectorAll('manifest item').forEach(item => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            const mediaType = item.getAttribute('media-type') || '';
            if (id && href) {
                manifest.set(id, href);
                mediaTypes.set(this.normalizePath(basePath + href), mediaType);
            }
        });
        /** @type {{ title: string, text: string, html?: string }[]} */
        const sections = [];
        const spineItems = Array.from(opfDoc.querySelectorAll('spine itemref'));
        for (let i = 0; i < spineItems.length; i++) {
            const idref = spineItems[i].getAttribute('idref');
            const href = idref ? manifest.get(idref) : '';
            if (!href) continue;
            const content = await zip.file(basePath + href)?.async('text');
            if (!content) continue;
            const doc = parser.parseFromString(content, 'text/html');
            doc.querySelectorAll('script, style, nav, footer').forEach(el => el.remove());
            const filePath = this.normalizePath(basePath + href);
            const fileDir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
            const images = Array.from(doc.querySelectorAll('img, image'));
            for (const img of images) {
                const rawSrc = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
                if (!rawSrc || rawSrc.startsWith('data:')) continue;
                const resolved = this.normalizePath(rawSrc.startsWith('/') ? rawSrc.substring(1) : fileDir + rawSrc);
                const imgFile = zip.file(resolved);
                if (!imgFile) continue;
                const blob = await imgFile.async('blob');
                const typedBlob = new Blob([blob], { type: mediaTypes.get(resolved) || this.getMimeTypeFromFilename(resolved) });
                const dataUrl = await this.blobToDataUrl(typedBlob);
                img.setAttribute('src', dataUrl);
                img.removeAttribute('xlink:href');
            }
            const heading = doc.querySelector('h1, h2, h3')?.textContent?.trim();
            const text = doc.body?.textContent || '';
            sections.push({ title: heading || `Chapter ${sections.length + 1}`, text, html: doc.body?.innerHTML || '' });
        }
        return { title, author, sections };
    }

    /** @param {File} file */
    async parsePdf(file) {
        if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js library not loaded');
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        /** @type {{ title: string, text: string, html?: string }[]} */
        const sections = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const text = textContent.items.map((/** @type {any} */ item) => item.str).join(' ');
            sections.push({ title: `Page ${i}`, text });
            if (pdf.numPages > 20 && i % 10 === 0) this.updateStatus(`Reading PDF ${Math.round(i / pdf.numPages * 100)}%`);
        }
        return sections;
    }

    /** @param {File} file */
    async parseHtml(file) {
        const html = await this.readTextFile(file);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('script, style, nav, footer').forEach(el => el.remove());
        const headings = Array.from(doc.body?.querySelectorAll('h1, h2') || []);
        if (headings.length === 0) {
            return [{ title: doc.querySelector('title')?.textContent?.trim() || 'HTML document', text: doc.body?.textContent || '', html: doc.body?.innerHTML || '' }];
        }
        /** @type {{ title: string, text: string, html?: string }[]} */
        const sections = [];
        for (let i = 0; i < headings.length; i++) {
            const heading = headings[i];
            let text = heading.textContent || '';
            let html = heading.outerHTML;
            let node = heading.nextSibling;
            while (node && node !== headings[i + 1]) {
                text += `\n${node.textContent || ''}`;
                if (node instanceof Element) html += node.outerHTML;
                else html += this.escapeHtml(node.textContent || '');
                node = node.nextSibling;
            }
            sections.push({ title: heading.textContent?.trim() || `Section ${i + 1}`, text, html });
        }
        return sections;
    }

    /** @param {string} text */
    sectionsFromText(text) {
        const clean = this.cleanText(text);
        const maxSectionChars = 12000;
        /** @type {{ title: string, text: string, html?: string }[]} */
        const sections = [];
        let cursor = 0;
        while (cursor < clean.length) {
            let end = Math.min(clean.length, cursor + maxSectionChars);
            if (end < clean.length) {
                const breakAt = Math.max(clean.lastIndexOf('\n\n', end), clean.lastIndexOf('. ', end));
                if (breakAt > cursor + 2000) end = breakAt + 1;
            }
            const sectionText = clean.slice(cursor, end).trim();
            if (sectionText) sections.push({ title: `Part ${sections.length + 1}`, text: sectionText });
            cursor = end;
        }
        return sections;
    }

    /** @param {File} file */
    async readTextFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(/** @type {string} */ (e.target?.result) || '');
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    /** @param {string} text */
    splitIntoSegmentPieces(text) {
        /** @type {{ text: string, start: number, end: number }[]} */
        const pieces = [];
        let cursor = 0;
        while (cursor < text.length) {
            while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
            if (cursor >= text.length) break;
            let end = Math.min(text.length, cursor + TTS_CHUNK_SIZE);
            if (end < text.length) {
                const punctuationBreak = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('? ', end), text.lastIndexOf('! ', end), text.lastIndexOf('\n', end));
                const spaceBreak = text.lastIndexOf(' ', end);
                if (punctuationBreak > cursor + 500) end = punctuationBreak + 1;
                else if (spaceBreak > cursor + 500) end = spaceBreak;
            }
            const pieceText = text.slice(cursor, end).trim();
            if (pieceText) pieces.push({ text: pieceText, start: cursor, end });
            cursor = end;
        }
        return pieces;
    }

    /** @param {string} bookId */
    async openBook(bookId) {
        if (!this.storage) return;
        const book = await this.storage.getBook(bookId);
        if (!book) throw new Error('Book not found');
        this.currentBook = book;
        this.currentBook.lastOpenedAt = new Date().toISOString();
        await this.storage.putBook(this.currentBook);
        this.sections = await this.storage.getSections(bookId);
        this.segments = await this.storage.getSegments(bookId);
        this.currentSegmentId = this.currentBook.listeningSegmentId || this.segments[0]?.id || null;
        this.showWorkspace(true);
        this.renderWorkspace();
        this.renderLibrary();
        this.updateStatus(`Opened ${book.title}`);
    }

    /** @param {boolean} show */
    showWorkspace(show) {
        const workspace = document.getElementById('bookWorkspace');
        if (workspace) workspace.style.display = show ? 'block' : 'none';
    }

    renderWorkspace() {
        if (!this.currentBook) return;
        const title = document.getElementById('workspaceTitle');
        const meta = document.getElementById('workspaceMeta');
        if (title) title.textContent = this.currentBook.title;
        if (meta) {
            meta.textContent = `${this.currentBook.author || 'Unknown author'} · ${this.currentBook.sectionCount} sections · ${this.currentBook.segmentCount} audio segments · ${this.formatDuration(this.currentBook.estimatedDurationSec)} estimated`;
        }
        this.renderProgress();
        this.renderSpine();
        this.renderReader();
        this.renderPlayerNow();
    }

    renderProgress() {
        if (!this.currentBook) return;
        const readEl = document.getElementById('readProgressText');
        const generatedEl = document.getElementById('generatedProgressText');
        const listeningEl = document.getElementById('listeningProgressText');
        const readPercent = this.getBookReadPercent(this.currentBook);
        if (readEl) readEl.textContent = `${readPercent}%`;
        if (generatedEl) generatedEl.textContent = `${this.formatDuration(this.currentBook.generatedDurationSec)} / ${this.formatDuration(this.currentBook.estimatedDurationSec)}`;
        if (listeningEl) {
            const segment = this.getSegmentById(this.currentBook.listeningSegmentId);
            listeningEl.textContent = segment ? `${this.getSectionTitle(segment.sectionId)} · ${this.formatDuration(this.currentBook.listeningOffsetSec)}` : 'Start';
        }
    }

    renderSpine() {
        const spineList = document.getElementById('spineList');
        if (!spineList) return;
        spineList.innerHTML = this.sections.map(section => {
            const sectionSegments = this.segments.filter(segment => segment.sectionId === section.id);
            const generated = sectionSegments.filter(segment => segment.status === 'done').length;
            const percent = sectionSegments.length ? Math.round(generated / sectionSegments.length * 100) : 0;
            const current = this.getCurrentSectionId() === section.id ? ' current' : '';
            return `
                <div class="spine-item${current}" data-section-id="${this.escapeHtml(section.id)}">
                    <div class="spine-title">${this.escapeHtml(section.title)}</div>
                    <div class="spine-meta">${generated}/${sectionSegments.length} generated · ${this.formatNumber(section.wordCount)} words</div>
                    <div class="spine-generated-bar"><div class="spine-generated-fill" style="width: ${percent}%"></div></div>
                </div>
            `;
        }).join('');
    }

    renderReader() {
        const reader = document.getElementById('readerView');
        if (!reader) return;
        const query = this.readerQuery;
        reader.innerHTML = this.sections.map(section => {
            const sectionSegments = this.segments.filter(segment => segment.sectionId === section.id);
            const readerBody = section.html
                ? `<div class="epub-section-html">${this.highlightSanitizedHtml(section.html, query)}</div>`
                : sectionSegments.map(segment => {
                    const statusClass = segment.status === 'done' ? ' generated' : segment.status === 'generating' ? ' generating' : '';
                    const currentClass = segment.id === this.currentSegmentId ? ' current' : '';
                    return `<span class="reader-segment${statusClass}${currentClass}" data-segment-id="${this.escapeHtml(segment.id)}">${this.highlight(this.escapeHtml(segment.text), query)}</span>`;
                }).join('');
            const segmentHtml = sectionSegments.map(segment => {
                const statusClass = segment.status === 'done' ? ' generated' : segment.status === 'generating' ? ' generating' : '';
                const currentClass = segment.id === this.currentSegmentId ? ' current' : '';
                return `<span class="reader-segment${statusClass}${currentClass}" data-segment-id="${this.escapeHtml(segment.id)}">${this.highlight(this.escapeHtml(segment.text), query)}</span>`;
            }).join('');
            const audioMap = section.html ? `<div class="reader-audio-segments">${segmentHtml}</div>` : '';
            return `<section class="reader-section" id="reader-${this.escapeHtml(section.id)}"><h3>${this.escapeHtml(section.title)}</h3>${readerBody}${audioMap}</section>`;
        }).join('');
        this.scrollCurrentSegmentIntoView(false);
    }

    /** @param {Event} event */
    handleSpineClick(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const item = target?.closest('.spine-item');
        const sectionId = item?.getAttribute('data-section-id');
        if (!sectionId) return;
        const firstSegment = this.segments.find(segment => segment.sectionId === sectionId);
        if (firstSegment) {
            this.currentSegmentId = firstSegment.id;
            this.markReadingProgress(firstSegment);
            this.renderWorkspace();
            document.getElementById(`reader-${sectionId}`)?.scrollIntoView({ block: 'start' });
        }
    }

    /** @param {Event} event */
    handleReaderClick(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const item = target?.closest('.reader-segment');
        const segmentId = item?.getAttribute('data-segment-id');
        if (!segmentId) return;
        const segment = this.getSegmentById(segmentId);
        if (!segment) return;
        this.currentSegmentId = segment.id;
        this.markReadingProgress(segment);
        this.renderWorkspace();
        if (segment.status === 'done') this.playSegment(segment.id, false);
    }

    async generateCurrentSection() {
        const sectionId = this.getCurrentSectionId();
        if (!sectionId) return;
        await this.generateSegments(this.segments.filter(segment => segment.sectionId === sectionId && segment.status !== 'done'), false);
    }

    async generateAllRemaining() {
        await this.generateSegments(this.segments.filter(segment => segment.status !== 'done'), false);
    }

    /** @param {number} seconds @param {boolean} automatic */
    async generateNextDuration(seconds, automatic) {
        const startIndex = Math.max(0, this.getCurrentSegmentIndex());
        let total = 0;
        /** @type {AudioSegment[]} */
        const selected = [];
        for (let i = startIndex; i < this.segments.length; i++) {
            const segment = this.segments[i];
            if (segment.status === 'done') continue;
            selected.push(segment);
            total += segment.estimatedDurationSec;
            if (total >= seconds) break;
        }
        if (selected.length === 0) {
            const firstPending = this.segments.find(segment => segment.status !== 'done');
            if (firstPending) selected.push(firstPending);
        }
        await this.generateSegments(selected, automatic);
    }

    /** @param {AudioSegment[]} selected @param {boolean} automatic */
    async generateSegments(selected, automatic) {
        if (selected.length === 0) {
            if (!automatic) this.updateStatus('No pending segments to generate');
            return;
        }
        if (!this.apiKey) {
            this.showApiKeyOverlay();
            this.updateStatus('API key required to generate audio');
            return;
        }
        if (!this.storage || !this.currentBook || this.isGenerating) return;
        this.isGenerating = true;
        this.generationAbort = new AbortController();
        let completed = 0;
        this.updateGenerationProgress(0, selected.length, `Generating ${selected.length} segment${selected.length === 1 ? '' : 's'}...`);
        try {
            for (const segment of selected) {
                if (this.generationAbort.signal.aborted) throw new Error('Generation cancelled');
                if (segment.status === 'done') {
                    completed++;
                    continue;
                }
                segment.status = 'generating';
                segment.error = '';
                await this.storage.putSegment(segment);
                this.replaceSegment(segment);
                this.renderSegmentStatus(segment);
                const response = await this.fetchSpeech(segment.text, this.generationAbort.signal);
                const blob = await response.blob();
                segment.blob = blob;
                segment.audioSize = blob.size;
                segment.status = 'done';
                segment.generatedAt = new Date().toISOString();
                segment.audioSettings = { ...this.settings };
                segment.durationSec = segment.estimatedDurationSec;
                await this.storage.putSegment(segment);
                this.replaceSegment(segment);
                await this.recalculateBookGeneration();
                completed++;
                this.updateGenerationProgress(completed, selected.length, `Generated ${completed}/${selected.length}`);
                this.renderWorkspace();
                if (!this.getCurrentGeneratedSegment() && segment.id === this.currentSegmentId) this.loadSegmentIntoPlayer(segment, false);
            }
            this.updateGenerationProgress(selected.length, selected.length, 'Generation complete');
            this.updateStatus('Audio generation complete');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            for (const segment of selected) {
                if (segment.status === 'generating') {
                    segment.status = 'error';
                    segment.error = message;
                    await this.storage.putSegment(segment);
                    this.replaceSegment(segment);
                }
            }
            this.updateStatus(message);
            this.log(message === 'Generation cancelled' ? 'warn' : 'error', message);
        } finally {
            this.isGenerating = false;
            this.generationAbort = null;
            await this.refreshLibrary();
            await this.updateStorageEstimate();
        }
    }

    cancelGeneration() {
        if (this.generationAbort) this.generationAbort.abort();
    }

    /** @param {string} text @param {AbortSignal | null} signal */
    async fetchSpeech(text, signal) {
        if (!this.apiKey) throw new Error('API key not configured');
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
            signal: signal || undefined
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
        }
        return response;
    }

    async recalculateBookGeneration() {
        if (!this.storage || !this.currentBook) return;
        const done = this.segments.filter(segment => segment.status === 'done');
        this.currentBook.generatedSegmentCount = done.length;
        this.currentBook.generatedDurationSec = done.reduce((sum, segment) => sum + (segment.durationSec || segment.estimatedDurationSec), 0);
        this.currentBook.updatedAt = new Date().toISOString();
        await this.storage.putBook(this.currentBook);
    }

    playFromProgress() {
        const segment = this.getSegmentById(this.currentBook?.listeningSegmentId || '') || this.segments.find(item => item.status === 'done');
        if (!segment) {
            this.updateStatus('Generate audio before playing');
            return;
        }
        this.playSegment(segment.id, true);
    }

    /** @param {number} direction */
    playAdjacentGenerated(direction) {
        const currentIndex = this.getCurrentSegmentIndex();
        const generated = this.segments.filter(segment => segment.status === 'done');
        const currentGeneratedIndex = generated.findIndex(segment => segment.segmentIndex === currentIndex);
        const next = generated[currentGeneratedIndex + direction] || (direction > 0 ? generated[0] : generated[generated.length - 1]);
        if (next) this.playSegment(next.id, true);
    }

    /** @param {boolean} autoplay */
    playNextGenerated(autoplay) {
        const currentIndex = this.getCurrentSegmentIndex();
        const next = this.segments.find(segment => segment.segmentIndex > currentIndex && segment.status === 'done');
        if (next) {
            this.playSegment(next.id, autoplay);
        } else {
            this.updateStatus('End of generated audio');
        }
    }

    /** @param {string} segmentId @param {boolean} autoplay */
    playSegment(segmentId, autoplay) {
        const segment = this.getSegmentById(segmentId);
        if (!segment || segment.status !== 'done' || !segment.blob) {
            this.updateStatus('That segment has not been generated yet');
            return;
        }
        this.currentSegmentId = segment.id;
        this.markReadingProgress(segment);
        this.loadSegmentIntoPlayer(segment, autoplay);
        this.renderWorkspace();
        this.scrollCurrentSegmentIntoView(true);
    }

    /** @param {AudioSegment} segment @param {boolean} autoplay */
    loadSegmentIntoPlayer(segment, autoplay) {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audio || !segment.blob) return;
        if (this.currentAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
        this.currentAudioUrl = this.takePreloadUrl(segment.id) || URL.createObjectURL(segment.blob);
        audio.src = this.currentAudioUrl;
        audio.dataset.segmentId = segment.id;
        this.currentSegmentId = segment.id;
        this.renderPlayerNow();
        this.preloadNextGenerated();
        if (autoplay) audio.play().catch(() => this.updateStatus('Tap play to start audio'));
    }

    restoreListeningOffset() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audio || !this.currentBook) return;
        if (audio.dataset.segmentId === this.currentBook.listeningSegmentId && this.currentBook.listeningOffsetSec > 0 && this.currentBook.listeningOffsetSec < audio.duration - 1) {
            audio.currentTime = this.currentBook.listeningOffsetSec;
        }
    }

    handleAudioTimeUpdate() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audio || !this.currentBook || !this.storage) return;
        const segmentId = audio.dataset.segmentId || this.currentSegmentId || '';
        const segment = this.getSegmentById(segmentId);
        if (!segment) return;
        this.currentBook.listeningSegmentId = segment.id;
        this.currentBook.listeningOffsetSec = audio.currentTime || 0;
        const ratio = audio.duration ? Math.min(1, audio.currentTime / audio.duration) : 0;
        this.currentBook.readingSectionId = segment.sectionId;
        this.currentBook.readingCharOffset = Math.round(segment.charStart + (segment.charEnd - segment.charStart) * ratio);
        this.renderProgress();
        this.preloadNextGenerated();
        const now = Date.now();
        if (now - this.lastProgressSavedAt > 5000) {
            this.lastProgressSavedAt = now;
            this.currentBook.updatedAt = new Date().toISOString();
            this.storage.putBook(this.currentBook);
            this.renderLibrary();
        }
        if (this.autoGenerateAhead && !this.isGenerating) this.ensureGeneratedAhead();
    }

    ensureGeneratedAhead() {
        if (!this.autoGenerateAhead || this.isGenerating || !this.apiKey) return;
        const ahead = this.generatedAheadSeconds();
        if (ahead < AUTO_AHEAD_SECONDS) this.generateNextDuration(AUTO_AHEAD_SECONDS - ahead, true);
    }

    generatedAheadSeconds() {
        const startIndex = Math.max(0, this.getCurrentSegmentIndex());
        let total = 0;
        for (let i = startIndex; i < this.segments.length; i++) {
            const segment = this.segments[i];
            if (segment.status !== 'done') break;
            total += segment.durationSec || segment.estimatedDurationSec;
        }
        return total;
    }

    async downloadCurrentOriginal() {
        if (this.currentBook) this.downloadBlob(this.currentBook.rawFile, this.currentBook.fileName);
    }

    /** @param {string} id */
    async downloadOriginalById(id) {
        const book = await this.storage?.getBook(id);
        if (book) this.downloadBlob(book.rawFile, book.fileName);
    }

    async downloadCurrentSegment() {
        const segment = this.getSegmentById(this.currentSegmentId || '');
        if (!segment || !segment.blob || !this.currentBook) {
            this.updateStatus('Current segment has no MP3 yet');
            return;
        }
        this.downloadBlob(segment.blob, this.segmentFilename(this.currentBook, segment));
    }

    async downloadAllSegments() {
        if (!this.currentBook) return;
        const done = this.segments.filter(segment => segment.status === 'done' && segment.blob);
        if (done.length === 0) {
            this.updateStatus('No generated MP3 segments to download');
            return;
        }
        for (const segment of done) {
            if (segment.blob) this.downloadBlob(segment.blob, this.segmentFilename(this.currentBook, segment));
        }
    }

    async downloadCombinedSegments() {
        if (this.currentBook) await this.downloadCombinedById(this.currentBook.id);
    }

    /** @param {string} id */
    async downloadCombinedById(id) {
        if (!this.storage) return;
        const book = await this.storage.getBook(id);
        if (!book) return;
        const segments = await this.storage.getSegments(id);
        const done = segments.filter(segment => segment.status === 'done' && segment.blob);
        if (done.length === 0 && book.legacyAudioBlob) {
            this.downloadBlob(book.legacyAudioBlob, `${this.safeFilename(book.title)}.mp3`);
            return;
        }
        if (done.length === 0) {
            this.updateStatus('No generated MP3 audio to download');
            return;
        }
        const blobs = done.map(segment => /** @type {Blob} */ (segment.blob));
        this.downloadBlob(new Blob(blobs, { type: 'audio/mpeg' }), `${this.safeFilename(book.title)}-generated.mp3`);
    }

    async deleteCurrentSegmentAudio() {
        if (!this.currentBook || !this.currentSegmentId) return;
        const segment = this.getSegmentById(this.currentSegmentId);
        if (!segment) return;
        await this.clearSegmentAudio(segment);
        await this.recalculateBookGeneration();
        this.renderWorkspace();
        await this.refreshLibrary();
        await this.updateStorageEstimate();
        this.updateStatus('Deleted current segment MP3');
    }

    async deleteCurrentBookAudio() {
        if (this.currentBook) await this.deleteBookAudio(this.currentBook.id);
    }

    /** @param {string} id */
    async deleteBookAudio(id) {
        if (!this.storage) return;
        const segments = await this.storage.getSegments(id);
        for (const segment of segments) {
            if (segment.status === 'done' || segment.blob) await this.clearSegmentAudio(segment);
        }
        const book = await this.storage.getBook(id);
        if (book) {
            book.generatedSegmentCount = 0;
            book.generatedDurationSec = 0;
            book.updatedAt = new Date().toISOString();
            book.legacyAudioBlob = null;
            book.legacyAudioSize = 0;
            await this.storage.putBook(book);
            if (this.currentBook?.id === id) this.currentBook = book;
        }
        if (this.currentBook?.id === id) {
            this.segments = await this.storage.getSegments(id);
            this.releaseAudioUrls();
            const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
            if (audio) audio.removeAttribute('src');
            this.renderWorkspace();
        }
        await this.refreshLibrary();
        await this.updateStorageEstimate();
        this.updateStatus('Deleted generated MP3s for this book');
    }

    /** @param {AudioSegment} segment */
    async clearSegmentAudio(segment) {
        if (!this.storage) return;
        segment.status = 'pending';
        segment.blob = null;
        segment.audioSize = 0;
        segment.durationSec = 0;
        segment.generatedAt = '';
        segment.audioSettings = null;
        segment.error = '';
        await this.storage.putSegment(segment);
        this.replaceSegment(segment);
    }

    /** @param {string} id */
    async deleteBook(id) {
        if (!this.storage) return;
        await this.storage.deleteBookCascade(id);
        if (this.currentBook?.id === id) {
            this.currentBook = null;
            this.sections = [];
            this.segments = [];
            this.currentSegmentId = null;
            this.releaseAudioUrls();
            this.showWorkspace(false);
        }
        await this.refreshLibrary();
        await this.updateStorageEstimate();
        this.updateStatus('Deleted saved book from this device');
    }

    async keepStorageByDefault() {
        const statusEl = document.getElementById('storagePersistenceStatus');
        if (!navigator.storage?.persist) {
            if (statusEl) statusEl.textContent = 'Browser manages retention';
            return;
        }
        const persistedBefore = await navigator.storage.persisted?.();
        const persisted = persistedBefore || await navigator.storage.persist();
        if (statusEl) statusEl.textContent = persisted ? 'Persistent storage on' : 'Persistent storage requested';
        this.log(persisted ? 'info' : 'warn', persisted ? 'Persistent storage is enabled' : 'Browser did not grant persistent storage yet');
        await this.updateStorageEstimate();
    }

    async updateStorageEstimate() {
        const estimateEl = document.getElementById('storageEstimate');
        const persistStatus = document.getElementById('storagePersistenceStatus');
        if (!estimateEl) return;
        if (!navigator.storage?.estimate) {
            estimateEl.textContent = 'Storage quota unavailable';
            return;
        }
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        estimateEl.textContent = `Storage: ${this.formatFileSize(usage)}${quota ? ` / ${this.formatFileSize(quota)}` : ''}`;
        if (persistStatus && navigator.storage?.persisted) {
            const persisted = await navigator.storage.persisted();
            persistStatus.textContent = persisted ? 'Persistent storage on' : 'Best-effort storage';
        }
    }

    /** @param {AudioSegment} segment */
    markReadingProgress(segment) {
        if (!this.currentBook || !this.storage) return;
        this.currentBook.readingSectionId = segment.sectionId;
        this.currentBook.readingCharOffset = segment.charStart;
        this.currentBook.listeningSegmentId = segment.id;
        this.currentBook.updatedAt = new Date().toISOString();
        this.storage.putBook(this.currentBook);
    }

    renderPlayerNow() {
        const el = document.getElementById('playerNow');
        if (!el) return;
        const segment = this.getSegmentById(this.currentSegmentId || '');
        if (!segment) {
            el.textContent = 'No segment selected';
            return;
        }
        el.textContent = `${this.getSectionTitle(segment.sectionId)} · segment ${segment.segmentIndex + 1}/${this.segments.length} · ${segment.status === 'done' ? 'ready' : segment.status}`;
    }

    /** @param {AudioSegment} segment */
    renderSegmentStatus(segment) {
        const node = document.querySelector(`.reader-segment[data-segment-id="${CSS.escape(segment.id)}"]`);
        if (!node) return;
        node.classList.toggle('generated', segment.status === 'done');
        node.classList.toggle('generating', segment.status === 'generating');
    }

    /** @param {number} done @param {number} total @param {string} message */
    updateGenerationProgress(done, total, message) {
        const status = document.getElementById('generationStatus');
        const fill = document.getElementById('generationProgressFill');
        if (status) status.textContent = message;
        if (fill) fill.style.width = total ? `${Math.round(done / total * 100)}%` : '0%';
    }

    preloadNextGenerated() {
        const currentIndex = this.getCurrentSegmentIndex();
        const next = this.segments.find(segment => segment.segmentIndex > currentIndex && segment.status === 'done' && segment.blob);
        if (!next || next.id === this.preloadSegmentId || !next.blob) return;
        if (this.preloadUrl) URL.revokeObjectURL(this.preloadUrl);
        this.preloadUrl = URL.createObjectURL(next.blob);
        this.preloadSegmentId = next.id;
        this.preloadAudio = new Audio(this.preloadUrl);
        this.preloadAudio.preload = 'auto';
    }

    /** @param {string} segmentId */
    takePreloadUrl(segmentId) {
        if (this.preloadSegmentId !== segmentId || !this.preloadUrl) return null;
        const url = this.preloadUrl;
        this.preloadUrl = null;
        this.preloadSegmentId = null;
        this.preloadAudio = null;
        return url;
    }

    releaseAudioUrls() {
        if (this.currentAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
        if (this.preloadUrl) URL.revokeObjectURL(this.preloadUrl);
        this.currentAudioUrl = null;
        this.preloadUrl = null;
        this.preloadSegmentId = null;
        this.preloadAudio = null;
    }

    scrollCurrentSegmentIntoView(smooth) {
        if (!this.currentSegmentId) return;
        const node = document.querySelector(`.reader-segment[data-segment-id="${CSS.escape(this.currentSegmentId)}"]`);
        if (node) node.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    }

    /** @param {AudioSegment} segment */
    replaceSegment(segment) {
        const index = this.segments.findIndex(item => item.id === segment.id);
        if (index !== -1) this.segments[index] = segment;
    }

    getCurrentSegmentIndex() {
        const segment = this.getSegmentById(this.currentSegmentId || this.currentBook?.listeningSegmentId || '');
        return segment ? segment.segmentIndex : 0;
    }

    getCurrentSectionId() {
        const segment = this.getSegmentById(this.currentSegmentId || '');
        return segment?.sectionId || this.currentBook?.readingSectionId || this.sections[0]?.id || '';
    }

    getCurrentGeneratedSegment() {
        return this.getSegmentById(this.currentSegmentId || '')?.status === 'done' ? this.getSegmentById(this.currentSegmentId || '') : null;
    }

    /** @param {string} id */
    getSegmentById(id) {
        return this.segments.find(segment => segment.id === id) || null;
    }

    /** @param {string} sectionId */
    getSectionTitle(sectionId) {
        return this.sections.find(section => section.id === sectionId)?.title || 'Section';
    }

    /** @param {BookRecord} book */
    getBookReadPercent(book) {
        if (!book.charCount) return 0;
        return Math.max(0, Math.min(100, Math.round((book.readingCharOffset || 0) / book.charCount * 100)));
    }

    /** @param {number} words */
    estimateDuration(words) {
        return Math.max(1, Math.round(words / ESTIMATED_WORDS_PER_MINUTE * 60 / Math.max(0.25, this.settings.speed || 1)));
    }

    /** @param {string} bookId @param {string} sectionId */
    sectionKey(bookId, sectionId) {
        return `${bookId}:${sectionId}`;
    }

    /** @param {string} bookId @param {string} segmentId */
    segmentKey(bookId, segmentId) {
        return `${bookId}:${segmentId}`;
    }

    /** @param {string} prefix */
    createId(prefix) {
        if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
        return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000000000)}`;
    }

    /** @param {string} text */
    cleanText(text) {
        return text
            .replace(/[\t\f\v]+/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/ {2,}/g, ' ')
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .trim();
    }

    /** @param {string} html */
    sanitizeReaderHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = html;
        const allowedTags = new Set([
            'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CITE', 'CODE', 'DIV', 'EM',
            'FIGCAPTION', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR',
            'I', 'IMG', 'LI', 'OL', 'P', 'PRE', 'SECTION', 'SMALL', 'SPAN',
            'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD',
            'TR', 'U', 'UL'
        ]);
        const allowedAttrs = new Set(['alt', 'colspan', 'href', 'rowspan', 'src', 'title']);
        const elements = Array.from(template.content.querySelectorAll('*'));
        for (const el of elements) {
            if (!allowedTags.has(el.tagName)) {
                el.replaceWith(document.createTextNode(el.textContent || ''));
                continue;
            }
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase();
                const value = attr.value || '';
                const allowed = allowedAttrs.has(name) || name.startsWith('aria-');
                const safeUrl = !['href', 'src'].includes(name) || value.startsWith('data:') || value.startsWith('#') || value.startsWith('http://') || value.startsWith('https://');
                if (!allowed || !safeUrl) el.removeAttribute(attr.name);
            }
            if (el.tagName === 'A') {
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener');
            }
        }
        return template.innerHTML;
    }

    /**
     * @param {string} sanitizedHtml
     * @param {string} query
     */
    highlightSanitizedHtml(sanitizedHtml, query) {
        if (!query) return sanitizedHtml;
        const template = document.createElement('template');
        template.innerHTML = sanitizedHtml;
        const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
        /** @type {Text[]} */
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(/** @type {Text} */ (walker.currentNode));
        const regex = new RegExp(this.escapeRegExp(query), 'gi');
        for (const textNode of textNodes) {
            const value = textNode.nodeValue || '';
            if (!regex.test(value)) continue;
            regex.lastIndex = 0;
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;
            while ((match = regex.exec(value))) {
                fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
                const mark = document.createElement('mark');
                mark.textContent = match[0];
                fragment.appendChild(mark);
                lastIndex = match.index + match[0].length;
            }
            fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
            textNode.replaceWith(fragment);
        }
        return template.innerHTML;
    }

    /** @param {string} path */
    normalizePath(path) {
        const parts = path.split('/').filter(part => part && part !== '.');
        /** @type {string[]} */
        const result = [];
        for (const part of parts) {
            if (part === '..') result.pop();
            else result.push(part);
        }
        return result.join('/');
    }

    /** @param {string} filename */
    getMimeTypeFromFilename(filename) {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const mimeTypes = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            svg: 'image/svg+xml',
            webp: 'image/webp'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    /** @param {Blob} blob */
    async blobToDataUrl(blob) {
        return /** @type {Promise<string>} */ (new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Could not read EPUB image'));
            reader.readAsDataURL(blob);
        }));
    }

    /** @param {string} text */
    countWords(text) {
        return text.split(/\s+/).filter(Boolean).length;
    }

    /** @param {number} bytes */
    formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /** @param {number} seconds */
    formatDuration(seconds) {
        if (!seconds || seconds < 1) return '0s';
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const minutes = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        if (minutes < 60) return secs ? `${minutes}m ${secs}s` : `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }

    /** @param {number} num */
    formatNumber(num) {
        return num.toLocaleString();
    }

    /** @param {Blob} blob @param {string} filename */
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

    /** @param {BookRecord} book @param {AudioSegment} segment */
    segmentFilename(book, segment) {
        return `${this.safeFilename(book.title)}-${String(segment.segmentIndex + 1).padStart(4, '0')}.mp3`;
    }

    /** @param {string} value */
    safeFilename(value) {
        return value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'book';
    }

    /** @param {string} text */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /** @param {string} escapedHtml @param {string} query */
    highlight(escapedHtml, query) {
        if (!query) return escapedHtml;
        const escapedQuery = this.escapeRegExp(this.escapeHtml(query));
        return escapedHtml.replace(new RegExp(`(${escapedQuery})`, 'gi'), '<mark>$1</mark>');
    }

    /** @param {string} value */
    escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /** @param {string} message */
    updateStatus(message) {
        const status = document.getElementById('status');
        if (status) status.textContent = message;
    }

    /** @param {'info' | 'warn' | 'error'} type @param {string} message */
    log(type, message) {
        const logContent = document.getElementById('logContent');
        if (!logContent) return;
        const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
}

document.addEventListener('DOMContentLoaded', () => {
    new BooksController();
});
