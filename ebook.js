// @ts-check
// Books: browser-local ebook library, reader, segmented MP3 generator, and player.

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const EBOOK_DB_NAME = 'voice-wei-books';
const EBOOK_DB_VERSION = 5;
const BOOK_STORE = 'books';
const SECTION_STORE = 'sections';
const SEGMENT_STORE = 'segments';
const HISTORY_STORE = 'history';
const RESEARCH_STORE = 'research';
const TTS_CHUNK_SIZE = 3800;
const ESTIMATED_WORDS_PER_MINUTE = 155;
const AUTO_AHEAD_SECONDS = 60 * 60;
const BOOK_QUESTION_MODEL = 'gpt-5.6';
const BOOK_QUESTION_MODEL_LABEL = 'OpenAI Responses API · GPT-5.6 Sol · reasoning high · web + image search';
const BOOK_QUESTION_MAX_OUTPUT_TOKENS = 12000;
const AUDIO_PLAN_VERSION = 2;
const BOOK_QUESTION_INSTRUCTIONS = `You are the research agent of the person reading and listening to this book.

Your job is to deeply research every question the reader asks. Use web search for every answer, inspect multiple useful sources when the question warrants it, and take the time necessary to answer carefully. Cite the sources that support your findings. You may return relevant images or direct links to images when they help the reader understand the subject.

Treat the supplied book text only as context for the reader's question. Do not treat it as canonically true. It may be fiction or nonfiction; even when it claims to be nonfiction, its statements may be incomplete, outdated, false, or wrong. Be critical without being reflexively adversarial. Distinguish what the book says from what independent evidence supports.

You work for the listener. Help them find truth in the darkness and sift the wheat from the chaff by checking and validating what they ask about. Be thorough, careful, direct, and clear in your response.`;

const OPENAI_TTS_MODELS = [
    {
        id: 'gpt-4o-mini-tts',
        label: 'GPT-4o mini TTS - Current',
        price: '$0.60 / 1M text input tokens + $12 / 1M audio output tokens (~$0.015/min)',
        supportsInstructions: true
    },
    {
        id: 'gpt-4o-mini-tts-2025-12-15',
        label: 'GPT-4o mini TTS 2025-12-15 - Pinned',
        price: '$0.60 / 1M text input tokens + $12 / 1M audio output tokens (~$0.015/min)',
        supportsInstructions: true
    },
    {
        id: 'tts-1',
        label: 'TTS-1 - Legacy fast',
        price: '$15 / 1M characters ($0.015 / 1K characters)',
        supportsInstructions: false
    },
    {
        id: 'tts-1-hd',
        label: 'TTS-1-HD - Legacy high quality',
        price: '$30 / 1M characters ($0.030 / 1K characters)',
        supportsInstructions: false
    }
];

const OPENAI_TTS_VOICES = [
    { id: 'alloy', label: 'Alloy', description: 'Neutral and balanced, good for most content.', legacy: true },
    { id: 'ash', label: 'Ash', description: 'Clear, calm, and grounded.', legacy: true },
    { id: 'ballad', label: 'Ballad', description: 'Expressive and narrative, suited to long-form reading.', legacy: false },
    { id: 'cedar', label: 'Cedar', description: 'Warm and steady for extended listening.', legacy: false },
    { id: 'coral', label: 'Coral', description: 'Bright and conversational.', legacy: true },
    { id: 'echo', label: 'Echo', description: 'Male voice, clear and articulate. Good for non-fiction.', legacy: true },
    { id: 'fable', label: 'Fable', description: 'British accent, warm and expressive. Great for fiction.', legacy: true },
    { id: 'marin', label: 'Marin', description: 'Natural and relaxed for audiobook narration.', legacy: false },
    { id: 'nova', label: 'Nova', description: 'Female voice, warm and conversational. Good for stories.', legacy: true },
    { id: 'onyx', label: 'Onyx', description: 'Deep male voice, authoritative. Good for dramatic content.', legacy: true },
    { id: 'sage', label: 'Sage', description: 'Measured and thoughtful.', legacy: true },
    { id: 'shimmer', label: 'Shimmer', description: 'Soft female voice, gentle and calm. Good for relaxing content.', legacy: true },
    { id: 'verse', label: 'Verse', description: 'Lyrical and expressive.', legacy: false }
];

const OPENAI_TTS_ACCENTS = [
    { id: 'default', label: 'Default', instruction: '' },
    { id: 'american', label: 'American English', instruction: 'Use a natural American English accent.' },
    { id: 'british', label: 'British English', instruction: 'Use a natural British English accent.' },
    { id: 'australian', label: 'Australian English', instruction: 'Use a natural Australian English accent.' },
    { id: 'irish', label: 'Irish English', instruction: 'Use a natural Irish English accent.' },
    { id: 'scottish', label: 'Scottish English', instruction: 'Use a natural Scottish English accent.' },
    { id: 'indian', label: 'Indian English', instruction: 'Use a natural Indian English accent.' },
    { id: 'new-york', label: 'New York English', instruction: 'Use a light New York English accent.' },
    { id: 'southern-us', label: 'Southern US English', instruction: 'Use a light Southern US English accent.' }
];

const OPENAI_TTS_STYLES = [
    { id: 'audiobook', label: 'Audiobook narrator', instruction: 'Read like an attentive audiobook narrator with clear pacing.' },
    { id: 'neutral', label: 'Neutral', instruction: 'Read in a neutral, natural style.' },
    { id: 'dramatic', label: 'Dramatic suspense', instruction: 'Read with dramatic suspense, careful pauses, and rising tension.' },
    { id: 'warm', label: 'Warm storyteller', instruction: 'Read warmly, like a close storyteller.' },
    { id: 'documentary', label: 'Documentary', instruction: 'Read with a calm documentary narration style.' },
    { id: 'bedtime', label: 'Calm bedtime', instruction: 'Read softly and calmly, suitable for relaxed listening.' },
    { id: 'whisper', label: 'Whisper', instruction: 'Read in a quiet whisper while remaining intelligible.' }
];

const VOICE_DESCRIPTIONS = {
    ...Object.fromEntries(OPENAI_TTS_VOICES.map(voice => [voice.id, voice.description]))
};

const VOICE_PREVIEW_TEXT = 'it was a dark and stormy night. The datacenter was centrally located in the data plains of Torrenthia, humming along as usual, blotting out the sound of scraping from beneath.';
const VOICE_SAMPLE_TEXT = VOICE_PREVIEW_TEXT;

/**
 * @typedef {Object} Settings
 * @property {string} voice
 * @property {string} model
 * @property {number} speed
 * @property {string} accent
 * @property {string} style
 * @property {string} instructions
 * @property {boolean} speakAiAnswers
 */

/**
 * @typedef {Object} BookRecord
 * @property {string} id
 * @property {number} schemaVersion
 * @property {number | undefined} audioPlanVersion
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
 * @property {string} [archivedAt]
 * @property {string} readingSectionId
 * @property {number} readingCharOffset
 * @property {string} listeningSegmentId
 * @property {number} listeningOffsetSec
 * @property {Blob | null | undefined} legacyAudioBlob
 * @property {number | undefined} legacyAudioSize
 * @property {string} [contentOrigin]
 * @property {string} [sourceUrl]
 * @property {string} [sourceRequestedUrl]
 * @property {string} [lastFetchedAt]
 * @property {string[]} [sourcePageUrls]
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

/**
 * @typedef {Object} BookHistoryEntry
 * @property {string} id
 * @property {string} bookId
 * @property {string} dateKey
 * @property {string} timestamp
 * @property {string} action
 * @property {string} segmentId
 * @property {string} sectionId
 * @property {number} segmentIndex
 * @property {number} positionSec
 * @property {number} durationSec
 * @property {number} listenedSec
 * @property {number} readSec
 * @property {number} readWords
 * @property {string} detail
 */

/**
 * @typedef {Object} AiResearchRecord
 * @property {string} id
 * @property {string} bookId
 * @property {string} sectionId
 * @property {string} segmentId
 * @property {string} timestamp
 * @property {string} question
 * @property {string} answer
 * @property {string} bookText
 * @property {{ start: number, end: number, url: string, title: string }[]} citations
 * @property {{ url: string, title: string }[]} sources
 * @property {{ imageUrl: string, thumbnailUrl: string, sourceUrl: string, caption: string }[]} images
 * @property {Record<string, any>} request
 * @property {string} modelLabel
 * @property {number} elapsedMs
 * @property {boolean} spokenAtReturn
 */

/**
 * @typedef {Object} WebPage
 * @property {string} url
 * @property {string} title
 * @property {string} text
 * @property {{ text: string, url: string }[]} links
 * @property {boolean} truncated
 */

/**
 * @typedef {Object} UrlImportState
 * @property {string} rootUrl
 * @property {string} requestedUrl
 * @property {WebPage | null} rootPage
 * @property {boolean} building
 * @property {boolean} cancelled
 */

/**
 * @typedef {Object} UrlImportResult
 * @property {{ text: string, url: string }} link
 * @property {WebPage | null} page
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
                if (!db.objectStoreNames.contains(HISTORY_STORE)) {
                    const history = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
                    history.createIndex('bookId', 'bookId');
                    history.createIndex('bookDay', ['bookId', 'dateKey']);
                    history.createIndex('timestamp', 'timestamp');
                }
                if (!db.objectStoreNames.contains(RESEARCH_STORE)) {
                    const research = db.createObjectStore(RESEARCH_STORE, { keyPath: 'id' });
                    research.createIndex('bookId', 'bookId');
                    research.createIndex('timestamp', 'timestamp');
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

    /** @param {string} bookId @param {BookSection[]} sections */
    async replaceSections(bookId, sections) {
        const existing = await this.getSections(bookId);
        for (const section of existing) await this.delete(SECTION_STORE, section.key);
        await this.putSections(sections);
    }

    /** @param {string} bookId */
    async getSegments(bookId) {
        const segments = await /** @type {Promise<AudioSegment[]>} */ (this.getAllByIndex(SEGMENT_STORE, 'bookId', bookId));
        segments.sort((a, b) => a.segmentIndex - b.segmentIndex);
        return segments;
    }

    /** @param {string} bookId @param {AudioSegment[]} segments */
    async replaceSegments(bookId, segments) {
        const existing = await this.getSegments(bookId);
        for (const segment of existing) await this.delete(SEGMENT_STORE, segment.key);
        await this.putSegments(segments);
    }

    /** @param {BookRecord} book @param {BookSection[]} sections @param {AudioSegment[]} segments */
    async replaceBookContent(book, sections, segments) {
        if (!this.db) throw new Error('Books storage is not open');
        await new Promise((resolve, reject) => {
            const tx = this.db.transaction([BOOK_STORE, SECTION_STORE, SEGMENT_STORE], 'readwrite');
            const sectionStore = tx.objectStore(SECTION_STORE);
            const segmentStore = tx.objectStore(SEGMENT_STORE);
            const sectionKeys = sectionStore.index('bookId').getAllKeys(book.id);
            const segmentKeys = segmentStore.index('bookId').getAllKeys(book.id);
            sectionKeys.onsuccess = () => {
                for (const key of sectionKeys.result) sectionStore.delete(key);
                for (const section of sections) sectionStore.put(section);
            };
            segmentKeys.onsuccess = () => {
                for (const key of segmentKeys.result) segmentStore.delete(key);
                for (const segment of segments) segmentStore.put(segment);
            };
            tx.objectStore(BOOK_STORE).put(book);
            tx.oncomplete = () => resolve(undefined);
            tx.onerror = () => reject(tx.error || new Error('Could not replace book audio plan'));
            tx.onabort = () => reject(tx.error || new Error('Book audio plan replacement aborted'));
        });
    }

    /** @param {string} bookId */
    async deleteBookCascade(bookId) {
        const sections = await this.getSections(bookId);
        const segments = await this.getSegments(bookId);
        const history = await this.getHistory(bookId);
        const research = await this.getResearch(bookId);
        for (const section of sections) await this.delete(SECTION_STORE, section.key);
        for (const segment of segments) await this.delete(SEGMENT_STORE, segment.key);
        for (const entry of history) await this.delete(HISTORY_STORE, entry.id);
        for (const entry of research) await this.delete(RESEARCH_STORE, entry.id);
        await this.delete(BOOK_STORE, bookId);
    }

    /** @param {BookHistoryEntry} entry */
    async putHistory(entry) {
        await this.put(HISTORY_STORE, entry);
    }

    /** @param {string} bookId */
    async getHistory(bookId) {
        const entries = await /** @type {Promise<BookHistoryEntry[]>} */ (this.getAllByIndex(HISTORY_STORE, 'bookId', bookId));
        entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return entries;
    }

    /** @param {AiResearchRecord} record */
    async putResearch(record) {
        await this.put(RESEARCH_STORE, record);
    }

    /** @param {string} bookId */
    async getResearch(bookId) {
        const records = await /** @type {Promise<AiResearchRecord[]>} */ (this.getAllByIndex(RESEARCH_STORE, 'bookId', bookId));
        records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return records;
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
        this.settings = {
            voice: 'alloy',
            model: 'gpt-4o-mini-tts',
            speed: 1,
            accent: 'default',
            style: 'audiobook',
            instructions: '',
            speakAiAnswers: false
        };
        /** @type {string | null} */
        this.apiKey = null;
        /** @type {AbortController | null} */
        this.generationAbort = null;
        this.isGenerating = false;
        this.autoGenerateAhead = false;
        /** @type {string[]} Segment IDs awaiting generation (FIFO). */
        this.generationQueue = [];
        this.generationDone = 0;
        this.generationTotal = 0;
        this.generationFailed = 0;
        /** @type {string | null} */
        this.generatingSegmentId = null;
        this.generationCancelled = false;
        this.voiceConfigOpen = false;
        this.rebuildAudioPlanArmed = false;
        this.showArchivedBooks = false;
        this.libraryQuery = '';
        this.readerQuery = '';
        /** @type {UrlImportState | null} */
        this.urlImport = null;
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
        /** @type {HTMLAudioElement | null} */
        this.voiceSampleAudio = null;
        /** @type {string | null} */
        this.voiceSampleUrl = null;
        /** @type {string | null} */
        this.voiceSampleVoice = null;
        /** @type {BookHistoryEntry[]} */
        this.historyEntries = [];
        /** @type {AiResearchRecord[]} */
        this.researchEntries = [];
        this.lastListenHistoryAt = 0;
        this.lastAudioTimeForHistory = 0;
        this.lastReadHistoryAt = 0;
        this.lastReadWordOffset = 0;
        /** @type {VoiceCommandCore | null} */
        this.aiQuestionVoiceCore = null;
        /** @type {string | null} */
        this.aiQuestionSegmentId = null;
        this.aiQuestionInFlight = false;
        /** @type {AbortController | null} */
        this.aiQuestionAbort = null;
        /** @type {ReturnType<typeof setInterval> | null} */
        this.aiQuestionTimer = null;
        this.aiQuestionStartedAt = 0;
        this.aiAnswerSpeaking = false;
        this.aiAnswerSpeechId = 0;
        this.aiAnswerCursor = 0;
        this.lastAiAnswer = '';
        this.bookOpenId = 0;
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
        const storedKey = ApiKeysStore.get('openai');
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
        ApiKeysStore.set('openai', apiKey);
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
        ApiKeysStore.remove('openai');
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
            const storedKey = ApiKeysStore.get('openai');
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
        const snapshot = { ...this.settings };
        SettingsStore.load(StorageKeys.EBOOK_SETTINGS, snapshot, ['voice', 'model', 'speed', 'accent', 'style', 'instructions', 'speakAiAnswers']);
        this.settings = this.normalizeTtsSettings(snapshot);
        this.populateTtsModelOptions();
        this.populateTtsVoiceOptions();
        this.syncTtsControls();
    }

    saveSettings() {
        SettingsStore.save(StorageKeys.EBOOK_SETTINGS, this.settings, ['voice', 'model', 'speed', 'accent', 'style', 'instructions', 'speakAiAnswers']);
    }

    /** @param {Settings} settings */
    normalizeTtsSettings(settings) {
        const model = OPENAI_TTS_MODELS.some(item => item.id === settings.model) ? settings.model : 'gpt-4o-mini-tts';
        const speed = Number.isFinite(settings.speed) ? Math.max(0.25, Math.min(4, settings.speed)) : 1;
        const voices = this.getVoicesForModel(model);
        const voice = voices.some(item => item.id === settings.voice) ? settings.voice : 'alloy';
        return {
            voice,
            model,
            speed,
            accent: OPENAI_TTS_ACCENTS.some(item => item.id === settings.accent) ? settings.accent : 'default',
            style: OPENAI_TTS_STYLES.some(item => item.id === settings.style) ? settings.style : 'audiobook',
            instructions: typeof settings.instructions === 'string' ? settings.instructions : '',
            speakAiAnswers: Boolean(settings.speakAiAnswers)
        };
    }

    populateTtsModelOptions() {
        for (const modelEl of this.getTtsModelSelects()) {
            modelEl.innerHTML = OPENAI_TTS_MODELS
                .map(model => `<option value="${this.escapeHtml(model.id)}">${this.escapeHtml(model.label)} · ${this.escapeHtml(model.price)}</option>`)
                .join('');
        }
    }

    populateTtsVoiceOptions() {
        const voices = this.getVoicesForModel(this.settings.model);
        for (const voiceEl of this.getTtsVoiceSelects()) {
            voiceEl.innerHTML = voices
                .map(voice => `<option value="${this.escapeHtml(voice.id)}">${this.escapeHtml(voice.label)} - ${this.escapeHtml(voice.description)}</option>`)
                .join('');
        }
    }

    populateTtsAccentOptions() {
        for (const accentEl of this.getTtsAccentSelects()) {
            accentEl.innerHTML = OPENAI_TTS_ACCENTS
                .map(accent => `<option value="${this.escapeHtml(accent.id)}">${this.escapeHtml(accent.label)}</option>`)
                .join('');
        }
    }

    populateTtsStyleOptions() {
        for (const styleEl of this.getTtsStyleSelects()) {
            styleEl.innerHTML = OPENAI_TTS_STYLES
                .map(style => `<option value="${this.escapeHtml(style.id)}">${this.escapeHtml(style.label)}</option>`)
                .join('');
        }
    }

    syncTtsControls() {
        this.settings = this.normalizeTtsSettings(this.settings);
        this.populateTtsModelOptions();
        this.populateTtsVoiceOptions();
        this.populateTtsAccentOptions();
        this.populateTtsStyleOptions();
        for (const voiceEl of this.getTtsVoiceSelects()) voiceEl.value = this.settings.voice;
        for (const modelEl of this.getTtsModelSelects()) modelEl.value = this.settings.model;
        for (const speedValueEl of this.getTtsSpeedValueEls()) speedValueEl.textContent = `${this.formatSpeed(this.settings.speed)}x`;
        for (const speedButton of this.getTtsSpeedButtons()) {
            const step = parseFloat(speedButton.getAttribute('data-tts-speed-step') || '0');
            speedButton.disabled = step < 0 ? this.settings.speed <= 0.25 : this.settings.speed >= 4;
        }
        const supportsInstructions = this.ttsModelSupportsInstructions();
        for (const accentEl of this.getTtsAccentSelects()) {
            accentEl.value = this.settings.accent;
            accentEl.disabled = !supportsInstructions;
        }
        for (const styleEl of this.getTtsStyleSelects()) {
            styleEl.value = this.settings.style;
            styleEl.disabled = !supportsInstructions;
        }
        for (const instructionsEl of this.getTtsInstructionEls()) {
            instructionsEl.value = this.settings.instructions;
            instructionsEl.disabled = !supportsInstructions;
        }
        this.updateModelPricing();
        this.updateVoiceDescription();
        this.updateCurrentVoiceSummary();
        this.renderVoiceSampleButtons();
        this.syncVoiceConfigPanel();
    }

    getTtsVoiceSelects() {
        return ['ttsVoice', 'generatorTtsVoice']
            .map(id => /** @type {HTMLSelectElement | null} */ (document.getElementById(id)))
            .filter(/** @returns {item is HTMLSelectElement} */ item => Boolean(item));
    }

    getTtsModelSelects() {
        return ['ttsModel', 'generatorTtsModel']
            .map(id => /** @type {HTMLSelectElement | null} */ (document.getElementById(id)))
            .filter(/** @returns {item is HTMLSelectElement} */ item => Boolean(item));
    }

    getTtsSpeedValueEls() {
        return ['ttsSpeedValue', 'generatorTtsSpeedValue']
            .map(id => document.getElementById(id))
            .filter(/** @returns {item is HTMLElement} */ item => Boolean(item));
    }

    getTtsSpeedButtons() {
        return Array.from(document.querySelectorAll('[data-tts-speed-step]'))
            .filter(/** @returns {item is HTMLButtonElement} */ item => item instanceof HTMLButtonElement);
    }

    getTtsAccentSelects() {
        return ['ttsAccent', 'generatorTtsAccent']
            .map(id => /** @type {HTMLSelectElement | null} */ (document.getElementById(id)))
            .filter(/** @returns {item is HTMLSelectElement} */ item => Boolean(item));
    }

    getTtsStyleSelects() {
        return ['ttsStyle', 'generatorTtsStyle']
            .map(id => /** @type {HTMLSelectElement | null} */ (document.getElementById(id)))
            .filter(/** @returns {item is HTMLSelectElement} */ item => Boolean(item));
    }

    getTtsInstructionEls() {
        return ['ttsInstructions', 'generatorTtsInstructions']
            .map(id => /** @type {HTMLTextAreaElement | null} */ (document.getElementById(id)))
            .filter(/** @returns {item is HTMLTextAreaElement} */ item => Boolean(item));
    }

    /** @param {string} model */
    getVoicesForModel(model) {
        if (model.startsWith('gpt-4o-mini-tts')) return OPENAI_TTS_VOICES;
        return OPENAI_TTS_VOICES.filter(voice => voice.legacy);
    }

    ttsModelSupportsInstructions() {
        return OPENAI_TTS_MODELS.find(item => item.id === this.settings.model)?.supportsInstructions || false;
    }

    getSelectedTtsModel() {
        return OPENAI_TTS_MODELS.find(item => item.id === this.settings.model) || OPENAI_TTS_MODELS[0];
    }

    updateModelPricing() {
        const model = this.getSelectedTtsModel();
        const message = `${model.label}: ${model.price}. Prices are from OpenAI API pricing and may change.`;
        for (const el of ['modelPricingDescription', 'generatorModelPricingDescription'].map(id => document.getElementById(id))) {
            if (el) el.textContent = message;
        }
    }

    updateVoiceDescription() {
        const descEl = document.getElementById('voiceDescription');
        const generatorDescEl = document.getElementById('generatorVoiceDescription');
        const description = VOICE_DESCRIPTIONS[this.settings.voice] || '';
        const instructionNote = this.ttsModelSupportsInstructions()
            ? 'Narration instructions will be sent with conversion requests.'
            : 'Narration instructions are disabled for legacy TTS models.';
        if (descEl) descEl.textContent = description;
        if (generatorDescEl) generatorDescEl.textContent = `${description} ${instructionNote} Voice samples use the current model, speed, and instructions.`;
    }

    updateCurrentVoiceSummary() {
        const summaryEl = document.getElementById('currentVoiceSummary');
        if (summaryEl) summaryEl.textContent = this.settingsSummary(this.settings);
    }

    renderVoiceSampleButtons() {
        const grid = document.getElementById('voiceSampleGrid');
        if (!grid) return;
        const voices = this.getVoicesForModel(this.settings.model);
        grid.innerHTML = voices.map(voice => {
            const selected = voice.id === this.settings.voice ? ' selected' : '';
            const playing = voice.id === this.voiceSampleVoice && this.voiceSampleAudio && !this.voiceSampleAudio.paused ? ' playing' : '';
            return `<button class="vf-btn${selected}${playing}" type="button" data-voice-sample="${this.escapeHtml(voice.id)}">${this.escapeHtml(voice.label)}</button>`;
        }).join('');
    }

    /** @param {Event} event */
    handleVoiceSampleClick(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const button = target?.closest('[data-voice-sample]');
        const voice = button?.getAttribute('data-voice-sample');
        if (voice) this.playVoiceSample(voice);
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
                const storedKey = ApiKeysStore.get('openai');
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
        const previewBtn = document.getElementById('previewVoiceBtn');
        for (const voiceEl of this.getTtsVoiceSelects()) {
            voiceEl.addEventListener('change', () => {
                this.settings.voice = voiceEl.value;
                this.saveSettings();
                this.syncTtsControls();
            });
        }
        for (const modelEl of this.getTtsModelSelects()) {
            modelEl.addEventListener('change', () => {
                this.settings.model = modelEl.value;
                this.settings = this.normalizeTtsSettings(this.settings);
                this.saveSettings();
                this.syncTtsControls();
            });
        }
        for (const speedButton of this.getTtsSpeedButtons()) {
            speedButton.addEventListener('click', () => {
                const step = parseFloat(speedButton.getAttribute('data-tts-speed-step') || '0');
                this.setTtsSpeed(this.settings.speed + step);
            });
        }
        for (const accentEl of this.getTtsAccentSelects()) {
            accentEl.addEventListener('change', () => {
                this.settings.accent = accentEl.value;
                this.saveSettings();
                this.syncTtsControls();
            });
        }
        for (const styleEl of this.getTtsStyleSelects()) {
            styleEl.addEventListener('change', () => {
                this.settings.style = styleEl.value;
                this.saveSettings();
                this.syncTtsControls();
            });
        }
        for (const instructionsEl of this.getTtsInstructionEls()) {
            instructionsEl.addEventListener('input', () => {
                this.settings.instructions = instructionsEl.value;
                this.saveSettings();
                for (const peerEl of this.getTtsInstructionEls()) {
                    if (peerEl !== instructionsEl) peerEl.value = this.settings.instructions;
                }
                this.updateVoiceDescription();
            });
        }
        if (previewBtn) previewBtn.addEventListener('click', () => this.previewVoice());
    }

    /** @param {number} speed */
    setTtsSpeed(speed) {
        const stepped = Math.round(speed * 10) / 10;
        this.settings.speed = Math.max(0.25, Math.min(4, stepped));
        this.saveSettings();
        this.syncTtsControls();
    }

    toggleVoiceConfigPanel() {
        this.voiceConfigOpen = !this.voiceConfigOpen;
        this.syncVoiceConfigPanel();
    }

    syncVoiceConfigPanel() {
        const panel = document.getElementById('voiceConfigPanel');
        const button = document.getElementById('toggleVoiceConfigBtn');
        if (panel) panel.style.display = this.voiceConfigOpen ? 'block' : 'none';
        if (button) button.textContent = this.voiceConfigOpen ? 'Hide voice config' : 'Configure voice';
    }

    setupLibraryUI() {
        const uploadButton = document.getElementById('uploadButton');
        const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('fileInput'));
        const savedBookList = document.getElementById('savedBookList');
        const librarySearch = /** @type {HTMLInputElement | null} */ (document.getElementById('librarySearch'));
        this.bindButton('toggleArchiveViewBtn', () => this.toggleArchiveView());
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
        this.setupUrlImportUI();
    }

    setupUrlImportUI() {
        const urlInput = /** @type {HTMLInputElement | null} */ (document.getElementById('urlInput'));
        this.bindButton('importUrlButton', () => this.startUrlImport());
        if (urlInput) {
            urlInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.startUrlImport();
                }
            });
        }
        this.bindButton('urlImportSubmitBtn', () => this.submitUrlImport());
        this.bindButton('urlImportCancelBtn', () => this.cancelUrlImport());
        this.bindButton('urlImportSelectAll', () => this.setAllUrlImportLinks(true));
        this.bindButton('urlImportSelectNone', () => this.setAllUrlImportLinks(false));
        this.bindButton('urlImportInvert', () => this.invertUrlImportLinks());
        const filter = /** @type {HTMLInputElement | null} */ (document.getElementById('urlImportFilter'));
        if (filter) filter.addEventListener('input', () => this.filterUrlImportLinks(filter.value.trim().toLowerCase()));
    }

    setupWorkspaceUI() {
        const readerView = document.getElementById('readerView');
        const readerSearch = /** @type {HTMLInputElement | null} */ (document.getElementById('readerSearch'));
        const readerSearchClearBtn = document.getElementById('readerSearchClearBtn');
        const readerFullscreenBtn = document.getElementById('readerFullscreenBtn');
        const autoToggle = /** @type {HTMLInputElement | null} */ (document.getElementById('autoGenerateAheadToggle'));
        this.bindButton('toggleVoiceConfigBtn', () => this.toggleVoiceConfigPanel());
        if (readerView) readerView.addEventListener('click', e => this.handleReaderClick(e));
        const chapterStatusList = document.getElementById('chapterStatusList');
        if (chapterStatusList) {
            chapterStatusList.addEventListener('click', e => this.handleSegmentTargetClick(e, { autoplay: true }));
        }
        const voiceSampleGrid = document.getElementById('voiceSampleGrid');
        if (voiceSampleGrid) voiceSampleGrid.addEventListener('click', e => this.handleVoiceSampleClick(e));
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
            if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.shouldHandleSegmentArrow(e)) {
                e.preventDefault();
                this.playAdjacentGenerated(e.key === 'ArrowRight' ? 1 : -1);
            }
        });
        if (autoToggle) {
            autoToggle.addEventListener('change', () => {
                this.autoGenerateAhead = autoToggle.checked;
                if (this.autoGenerateAhead) this.ensureGeneratedAhead();
            });
        }
        const chapterSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('generationChapterSelect'));
        if (chapterSelect) {
            chapterSelect.addEventListener('change', () => {
                const sectionId = chapterSelect.value;
                const segment = this.segments.find(item => item.sectionId === sectionId);
                if (!segment) return;
                this.currentSegmentId = segment.id;
                this.renderWorkspace();
            });
        }
        this.bindButton('goToLatestReadBtn', () => this.goToLatestRead());
        this.bindButton('goToPlayingSectionBtn', () => this.goToPlayingSection());
        this.bindButton('generateNext15Btn', () => this.generateNextDuration(15 * 60, false));
        this.bindButton('generateNext60Btn', () => this.generateNextDuration(60 * 60, false));
        this.bindButton('generatePreviousChapterBtn', () => this.generatePreviousChapter());
        this.bindButton('generateCurrentChapterBtn', () => this.generateCurrentChapter());
        this.bindButton('generateNextChapterBtn', () => this.generateNextChapter());
        this.bindButton('generateSelectedChapterBtn', () => this.generateSelectedChapter());
        this.bindButton('generateCurrentChunkBtn', () => this.generateCurrentChunk());
        this.bindButton('generateAllBtn', () => this.generateAllRemaining());
        this.bindButton('cancelGenerationBtn', () => this.cancelGeneration());
        this.bindButton('downloadOriginalBtn', () => this.downloadCurrentOriginal());
        this.bindButton('downloadCurrentChapterBtn', () => this.downloadCurrentChapter());
        this.bindButton('downloadCurrentSegmentBtn', () => this.downloadCurrentSegment());
        this.bindButton('downloadAllSegmentsBtn', () => this.downloadAllSegments());
        this.bindButton('downloadCombinedBtn', () => this.downloadCombinedSegments());
        this.bindButton('toggleArchiveCurrentBookBtn', () => this.toggleCurrentBookArchive());
        this.bindButton('deleteCurrentSegmentAudioBtn', () => this.deleteCurrentSegmentAudio());
        this.bindButton('deleteAllAudioBtn', () => this.deleteCurrentBookAudio());
        this.bindButton('rebuildAudioPlanBtn', () => this.requestRebuildAudioPlan());
        this.bindButton('backToLibraryBtn', () => this.backToLibrary());
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
    }

    setupPlayerUI() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (audio) {
            audio.addEventListener('timeupdate', () => this.handleAudioTimeUpdate());
            audio.addEventListener('ended', () => this.handleAudioEnded());
            audio.addEventListener('loadedmetadata', () => this.handleAudioMetadataLoaded());
            audio.addEventListener('play', () => this.handleAudioPlay());
            audio.addEventListener('pause', () => this.handleAudioPause());
        }
        this.bindButton('playFromProgressBtn', () => this.playFromProgress());
        this.bindButton('previousSegmentBtn', () => this.playAdjacentGenerated(-1));
        this.bindButton('nextSegmentBtn', () => this.playAdjacentGenerated(1));
        this.bindButton('playPauseBtn', () => this.togglePlayPause());
        this.bindButton('back30Btn', () => this.seekRelative(-30, 'back-30'));
        this.bindButton('forward30Btn', () => this.seekRelative(30, 'forward-30'));
        this.bindButton('quadraticBackBtn', () => this.quadraticSeek(-1));
        this.bindButton('quadraticForwardBtn', () => this.quadraticSeek(1));
        const seekTrack = document.getElementById('playerSeekTrack');
        if (seekTrack) seekTrack.addEventListener('click', e => this.handleSeekTrackClick(e));
        this.bindButton('showHistoryBtn', () => this.showHistoryPanel(true));
        this.bindButton('hideHistoryBtn', () => this.showHistoryPanel(false));
        this.setupAiQuestionUI();
    }

    /** @param {string} id @param {() => void} handler */
    bindButton(id, handler) {
        const button = document.getElementById(id);
        if (button) button.addEventListener('click', handler);
    }

    setupAiQuestionUI() {
        const speakToggles = ['speakAiAnswersToggle', 'settingsSpeakAiAnswersToggle']
            .map(id => /** @type {HTMLInputElement | null} */ (document.getElementById(id)))
            .filter(/** @returns {toggle is HTMLInputElement} */ toggle => Boolean(toggle));
        for (const speakToggle of speakToggles) {
            speakToggle.checked = this.settings.speakAiAnswers;
            speakToggle.addEventListener('change', () => {
                this.settings.speakAiAnswers = speakToggle.checked;
                this.saveSettings();
                for (const peer of speakToggles) peer.checked = this.settings.speakAiAnswers;
                if (!this.settings.speakAiAnswers && this.aiAnswerSpeaking) this.stopAiAnswerSpeech();
            });
        }
        this.bindButton('aiQuestionBtn', () => this.toggleAiQuestionListening());
        this.bindButton('askAiQuestionBtn', () => this.askAiQuestionFromInput());
        this.bindButton('closeAiQuestionBtn', () => this.closeAiQuestionPanel());
        this.bindButton('repeatAiAnswerBtn', () => this.toggleAiAnswerSpeech());
        const answerNavigation = document.getElementById('aiAnswerNavigation');
        if (answerNavigation) answerNavigation.addEventListener('click', event => this.handleAiAnswerNavigation(event));
        const researchHistory = document.getElementById('aiResearchHistoryList');
        if (researchHistory) researchHistory.addEventListener('click', event => this.handleAiResearchHistoryClick(event));
        const input = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('aiQuestionInput'));
        if (input) {
            input.addEventListener('input', () => this.renderAiQuestionRequestPreview());
            input.addEventListener('keydown', event => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    this.askAiQuestionFromInput();
                }
            });
        }

        if (typeof VoiceCommandCore === 'undefined') {
            this.updateAiQuestionStatus('Voice questions are unavailable in this browser; type a question instead.');
            return;
        }
        this.aiQuestionVoiceCore = new VoiceCommandCore({
            settings: { autoSubmitMode: true },
            uiIds: {
                listenBtn: 'aiQuestionListenBtn',
                submitBtn: 'aiQuestionVoiceSubmitBtn',
                statusEl: 'aiQuestionVoiceStatus',
                transcriptContainer: 'aiQuestionTranscriptContainer',
                transcriptText: 'aiQuestionTranscript'
            },
            onBeforeListen: () => this.prepareAiQuestion(),
            onListeningChange: listening => this.renderAiQuestionListening(listening),
            onError: message => this.updateAiQuestionStatus(message),
            fallbackHandler: async transcript => {
                const questionInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('aiQuestionInput'));
                if (questionInput) questionInput.value = transcript;
                await this.askAiQuestion(transcript);
            }
        });
        this.aiQuestionVoiceCore.init();
        const route = document.getElementById('aiResearchRoute');
        if (route) route.textContent = BOOK_QUESTION_MODEL_LABEL;
        this.updateAiQuestionStatus('Tap AI question and speak, or type here and press Research.');
    }

    toggleAiQuestionListening() {
        if (!this.prepareAiQuestion()) return;
        if (!this.aiQuestionVoiceCore?.recognition) {
            const input = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('aiQuestionInput'));
            input?.focus();
            this.updateAiQuestionStatus('Voice recognition is unavailable; type a question and press Research.');
            return;
        }
        if (this.aiQuestionVoiceCore.isListening) {
            this.aiQuestionVoiceCore.stopListening();
        } else {
            this.aiQuestionVoiceCore.startListening();
        }
    }

    /** @returns {boolean} */
    prepareAiQuestion() {
        const segment = this.getAiQuestionSourceSegment();
        if (!segment) {
            this.updateStatus('Open a book audio context before asking a question');
            return false;
        }
        this.aiQuestionSegmentId = segment.id;
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (audio && !audio.paused) audio.pause();
        if (typeof VoiceOutput !== 'undefined') VoiceOutput.stop();
        const panel = document.getElementById('aiQuestionPanel');
        const context = document.getElementById('aiQuestionContextText');
        const label = document.getElementById('aiQuestionContextLabel');
        if (panel) panel.style.display = 'grid';
        if (context) context.textContent = segment.text;
        if (label) {
            label.textContent = `${this.getSectionTitle(segment.sectionId)} · ${segment.text.length.toLocaleString()} characters of current audio context sent`;
        }
        this.renderAiQuestionRequestPreview();
        return true;
    }

    /** @returns {AudioSegment | null} */
    getAiQuestionSourceSegment() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        const segmentId = audio?.dataset.segmentId || this.currentSegmentId || '';
        return this.getSegmentById(segmentId);
    }

    renderAiQuestionListening(listening) {
        const button = document.getElementById('aiQuestionBtn');
        const text = button?.querySelector('.button-text');
        button?.classList.toggle('listening', listening);
        if (text) text.textContent = listening ? 'Listening...' : 'AI question';
        if (listening) {
            this.updateAiQuestionStatus('Listening...');
        } else if (!this.aiQuestionInFlight) {
            this.updateAiQuestionStatus('Tap AI question and speak, or type here and press Research.');
        }
    }

    closeAiQuestionPanel() {
        this.aiQuestionVoiceCore?.stopListening();
        this.aiQuestionAbort?.abort();
        this.aiQuestionAbort = null;
        this.aiQuestionInFlight = false;
        this.stopAiQuestionTimer(true);
        this.setAiQuestionBusy(false);
        this.stopAiAnswerSpeech();
        const panel = document.getElementById('aiQuestionPanel');
        if (panel) panel.style.display = 'none';
        this.renderAiQuestionListening(false);
    }

    async askAiQuestionFromInput() {
        const input = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('aiQuestionInput'));
        this.aiQuestionVoiceCore?.stopListening();
        await this.askAiQuestion(input?.value.trim() || '');
    }

    /** @param {string} question */
    async askAiQuestion(question) {
        if (this.aiQuestionInFlight) return;
        if (!question) {
            this.updateAiQuestionStatus('Say or type a question first.');
            return;
        }
        if (!this.apiKey) {
            this.showApiKeyOverlay();
            this.updateAiQuestionStatus('OpenAI API key required.');
            return;
        }
        const segment = this.getSegmentById(this.aiQuestionSegmentId || '');
        if (!segment) {
            this.updateAiQuestionStatus('The source book context is no longer available.');
            return;
        }
        const input = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('aiQuestionInput'));
        if (input) input.value = question;
        this.renderAiQuestionRequestPreview();
        this.aiQuestionInFlight = true;
        const abort = new AbortController();
        this.aiQuestionAbort = abort;
        this.setAiQuestionBusy(true);
        this.startAiQuestionTimer();
        this.stopAiAnswerSpeech();
        const answerContainer = document.getElementById('aiQuestionAnswer');
        if (answerContainer) answerContainer.style.display = 'none';
        try {
            const requestBody = this.buildAiQuestionRequest(question, segment);
            const response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                signal: abort.signal,
                body: JSON.stringify(requestBody)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
            }
            const data = await response.json();
            if (abort.signal.aborted || this.currentBook?.id !== segment.bookId) return;
            if (data.status === 'incomplete') {
                throw new Error(`OpenAI response incomplete: ${data.incomplete_details?.reason || 'output limit reached'}`);
            }
            const result = this.extractOpenAiResearchResult(data);
            const elapsed = this.stopAiQuestionTimer();
            this.lastAiAnswer = result.answer;
            this.renderAiResearchResult(result);
            this.renderAiQuestionElapsedTotal(elapsed);
            let saved = true;
            try {
                await this.persistAiResearch(question, segment, requestBody, result, elapsed);
            } catch (error) {
                saved = false;
                const message = error instanceof Error ? error.message : String(error);
                this.log('error', `Could not save AI research: ${message}`);
            }
            this.updateAiQuestionStatus(saved
                ? `Answered and saved · ${BOOK_QUESTION_MODEL_LABEL}.`
                : `Answered by ${BOOK_QUESTION_MODEL_LABEL}, but local saving failed.`);
            this.recordHistory('ai-question', question);
            this.log('info', `AI question: ${question}`);
            if (this.settings.speakAiAnswers && typeof VoiceOutput !== 'undefined') {
                this.startAiAnswerSpeech();
            }
        } catch (error) {
            if (abort.signal.aborted) return;
            const elapsed = this.stopAiQuestionTimer();
            const message = error instanceof Error ? error.message : String(error);
            this.renderAiQuestionElapsedTotal(elapsed);
            this.updateAiQuestionStatus(`Research failed: ${message}`);
            this.log('error', `AI question failed: ${message}`);
        } finally {
            if (this.aiQuestionAbort === abort) {
                this.stopAiQuestionTimer(false);
                this.aiQuestionAbort = null;
                this.aiQuestionInFlight = false;
                this.setAiQuestionBusy(false);
            }
        }
    }

    /** @param {string} question @param {AudioSegment} segment @param {string} [bookText] */
    buildAiQuestionRequest(question, segment, bookText = segment.text) {
        return {
            model: BOOK_QUESTION_MODEL,
            reasoning: { effort: 'high' },
            tools: [{
                type: 'web_search',
                search_context_size: 'high',
                search_content_types: ['image', 'text'],
                image_settings: {
                    max_results: 6,
                    caption: true
                }
            }],
            tool_choice: 'required',
            include: ['web_search_call.results', 'web_search_call.action.sources'],
            max_output_tokens: BOOK_QUESTION_MAX_OUTPUT_TOKENS,
            instructions: BOOK_QUESTION_INSTRUCTIONS,
            input: this.buildAiQuestionPrompt(question, segment, bookText)
        };
    }

    /** @param {string} question @param {AudioSegment} segment @param {string} bookText */
    buildAiQuestionPrompt(question, segment, bookText) {
        return [
            `Reader question: ${question}`,
            '',
            `Book: ${this.currentBook?.title || 'Unknown title'}`,
            `Author: ${this.currentBook?.author || 'Unknown author'}`,
            `Chapter or section: ${this.getSectionTitle(segment.sectionId)}`,
            '',
            'Full text of the current audio context:',
            bookText
        ].join('\n');
    }

    /**
     * @param {string} question
     * @param {AudioSegment} segment
     * @param {Record<string, any>} request
     * @param {{ answer: string, citations: { start: number, end: number, url: string, title: string }[], sources: { url: string, title: string }[], images: { imageUrl: string, thumbnailUrl: string, sourceUrl: string, caption: string }[] }} result
     * @param {number} elapsedMs
     */
    async persistAiResearch(question, segment, request, result, elapsedMs) {
        if (!this.storage || !this.currentBook) throw new Error('Books storage unavailable');
        /** @type {AiResearchRecord} */
        const record = {
            id: this.createId('research'),
            bookId: this.currentBook.id,
            sectionId: segment.sectionId,
            segmentId: segment.id,
            timestamp: new Date().toISOString(),
            question,
            answer: result.answer,
            bookText: segment.text,
            citations: result.citations,
            sources: result.sources,
            images: result.images,
            request,
            modelLabel: BOOK_QUESTION_MODEL_LABEL,
            elapsedMs,
            spokenAtReturn: this.settings.speakAiAnswers
        };
        await this.storage.putResearch(record);
        this.researchEntries.unshift(record);
        this.renderAiResearchHistory();
    }

    renderAiResearchHistory() {
        const count = document.getElementById('aiResearchHistoryCount');
        const list = document.getElementById('aiResearchHistoryList');
        if (count) count.textContent = String(this.researchEntries.length);
        if (!list) return;
        if (!this.researchEntries.length) {
            list.innerHTML = '<div class="chapter-status-empty">No saved research yet.</div>';
            return;
        }
        list.innerHTML = this.researchEntries.map(record => `
            <button class="ai-research-history-item" type="button" data-research-id="${this.escapeHtml(record.id)}">
                <span>${this.escapeHtml(record.question)}</span>
                <small>${this.escapeHtml(new Date(record.timestamp).toLocaleString())}</small>
            </button>
        `).join('');
    }

    /** @param {Event} event */
    handleAiResearchHistoryClick(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const button = target?.closest('[data-research-id]');
        const id = button?.getAttribute('data-research-id');
        const record = this.researchEntries.find(entry => entry.id === id);
        if (record) this.loadAiResearchRecord(record);
    }

    /** @param {AiResearchRecord} record */
    loadAiResearchRecord(record) {
        this.stopAiAnswerSpeech();
        const segment = this.getSegmentById(record.segmentId);
        this.aiQuestionSegmentId = record.segmentId;
        this.lastAiAnswer = record.answer;
        const panel = document.getElementById('aiQuestionPanel');
        const input = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('aiQuestionInput'));
        const context = document.getElementById('aiQuestionContextText');
        const preview = document.getElementById('aiQuestionRequestPreview');
        if (panel) panel.style.display = 'grid';
        if (input) input.value = record.question;
        if (context) context.textContent = record.bookText;
        if (preview) {
            const request = { ...record.request };
            const marker = 'Full text of the current audio context:\n';
            const markerIndex = typeof request.input === 'string' ? request.input.indexOf(marker) : -1;
            if (markerIndex !== -1) {
                request.input = `${request.input.slice(0, markerIndex + marker.length)}[Full current book context shown separately below — ${record.bookText.length.toLocaleString()} characters]`;
            }
            preview.textContent = [
                'SAVED REQUEST',
                `Recorded ${new Date(record.timestamp).toLocaleString()}`,
                '',
                JSON.stringify(request, null, 2)
            ].join('\n');
        }
        this.renderAiResearchResult({
            answer: record.answer,
            citations: record.citations,
            sources: record.sources,
            images: record.images
        });
        this.renderAiQuestionElapsedTotal(record.elapsedMs);
        this.updateAiQuestionStatus(`Saved research · ${record.modelLabel}.`);
    }

    renderAiQuestionRequestPreview() {
        const preview = document.getElementById('aiQuestionRequestPreview');
        const segment = this.getSegmentById(this.aiQuestionSegmentId || '');
        if (!preview || !segment) return;
        const questionInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('aiQuestionInput'));
        const request = this.buildAiQuestionRequest(
            questionInput?.value.trim() || '[Your spoken or typed question]',
            segment,
            `[Full current book context shown separately below — ${segment.text.length.toLocaleString()} characters]`
        );
        preview.textContent = [
            'POST https://api.openai.com/v1/responses',
            'Authorization: browser-stored OpenAI key',
            'Content-Type: application/json',
            '',
            'EXACT REQUEST BODY (only the separately shown book context is replaced)',
            JSON.stringify(request, null, 2)
        ].join('\n');
    }

    /**
     * @param {any} data
     * @returns {{ answer: string, citations: { start: number, end: number, url: string, title: string }[], sources: { url: string, title: string }[], images: { imageUrl: string, thumbnailUrl: string, sourceUrl: string, caption: string }[] }}
     */
    extractOpenAiResearchResult(data) {
        const contentParts = (data.output || []).flatMap(item => item.content || []);
        const answer = typeof data.output_text === 'string' && data.output_text.trim()
            ? data.output_text.trim()
            : contentParts.map(part => part.text || '').join('').trim();
        if (!answer) throw new Error('OpenAI response did not contain an answer');

        const sourceMap = new Map();
        const citations = [];
        let contentOffset = 0;
        for (const part of contentParts) {
            for (const annotation of part.annotations || []) {
                if (annotation.type !== 'url_citation' || !this.isPublicHttpUrl(annotation.url)) continue;
                sourceMap.set(annotation.url, { url: annotation.url, title: annotation.title || annotation.url });
                citations.push({
                    start: contentOffset + annotation.start_index,
                    end: contentOffset + annotation.end_index,
                    url: annotation.url,
                    title: annotation.title || annotation.url
                });
            }
            contentOffset += (part.text || '').length;
        }
        for (const item of data.output || []) {
            for (const source of item.action?.sources || []) {
                if (!this.isPublicHttpUrl(source.url) || sourceMap.has(source.url)) continue;
                sourceMap.set(source.url, { url: source.url, title: source.url });
            }
        }

        const images = [];
        const seenImages = new Set();
        for (const item of data.output || []) {
            for (const result of item.results || []) {
                if (result.type !== 'image_result' || !this.isPublicHttpsUrl(result.image_url) || seenImages.has(result.image_url)) continue;
                seenImages.add(result.image_url);
                images.push({
                    imageUrl: result.image_url,
                    thumbnailUrl: this.isPublicHttpsUrl(result.thumbnail_url) ? result.thumbnail_url : result.image_url,
                    sourceUrl: this.isPublicHttpUrl(result.source_website_url) ? result.source_website_url : result.image_url,
                    caption: result.caption || 'Research image'
                });
            }
        }
        return { answer, citations, sources: Array.from(sourceMap.values()), images };
    }

    /** @param {string} value */
    isPublicHttpUrl(value) {
        if (typeof value !== 'string') return false;
        try {
            const url = new URL(value);
            return (url.protocol === 'https:' || url.protocol === 'http:')
                && !url.username
                && !url.password
                && !this.isPrivateNetworkHostname(url.hostname);
        } catch (_error) {
            return false;
        }
    }

    /** @param {string} value */
    isPublicHttpsUrl(value) {
        if (!this.isPublicHttpUrl(value)) return false;
        return new URL(value).protocol === 'https:';
    }

    /** @param {string} hostname */
    isPrivateNetworkHostname(hostname) {
        const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
        if (host === '::' || host === '::1' || host.startsWith('::ffff:') || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
        const octets = host.split('.').map(part => Number(part));
        if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
        const [a, b] = octets;
        return a === 0
            || a === 10
            || a === 127
            || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19));
    }

    /** @param {{ answer: string, citations: { start: number, end: number, url: string, title: string }[], sources: { url: string, title: string }[], images: { imageUrl: string, thumbnailUrl: string, sourceUrl: string, caption: string }[] }} result */
    renderAiResearchResult(result) {
        const container = document.getElementById('aiQuestionAnswer');
        const textEl = document.getElementById('aiQuestionAnswerText');
        if (container) container.style.display = 'block';
        if (textEl) {
            textEl.textContent = '';
            const segmenter = new (/** @type {any} */ (Intl).Segmenter)(undefined, { granularity: 'sentence' });
            for (const sentence of segmenter.segment(result.answer)) {
                if (!sentence.segment.trim()) {
                    textEl.append(document.createTextNode(sentence.segment));
                    continue;
                }
                const span = document.createElement('span');
                span.className = 'ai-answer-sentence';
                const start = sentence.index;
                const end = start + sentence.segment.length;
                span.dataset.start = String(start);
                span.dataset.end = String(end);
                this.appendAiAnswerSentence(span, result.answer, start, end, result.citations);
                textEl.appendChild(span);
            }
        }
        this.renderAiResearchSources(result.sources);
        this.renderAiResearchImages(result.images);
        this.renderAiAnswerPlayState(false);
        this.aiAnswerCursor = 0;
        this.highlightAiAnswerAt(0);
    }

    /**
     * @param {HTMLElement} container
     * @param {string} answer
     * @param {number} start
     * @param {number} end
     * @param {{ start: number, end: number, url: string, title: string }[]} citations
     */
    appendAiAnswerSentence(container, answer, start, end, citations) {
        let cursor = start;
        const withinSentence = citations
            .filter(citation => citation.start >= start && citation.end <= end)
            .sort((a, b) => a.start - b.start);
        for (const citation of withinSentence) {
            if (citation.start < cursor) continue;
            container.append(document.createTextNode(answer.slice(cursor, citation.start)));
            const link = document.createElement('a');
            link.href = citation.url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.title = citation.title;
            link.textContent = answer.slice(citation.start, citation.end);
            container.appendChild(link);
            cursor = citation.end;
        }
        container.append(document.createTextNode(answer.slice(cursor, end)));
    }

    /** @param {{ url: string, title: string }[]} sources */
    renderAiResearchSources(sources) {
        const container = document.getElementById('aiQuestionSources');
        if (!container) return;
        container.textContent = '';
        container.style.display = sources.length ? 'grid' : 'none';
        if (!sources.length) return;
        const heading = document.createElement('strong');
        heading.textContent = 'Sources';
        container.appendChild(heading);
        for (const source of sources) {
            const link = document.createElement('a');
            link.href = source.url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = source.title;
            container.appendChild(link);
        }
    }

    /** @param {{ imageUrl: string, thumbnailUrl: string, sourceUrl: string, caption: string }[]} images */
    renderAiResearchImages(images) {
        const container = document.getElementById('aiQuestionImages');
        if (!container) return;
        container.textContent = '';
        container.style.display = images.length ? 'grid' : 'none';
        if (!images.length) return;
        const heading = document.createElement('strong');
        heading.textContent = 'Research images';
        container.appendChild(heading);
        for (const image of images) {
            const link = document.createElement('a');
            link.className = 'ai-question-image';
            link.href = image.sourceUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            const img = document.createElement('img');
            img.src = image.thumbnailUrl;
            img.alt = image.caption;
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            const caption = document.createElement('span');
            caption.textContent = image.caption;
            link.append(img, caption);
            container.appendChild(link);
        }
    }

    startAiQuestionTimer() {
        this.stopAiQuestionTimer(false);
        this.aiQuestionStartedAt = Date.now();
        const elapsedEl = document.getElementById('aiQuestionElapsed');
        if (elapsedEl) elapsedEl.style.display = 'block';
        const update = () => {
            const elapsed = Date.now() - this.aiQuestionStartedAt;
            if (elapsedEl) elapsedEl.textContent = this.formatElapsed(elapsed);
            this.updateAiQuestionStatus(`Sending to ${BOOK_QUESTION_MODEL_LABEL} · researching the web...`);
        };
        update();
        this.aiQuestionTimer = setInterval(update, 250);
    }

    /** @param {boolean} [hide] @returns {number} */
    stopAiQuestionTimer(hide = false) {
        if (this.aiQuestionTimer) clearInterval(this.aiQuestionTimer);
        this.aiQuestionTimer = null;
        const elapsed = this.aiQuestionStartedAt ? Date.now() - this.aiQuestionStartedAt : 0;
        this.aiQuestionStartedAt = 0;
        const elapsedEl = document.getElementById('aiQuestionElapsed');
        if (elapsedEl && hide) elapsedEl.style.display = 'none';
        return elapsed;
    }

    /** @param {number} milliseconds */
    formatElapsed(milliseconds) {
        const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
        if (totalSeconds < 60) return `${totalSeconds}s`;
        const minutes = Math.floor(totalSeconds / 60);
        return `${minutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
    }

    /** @param {number} milliseconds */
    renderAiQuestionElapsedTotal(milliseconds) {
        const elapsedEl = document.getElementById('aiQuestionElapsed');
        if (elapsedEl) elapsedEl.textContent = `${this.formatElapsed(milliseconds)} total`;
    }

    /** @param {boolean} busy */
    setAiQuestionBusy(busy) {
        const askButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('askAiQuestionBtn'));
        const questionButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('aiQuestionBtn'));
        if (askButton) {
            askButton.disabled = busy;
            askButton.textContent = busy ? 'Researching...' : 'Research';
        }
        if (questionButton) questionButton.disabled = busy;
    }

    /** @param {string} message */
    updateAiQuestionStatus(message) {
        const status = document.getElementById('aiQuestionStatus');
        if (status) status.textContent = message;
    }

    toggleAiAnswerSpeech() {
        if (this.aiAnswerSpeaking) {
            this.stopAiAnswerSpeech();
        } else {
            this.startAiAnswerSpeech();
        }
    }

    startAiAnswerSpeech() {
        if (!this.lastAiAnswer || typeof VoiceOutput === 'undefined') return;
        const speechId = ++this.aiAnswerSpeechId;
        const spokenStart = this.aiAnswerCursor;
        this.aiAnswerSpeaking = true;
        this.renderAiAnswerPlayState(true);
        VoiceOutput.speak(this.lastAiAnswer.slice(spokenStart), {
            onBoundary: event => {
                if (speechId === this.aiAnswerSpeechId) this.highlightAiAnswerAt(spokenStart + event.charIndex);
            }
        }).then(() => {
            if (speechId !== this.aiAnswerSpeechId) return;
            this.aiAnswerSpeaking = false;
            this.renderAiAnswerPlayState(false);
        });
    }

    stopAiAnswerSpeech() {
        this.aiAnswerSpeechId++;
        if (typeof VoiceOutput !== 'undefined') VoiceOutput.stop();
        this.aiAnswerSpeaking = false;
        this.renderAiAnswerPlayState(false);
        this.highlightAiAnswerAt(this.aiAnswerCursor);
    }

    /** @param {boolean} playing */
    renderAiAnswerPlayState(playing) {
        const button = document.getElementById('repeatAiAnswerBtn');
        if (!button) return;
        button.textContent = playing ? 'Stop' : 'Play';
        button.classList.toggle('playing', playing);
        button.setAttribute('aria-label', playing ? 'Stop reading answer' : 'Play answer aloud');
    }

    /** @param {number} charIndex */
    highlightAiAnswerAt(charIndex) {
        const sentences = Array.from(document.querySelectorAll('.ai-answer-sentence'));
        let current = null;
        for (const sentence of sentences) {
            const start = Number(sentence.getAttribute('data-start') || 0);
            const end = Number(sentence.getAttribute('data-end') || 0);
            const selected = charIndex >= start && charIndex < end;
            sentence.classList.toggle('current', selected);
            if (selected) current = sentence;
        }
        if (charIndex >= 0) this.aiAnswerCursor = charIndex;
        if (current instanceof HTMLElement) {
            const pane = document.getElementById('aiQuestionAnswerText');
            if (pane) {
                const top = current.offsetTop;
                const bottom = top + current.offsetHeight;
                if (top < pane.scrollTop) pane.scrollTop = top;
                else if (bottom > pane.scrollTop + pane.clientHeight) pane.scrollTop = bottom - pane.clientHeight;
            }
        }
    }

    /** @param {Event} event */
    handleAiAnswerNavigation(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const action = target?.closest('[data-ai-answer-nav]')?.getAttribute('data-ai-answer-nav');
        if (!action || !this.lastAiAnswer) return;
        this.stopAiAnswerSpeech();
        if (action === 'page-back' || action === 'page-forward') {
            this.navigateAiAnswerPage(action === 'page-forward' ? 1 : -1);
            return;
        }
        const direction = action.endsWith('forward') ? 1 : -1;
        this.navigateAiAnswerUnit(action.startsWith('paragraph') ? 'paragraph' : 'sentence', direction);
    }

    /** @param {'sentence' | 'paragraph'} unit @param {number} direction */
    navigateAiAnswerUnit(unit, direction) {
        const starts = unit === 'sentence'
            ? Array.from(document.querySelectorAll('.ai-answer-sentence')).map(node => Number(node.getAttribute('data-start') || 0))
            : this.getAiAnswerParagraphStarts();
        if (!starts.length) return;
        let currentIndex = 0;
        for (let i = 0; i < starts.length; i++) {
            if (starts[i] <= this.aiAnswerCursor) currentIndex = i;
            else break;
        }
        const nextIndex = Math.max(0, Math.min(starts.length - 1, currentIndex + direction));
        this.highlightAiAnswerAt(starts[nextIndex]);
    }

    /** @returns {number[]} */
    getAiAnswerParagraphStarts() {
        const starts = [];
        const pattern = /(?:^|\n\s*\n)(\S)/g;
        for (const match of this.lastAiAnswer.matchAll(pattern)) {
            starts.push((match.index || 0) + match[0].lastIndexOf(match[1]));
        }
        return starts.length ? starts : [0];
    }

    /** @param {number} direction */
    navigateAiAnswerPage(direction) {
        const pane = document.getElementById('aiQuestionAnswerText');
        if (!pane) return;
        pane.scrollTop = Math.max(0, pane.scrollTop + direction * Math.max(80, pane.clientHeight * 0.85));
        const sentences = Array.from(document.querySelectorAll('.ai-answer-sentence'));
        const nearest = sentences.find(node => node instanceof HTMLElement && node.offsetTop + node.offsetHeight >= pane.scrollTop);
        if (nearest) this.highlightAiAnswerAt(Number(nearest.getAttribute('data-start') || 0));
    }

    /** @param {KeyboardEvent} event */
    shouldHandleSegmentArrow(event) {
        if (!this.currentBook || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target) return true;
        const tagName = target.tagName.toLowerCase();
        if (target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') return false;
        return this.segments.some(segment => this.isSegmentPlayable(segment));
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

    /** @param {string} voice */
    async playVoiceSample(voice) {
        if (!this.apiKey) {
            this.showApiKeyOverlay();
            this.updateStatus('API key required for voice samples');
            return;
        }
        const statusEl = document.getElementById('voiceSampleStatus');
        const voiceMeta = OPENAI_TTS_VOICES.find(item => item.id === voice);
        if (!voiceMeta) return;
        if (this.voiceSampleAudio && this.voiceSampleVoice === voice && !this.voiceSampleAudio.paused) {
            this.voiceSampleAudio.pause();
            this.clearVoiceSampleAudio();
            if (statusEl) statusEl.textContent = 'Sample stopped.';
            this.renderVoiceSampleButtons();
            return;
        }
        this.clearVoiceSampleAudio();
        if (statusEl) statusEl.textContent = `Loading ${voiceMeta.label} sample...`;
        this.renderVoiceSampleButtons();
        try {
            const response = await this.fetchSpeech(VOICE_SAMPLE_TEXT, null, { voice });
            const audioBlob = await response.blob();
            this.voiceSampleUrl = URL.createObjectURL(audioBlob);
            this.voiceSampleAudio = new Audio(this.voiceSampleUrl);
            this.voiceSampleVoice = voice;
            this.voiceSampleAudio.addEventListener('ended', () => {
                if (statusEl) statusEl.textContent = `${voiceMeta.label} sample finished.`;
                this.clearVoiceSampleAudio();
                this.renderVoiceSampleButtons();
            });
            if (statusEl) statusEl.textContent = `Playing ${voiceMeta.label} sample.`;
            this.renderVoiceSampleButtons();
            await this.voiceSampleAudio.play();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.clearVoiceSampleAudio();
            if (statusEl) statusEl.textContent = `Voice sample failed: ${message}`;
            this.log('error', `Voice sample failed: ${message}`);
            this.renderVoiceSampleButtons();
        }
    }

    clearVoiceSampleAudio() {
        if (this.voiceSampleAudio) this.voiceSampleAudio.pause();
        if (this.voiceSampleUrl) URL.revokeObjectURL(this.voiceSampleUrl);
        this.voiceSampleAudio = null;
        this.voiceSampleUrl = null;
        this.voiceSampleVoice = null;
    }

    async refreshLibrary() {
        if (!this.storage) return;
        this.books = await this.storage.getBooks();
        this.renderLibrary();
    }

    renderLibrary() {
        const list = document.getElementById('savedBookList');
        if (!list) return;
        this.syncArchiveViewButton();
        const scopedBooks = this.books.filter(book => this.isBookArchived(book) === this.showArchivedBooks);
        this.renderLibraryProgressSummary(scopedBooks);
        const books = scopedBooks.filter(book => {
            if (!this.libraryQuery) return true;
            return `${book.title} ${book.author} ${book.fileName}`.toLowerCase().includes(this.libraryQuery);
        });
        if (books.length === 0) {
            const label = this.showArchivedBooks ? 'archived books' : 'active books';
            list.innerHTML = `<div class="library-empty">No matching ${label}.</div>`;
            return;
        }
        list.innerHTML = books.map(book => {
            const selectedClass = this.currentBook?.id === book.id ? ' selected' : '';
            const readPercent = this.getBookReadPercent(book);
            const audioPercent = this.getBookGeneratedPercent(book);
            const generatedText = `${this.formatDuration(book.generatedDurationSec || 0)} ready`;
            return `
                <button class="saved-book-item${selectedClass}" type="button" data-book-id="${this.escapeHtml(book.id)}">
                    <div class="saved-book-main">
                        <span class="saved-book-title">${this.escapeHtml(book.title)}</span>
                        <span class="saved-book-author">${this.escapeHtml(book.author || 'Unknown author')}</span>
                    </div>
                    <div class="saved-book-side">
                        <span class="saved-book-meta"><span>Read ${readPercent}%</span><span>Audio ${audioPercent}%</span>${this.formatDurationHtml(book.estimatedDurationSec)}<span>${this.escapeHtml(generatedText)}</span></span>
                    </div>
                    <span class="saved-book-progress-bars" title="Read ${readPercent}%, audio ${audioPercent}%">
                        <span class="saved-book-progress read"><span class="saved-book-progress-fill" style="width: ${readPercent}%"></span></span>
                        <span class="saved-book-progress mp3"><span class="saved-book-progress-fill" style="width: ${audioPercent}%"></span></span>
                    </span>
                </button>
            `;
        }).join('');
    }

    /** @param {BookRecord[]} books */
    renderLibraryProgressSummary(books = this.books) {
        const summary = document.getElementById('libraryProgressSummary');
        if (!summary) return;
        const scope = this.showArchivedBooks ? 'Archive progress' : 'Overall progress';
        if (books.length === 0) {
            summary.innerHTML = `<strong>${scope}</strong><span>${this.showArchivedBooks ? 'No archived books yet.' : 'No books imported yet.'}</span>`;
            return;
        }
        const totalChars = books.reduce((sum, book) => sum + (book.charCount || 0), 0);
        const readChars = books.reduce((sum, book) => sum + Math.max(0, Math.min(book.charCount || 0, book.readingCharOffset || 0)), 0);
        const totalDuration = books.reduce((sum, book) => sum + (book.estimatedDurationSec || 0), 0);
        const generatedDuration = books.reduce((sum, book) => sum + (book.generatedDurationSec || 0), 0);
        const readPercent = totalChars ? Math.round(readChars / totalChars * 100) : 0;
        const generatedPercent = totalDuration ? Math.round(generatedDuration / totalDuration * 100) : 0;
        summary.innerHTML = `
            <strong>${scope}</strong>
            <span>${books.length} book${books.length === 1 ? '' : 's'} · read ${readPercent}% · audio ${generatedPercent}% · ${this.formatDurationHtml(generatedDuration)} / ${this.formatDurationHtml(totalDuration)} generated</span>
        `;
    }

    syncArchiveViewButton() {
        const button = document.getElementById('toggleArchiveViewBtn');
        if (button) button.textContent = this.showArchivedBooks ? 'Show main list' : 'Show archive';
    }

    toggleArchiveView() {
        this.showArchivedBooks = !this.showArchivedBooks;
        this.showWorkspace(false);
        this.currentBook = null;
        this.sections = [];
        this.segments = [];
        this.currentSegmentId = null;
        this.updateStatus(this.showArchivedBooks ? 'Archive' : 'Bookshelf');
        this.renderLibrary();
    }

    /** @param {Event} event */
    async handleLibraryAction(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const row = /** @type {HTMLButtonElement | null} */ (target?.closest('.saved-book-item[data-book-id]') || null);
        const id = row?.getAttribute('data-book-id');
        if (id) await this.openBook(id);
    }

    /** @param {File} file */
    async importFile(file) {
        if (!this.storage) return;

        const books = await this.storage.getBooks();
        const existing = books.find(b => b.fileName === file.name && b.fileSize === file.size);
        if (existing?.rawFile?.size > 0) {
            this.log('info', `Skipping import; ${file.name} is already saved`);
            this.updateStatus(`Already saved: ${existing.title}`);
            this.showWorkspace(false);
            await this.refreshLibrary();
            return;
        }

        this.updateStatus('Importing book...');
        this.log('info', `Importing ${file.name} (${this.formatFileSize(file.size)})`);
        const imported = await this.parseFile(file, this.createId('book'));
        await this.storage.putBook(imported.book);
        await this.storage.putSections(imported.sections);
        await this.storage.putSegments(imported.segments);
        await this.refreshLibrary();
        await this.updateStorageEstimate();
        this.showWorkspace(false);
        this.currentBook = null;
        this.sections = [];
        this.segments = [];
        this.currentSegmentId = null;
        this.renderLibrary();
        this.updateStatus(`Imported ${imported.book.title} and added it to the bookshelf`);
        this.log('info', `Imported ${imported.book.title}: ${imported.sections.length} chapters/sections, ${imported.segments.length} internal audio parts planned`);
    }

    normalizeUrl(value) {
        let url = (value || '').trim();
        if (!url) return '';
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        try {
            return new URL(url).href;
        } catch (error) {
            return '';
        }
    }

    async startUrlImport() {
        const urlInput = /** @type {HTMLInputElement | null} */ (document.getElementById('urlInput'));
        const url = this.normalizeUrl(urlInput?.value || '');
        if (!url) {
            this.updateStatus('Enter a valid http(s) URL to import');
            return;
        }
        this.urlImport = {
            rootUrl: url,
            requestedUrl: urlInput?.value.trim() || url,
            rootPage: null,
            building: false,
            cancelled: false
        };
        if (urlInput) urlInput.value = '';
        this.openUrlImportOverlay();
        this.showUrlImportMode('loading');
        this.setUrlImportMessage(`Reading ${url} ...`);
        try {
            const page = await this.fetchWebPage(url);
            if (!this.urlImport || this.urlImport.cancelled) return;
            this.urlImport.rootPage = page;
            this.log('info', `Read ${page.title || page.url}: ${page.text.length} chars, ${page.links.length} outbound links`);
            this.renderUrlImportSelection();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Could not read ${url}: ${message}`);
            this.setUrlImportMessage(`Could not read ${url}: ${message}`);
            this.showUrlImportMode('error');
        }
    }

    /**
     * @param {string} url
     * @returns {Promise<WebPage>}
     */
    async fetchWebPage(url) {
        const response = await fetch(`proxy.php?readUrl=${encodeURIComponent(url)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        if (data.kind === 'pdf' || data.isBinary) {
            return this.fetchPdfPage(data.url || url, data.title);
        }
        if (!data.text || !String(data.text).trim()) {
            throw new Error('No readable text found');
        }
        const links = Array.isArray(data.links)
            ? data.links
                .filter(link => link && typeof link.url === 'string')
                .map(link => ({ text: String(link.text || '').trim(), url: link.url }))
            : [];
        return {
            url: data.url || url,
            title: String(data.title || '').trim() || url,
            text: String(data.text),
            links,
            truncated: Boolean(data.truncated)
        };
    }

    /**
     * Pull a PDF through the asset proxy and extract its text with the same
     * client-side PDF.js path used for uploaded PDF files.
     * @param {string} url
     * @param {string} [titleHint]
     * @returns {Promise<WebPage>}
     */
    async fetchPdfPage(url, titleHint) {
        const response = await fetch(`proxy.php?assetUrl=${encodeURIComponent(url)}`);
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `PDF fetch failed: HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const fileName = this.fileNameFromUrl(url) || 'document.pdf';
        const file = new File([blob], fileName, { type: 'application/pdf' });
        const sections = await this.parsePdf(file);
        const text = sections.map(section => section.text || '').join('\n\n').trim();
        if (!text) throw new Error('No readable text in PDF');
        return {
            url,
            title: (titleHint || '').trim() || fileName || url,
            text,
            links: [],
            truncated: false
        };
    }

    /** @param {string} url */
    fileNameFromUrl(url) {
        try {
            const path = new URL(url).pathname;
            const name = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
            return name;
        } catch (error) {
            return '';
        }
    }

    renderUrlImportSelection() {
        const state = this.urlImport;
        const current = document.getElementById('urlImportCurrent');
        const linksWrap = document.getElementById('urlImportLinks');
        if (!state || !state.rootPage || !current || !linksWrap) return;
        const page = state.rootPage;
        const truncatedNote = page.truncated ? ' (page text was truncated)' : '';
        const count = page.links.length;
        current.innerHTML = [
            `<div class="url-import-pagehead"><strong>${this.escapeHtml(page.title)}</strong>`,
            `<a href="${this.escapeHtml(page.url)}" target="_blank" rel="noopener">${this.escapeHtml(page.url)}</a></div>`,
            `<p>This page becomes the contents chapter${truncatedNote}. Choose which of its ${count} link${count === 1 ? '' : 's'} to download as their own chapters, then Submit. Everything downloads in the background.</p>`
        ].join('');

        if (count === 0) {
            linksWrap.innerHTML = '<div class="url-import-empty">No outbound links found. Submit to import just this page.</div>';
        } else {
            linksWrap.innerHTML = page.links.map((link, index) => {
                const label = link.text || link.url;
                return `<label class="url-import-link" data-link-text="${this.escapeHtml((link.text + ' ' + link.url).toLowerCase())}">`
                    + `<input type="checkbox" checked data-link-url="${this.escapeHtml(link.url)}" id="urlImportLink${index}" />`
                    + `<span class="url-import-link-text">${this.escapeHtml(label)}</span>`
                    + `<span class="url-import-link-url">${this.escapeHtml(link.url)}</span>`
                    + `</label>`;
            }).join('');
        }
        const filter = /** @type {HTMLInputElement | null} */ (document.getElementById('urlImportFilter'));
        if (filter) filter.value = '';
        this.showUrlImportMode('select');
    }

    /** @param {boolean} checked */
    setAllUrlImportLinks(checked) {
        const linksWrap = document.getElementById('urlImportLinks');
        if (!linksWrap) return;
        linksWrap.querySelectorAll('label.url-import-link').forEach(label => {
            const el = /** @type {HTMLElement} */ (label);
            if (el.style.display === 'none') return;
            const box = el.querySelector('input[type="checkbox"]');
            if (box instanceof HTMLInputElement) box.checked = checked;
        });
    }

    invertUrlImportLinks() {
        const linksWrap = document.getElementById('urlImportLinks');
        if (!linksWrap) return;
        linksWrap.querySelectorAll('label.url-import-link').forEach(label => {
            const el = /** @type {HTMLElement} */ (label);
            if (el.style.display === 'none') return;
            const box = el.querySelector('input[type="checkbox"]');
            if (box instanceof HTMLInputElement) box.checked = !box.checked;
        });
    }

    /** @param {string} term */
    filterUrlImportLinks(term) {
        const linksWrap = document.getElementById('urlImportLinks');
        if (!linksWrap) return;
        linksWrap.querySelectorAll('label.url-import-link').forEach(label => {
            const el = /** @type {HTMLElement} */ (label);
            const haystack = el.getAttribute('data-link-text') || '';
            el.style.display = !term || haystack.includes(term) ? '' : 'none';
        });
    }

    async submitUrlImport() {
        const state = this.urlImport;
        if (!state || !state.rootPage || state.building) return;
        if (!this.storage) return;

        const linksWrap = document.getElementById('urlImportLinks');
        const checked = new Set();
        if (linksWrap) {
            linksWrap.querySelectorAll('input[type="checkbox"]:checked').forEach(box => {
                const url = box.getAttribute('data-link-url');
                if (url) checked.add(url);
            });
        }
        const selected = state.rootPage.links.filter(link => checked.has(link.url));

        state.building = true;
        state.cancelled = false;
        this.showUrlImportMode('building');
        this.updateUrlImportBuildProgress(0, selected.length, selected.length ? 'Starting downloads...' : 'Building...');

        const results = await this.downloadSelectedPages(state, selected, (done, total) =>
            this.updateUrlImportBuildProgress(done, total, `Downloading ${done}/${total} pages...`));
        if (!this.urlImport || state.cancelled) return;
        await this.buildMetabook(state, results);
    }

    /**
     * Download accepted pages with bounded concurrency, preserving order.
     * @param {UrlImportState} state
     * @param {{ text: string, url: string }[]} links
     * @param {(done: number, total: number) => void} onProgress
     * @returns {Promise<UrlImportResult[]>}
     */
    async downloadSelectedPages(state, links, onProgress) {
        /** @type {UrlImportResult[]} */
        const results = new Array(links.length);
        const total = links.length;
        let nextIndex = 0;
        let done = 0;
        const concurrency = Math.min(5, Math.max(1, links.length));
        const worker = async () => {
            while (true) {
                const i = nextIndex++;
                if (i >= links.length) break;
                const link = links[i];
                if (state.cancelled) {
                    results[i] = { link, page: null, error: 'cancelled' };
                } else {
                    try {
                        const page = await this.fetchWebPage(link.url);
                        results[i] = { link, page, error: '' };
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        results[i] = { link, page: null, error: message };
                    }
                }
                done++;
                onProgress(done, total);
            }
        };
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        return results;
    }

    /**
     * @param {UrlImportState} state
     * @param {UrlImportResult[]} results
     */
    async buildMetabook(state, results) {
        if (!this.storage || !state.rootPage || state.cancelled) return;
        const rootPage = state.rootPage;

        const books = await this.storage.getBooks();
        const existing = books.find(b => b.sourceUrl && b.sourceUrl === state.rootUrl);
        const bookId = existing ? existing.id : this.createId('book');

        /** @type {{ title: string, text: string, html?: string }[]} */
        const chapterSections = [];
        /** @type {string[]} */
        const tocLines = [];
        /** @type {string[]} */
        const pageUrls = [rootPage.url];
        let succeeded = 0;
        let failed = 0;
        let chapterNo = 2; // chapter 1 is the contents chapter
        for (const result of results) {
            const linkTitle = (result.link.text || result.page?.title || result.link.url).trim();
            if (result.page && result.page.text.trim()) {
                chapterSections.push({ title: linkTitle, text: this.cleanText(result.page.text), html: '' });
                tocLines.push(`Chapter ${chapterNo}: ${linkTitle}`);
                pageUrls.push(result.page.url);
                chapterNo++;
                succeeded++;
            } else {
                const reason = result.error || 'no readable text';
                tocLines.push(`(could not include) ${linkTitle} - ${reason} [${result.link.url}]`);
                failed++;
            }
        }

        const tocBody = [
            rootPage.title,
            '',
            this.cleanText(rootPage.text),
            '',
            'Contents',
            ''
        ].join('\n');
        const tocText = tocLines.length ? `${tocBody}\n${tocLines.join('\n')}` : tocBody;

        /** @type {{ title: string, text: string, html?: string }[]} */
        const rawSections = [{ title: rootPage.title || 'Contents', text: this.cleanText(tocText), html: '' }, ...chapterSections]
            .filter(section => section.text.length > 0);
        if (rawSections.length === 0) {
            this.updateStatus('No readable text collected');
            this.cancelUrlImport();
            return;
        }

        if (existing) await this.storage.deleteBookCascade(existing.id);
        const { sections, segments, totalWords, charCount } = this.assembleSectionsAndSegments(bookId, rawSections);
        const title = rootPage.title || state.rootUrl;
        const snapshot = JSON.stringify({
            rootUrl: state.rootUrl,
            requestedUrl: state.requestedUrl,
            fetchedAt: new Date().toISOString(),
            contents: { succeeded, failed },
            toc: tocLines,
            pages: [{ url: rootPage.url, title: rootPage.title, text: rootPage.text }]
                .concat(results.filter(r => r.page).map(r => ({ url: /** @type {WebPage} */ (r.page).url, title: /** @type {WebPage} */ (r.page).title, text: /** @type {WebPage} */ (r.page).text })))
        }, null, 2);
        const rawFile = new Blob([snapshot], { type: 'application/json' });
        const now = new Date().toISOString();
        /** @type {BookRecord} */
        const book = {
            id: bookId,
            schemaVersion: 4,
            audioPlanVersion: AUDIO_PLAN_VERSION,
            title,
            author: this.hostnameFor(state.rootUrl),
            format: 'web',
            fileName: `${this.slugify(title)}.web.json`,
            fileType: 'application/json',
            fileSize: rawFile.size,
            rawFile,
            sectionCount: sections.length,
            segmentCount: segments.length,
            generatedSegmentCount: 0,
            wordCount: totalWords,
            charCount,
            estimatedDurationSec: this.estimateDuration(totalWords),
            generatedDurationSec: 0,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            lastOpenedAt: now,
            archivedAt: '',
            readingSectionId: sections[0]?.id || '',
            readingCharOffset: 0,
            listeningSegmentId: segments[0]?.id || '',
            listeningOffsetSec: 0,
            legacyAudioBlob: null,
            legacyAudioSize: 0,
            contentOrigin: 'url',
            sourceUrl: state.rootUrl,
            sourceRequestedUrl: state.requestedUrl,
            lastFetchedAt: now,
            sourcePageUrls: pageUrls
        };

        await this.storage.putBook(book);
        await this.storage.putSections(sections);
        await this.storage.putSegments(segments);
        this.closeUrlImportOverlay();
        this.urlImport = null;
        await this.refreshLibrary();
        await this.updateStorageEstimate();
        this.showWorkspace(false);
        this.currentBook = null;
        this.sections = [];
        this.segments = [];
        this.currentSegmentId = null;
        this.renderLibrary();
        const failNote = failed ? `, ${failed} link${failed === 1 ? '' : 's'} could not be read` : '';
        this.updateStatus(`Built ${title}: contents + ${succeeded} chapter${succeeded === 1 ? '' : 's'}${failNote}`);
        this.log('info', `Built web book ${title}: ${sections.length} chapters (${succeeded} from links, ${failed} failed), ${segments.length} internal audio parts planned`);
    }

    /** @param {number} done @param {number} total @param {string} label */
    updateUrlImportBuildProgress(done, total, label) {
        const fill = document.getElementById('urlImportBuildFill');
        const status = document.getElementById('urlImportBuildStatus');
        const percent = total ? Math.round(done / total * 100) : 100;
        if (fill) fill.style.width = `${percent}%`;
        if (status) status.textContent = total ? `${label} (${percent}%)` : label;
    }

    cancelUrlImport() {
        if (this.urlImport) this.urlImport.cancelled = true;
        this.closeUrlImportOverlay();
        this.urlImport = null;
        this.updateStatus('Web import cancelled');
    }

    /** @param {'loading' | 'select' | 'building' | 'error'} mode */
    showUrlImportMode(mode) {
        const linkTools = document.getElementById('urlImportLinkTools');
        const links = document.getElementById('urlImportLinks');
        const build = document.getElementById('urlImportBuild');
        const submit = /** @type {HTMLButtonElement | null} */ (document.getElementById('urlImportSubmitBtn'));
        const selectMode = mode === 'select';
        if (linkTools) linkTools.style.display = selectMode ? '' : 'none';
        if (links) links.style.display = selectMode ? '' : 'none';
        if (build) build.style.display = mode === 'building' ? '' : 'none';
        if (submit) submit.disabled = !selectMode;
    }

    /** @param {string} message */
    setUrlImportMessage(message) {
        const current = document.getElementById('urlImportCurrent');
        if (current) current.textContent = message;
        const linksWrap = document.getElementById('urlImportLinks');
        if (linksWrap) linksWrap.innerHTML = '';
    }

    openUrlImportOverlay() {
        const overlay = document.getElementById('urlImportOverlay');
        if (overlay) overlay.style.display = 'flex';
        const filter = /** @type {HTMLInputElement | null} */ (document.getElementById('urlImportFilter'));
        if (filter) filter.value = '';
    }

    closeUrlImportOverlay() {
        const overlay = document.getElementById('urlImportOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    /** @param {string} url */
    hostnameFor(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (error) {
            return '';
        }
    }

    /** @param {string} value */
    slugify(value) {
        return (value || 'web-book')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'web-book';
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

        const { sections, segments, totalWords, charCount } = this.assembleSectionsAndSegments(bookId, rawSections);
        const now = new Date().toISOString();
        const book = {
            id: bookId,
            schemaVersion: 3,
            audioPlanVersion: AUDIO_PLAN_VERSION,
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
            charCount,
            estimatedDurationSec: this.estimateDuration(totalWords),
            generatedDurationSec: 0,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: now,
            archivedAt: '',
            readingSectionId: sections[0]?.id || '',
            readingCharOffset: 0,
            listeningSegmentId: segments[0]?.id || '',
            listeningOffsetSec: 0,
            legacyAudioBlob: null,
            legacyAudioSize: 0
        };
        return { book, sections, segments };
    }

    /**
     * Turn normalized raw sections into persistent BookSection + AudioSegment
     * arrays. Shared by file imports and web (URL) imports.
     * @param {string} bookId
     * @param {{ title: string, text: string, html?: string }[]} rawSections
     */
    assembleSectionsAndSegments(bookId, rawSections) {
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
        return { sections, segments, totalWords, charCount: charCursor };
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
        const manifestItems = new Map();
        const mediaTypes = new Map();
        opfDoc.querySelectorAll('manifest item').forEach(item => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            const mediaType = item.getAttribute('media-type') || '';
            if (id && href) {
                const path = this.normalizePath(basePath + href);
                const properties = item.getAttribute('properties') || '';
                manifest.set(id, href);
                manifestItems.set(id, { href, path, mediaType, properties });
                mediaTypes.set(path, mediaType);
            }
        });
        const tocTitles = await this.parseEpubToc(zip, opfDoc, manifestItems);
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
            sections.push({ title: tocTitles.get(filePath) || heading || `Chapter ${sections.length + 1}`, text, html: doc.body?.innerHTML || '' });
        }
        return { title, author, sections };
    }

    /**
     * @param {any} zip
     * @param {Document} opfDoc
     * @param {Map<string, { href: string, path: string, mediaType: string, properties: string }>} manifestItems
     */
    async parseEpubToc(zip, opfDoc, manifestItems) {
        const titles = new Map();
        const navItem = Array.from(manifestItems.values())
            .find(item => item.properties.split(/\s+/).includes('nav'));
        if (navItem) {
            const navContent = await zip.file(navItem.path)?.async('text');
            if (navContent) this.addEpubNavTitles(titles, navContent, navItem.path);
        }
        const ncxId = opfDoc.querySelector('spine')?.getAttribute('toc') || '';
        const ncxItem = ncxId ? manifestItems.get(ncxId) : null;
        if (ncxItem && titles.size === 0) {
            const ncxContent = await zip.file(ncxItem.path)?.async('text');
            if (ncxContent) this.addEpubNcxTitles(titles, ncxContent, ncxItem.path);
        }
        return titles;
    }

    /**
     * @param {Map<string, string>} titles
     * @param {string} navContent
     * @param {string} navPath
     */
    addEpubNavTitles(titles, navContent, navPath) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(navContent, 'text/html');
        const navs = Array.from(doc.querySelectorAll('nav'));
        const tocNav = navs.find(nav => /\btoc\b/i.test(nav.getAttribute('epub:type') || nav.getAttribute('type') || nav.getAttribute('role') || '')) || navs[0];
        if (!tocNav) return;
        const navDir = navPath.substring(0, navPath.lastIndexOf('/') + 1);
        for (const link of Array.from(tocNav.querySelectorAll('a[href]'))) {
            const label = this.cleanText(link.textContent || '');
            const href = link.getAttribute('href') || '';
            if (!label || !href) continue;
            const path = this.resolveEpubHref(navDir, href);
            if (!path) continue;
            if (!titles.has(path)) titles.set(path, label);
        }
    }

    /**
     * @param {Map<string, string>} titles
     * @param {string} ncxContent
     * @param {string} ncxPath
     */
    addEpubNcxTitles(titles, ncxContent, ncxPath) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(ncxContent, 'text/xml');
        const ncxDir = ncxPath.substring(0, ncxPath.lastIndexOf('/') + 1);
        for (const navPoint of Array.from(doc.querySelectorAll('navPoint'))) {
            const label = this.cleanText(navPoint.querySelector('navLabel text')?.textContent || '');
            const src = navPoint.querySelector('content')?.getAttribute('src') || '';
            if (!label || !src) continue;
            const path = this.resolveEpubHref(ncxDir, src);
            if (!path) continue;
            if (!titles.has(path)) titles.set(path, label);
        }
    }

    /** @param {string} directory @param {string} href */
    resolveEpubHref(directory, href) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return '';
        const withoutFragment = href.split('#')[0];
        return this.normalizePath(withoutFragment.startsWith('/') ? withoutFragment.substring(1) : directory + withoutFragment);
    }

    /** @param {File} file */
    async parsePdf(file) {
        if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js library not loaded');
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        /** @type {string[]} */
        const pageTexts = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const text = textContent.items.map((/** @type {any} */ item) => item.str).join(' ');
            pageTexts.push(text);
            if (pdf.numPages > 20 && i % 10 === 0) this.updateStatus(`Reading PDF ${Math.round(i / pdf.numPages * 100)}%`);
        }
        const outline = await pdf.getOutline();
        const outlineSections = outline ? await this.sectionsFromPdfOutline(pdf, outline, pageTexts) : [];
        if (outlineSections.length > 0) return outlineSections;
        return pageTexts.map((text, index) => ({ title: `Page ${index + 1}`, text }));
    }

    /**
     * @param {any} pdf
     * @param {any[]} outline
     * @param {string[]} pageTexts
     */
    async sectionsFromPdfOutline(pdf, outline, pageTexts) {
        const flat = this.flattenPdfOutline(outline);
        /** @type {{ title: string, page: number }[]} */
        const entries = [];
        for (const item of flat) {
            const page = await this.resolvePdfOutlinePage(pdf, item.dest);
            if (page >= 1 && page <= pageTexts.length) entries.push({ title: item.title, page });
        }
        const unique = entries
            .filter((entry, index, list) => list.findIndex(item => item.page === entry.page) === index)
            .sort((a, b) => a.page - b.page);
        if (unique.length === 0) return [];
        return unique.map((entry, index) => {
            const nextPage = unique[index + 1]?.page || pageTexts.length + 1;
            return {
                title: entry.title || `Page ${entry.page}`,
                text: pageTexts.slice(entry.page - 1, nextPage - 1).join('\n\n')
            };
        }).filter(section => section.text.trim().length > 0);
    }

    /** @param {any[]} items */
    flattenPdfOutline(items) {
        /** @type {{ title: string, dest: any }[]} */
        const flat = [];
        for (const item of items) {
            flat.push({ title: this.cleanText(item.title || ''), dest: item.dest });
            if (item.items?.length) flat.push(...this.flattenPdfOutline(item.items));
        }
        return flat;
    }

    /** @param {any} pdf @param {any} dest */
    async resolvePdfOutlinePage(pdf, dest) {
        if (!dest) return -1;
        try {
            const explicitDest = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
            const ref = Array.isArray(explicitDest) ? explicitDest[0] : null;
            if (!ref) return -1;
            return await pdf.getPageIndex(ref) + 1;
        } catch (error) {
            return -1;
        }
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
        const chapters = this.sectionsFromTextChapterHeadings(clean);
        if (chapters.length > 1) return chapters;
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

    /** @param {string} text */
    sectionsFromTextChapterHeadings(text) {
        const headingPattern = /^[ \t]*(chapter\s+(?:\d+|[ivxlcdm]+)\.?(?:[ \t]+[^\n]+)?)[ \t]*$/gim;
        const matches = Array.from(text.matchAll(headingPattern)).map(match => ({
            title: match[1].trim(),
            start: match.index || 0,
            normalized: match[1].replace(/\s+/g, ' ').trim().toLowerCase()
        }));
        if (matches.length < 2) return [];

        const occurrences = new Map();
        for (const match of matches) {
            const grouped = occurrences.get(match.normalized) || [];
            grouped.push(match);
            occurrences.set(match.normalized, grouped);
        }
        const hasContentsDuplicates = Array.from(occurrences.values()).some(group => group.length > 1);
        const headings = hasContentsDuplicates
            ? Array.from(occurrences.values()).map(group => group[group.length - 1]).sort((a, b) => a.start - b.start)
            : matches;
        if (headings.length < 2) return [];

        const sections = [];
        const frontMatter = text.slice(0, headings[0].start).trim();
        if (frontMatter.length > 200) sections.push({ title: 'Front matter', text: frontMatter });
        for (let i = 0; i < headings.length; i++) {
            const chapterText = text.slice(headings[i].start, headings[i + 1]?.start || text.length).trim();
            if (chapterText) sections.push({ title: headings[i].title, text: chapterText });
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
                end = this.findSegmentBreak(text, cursor, end);
            }
            let pieceEnd = end;
            while (pieceEnd > cursor && /\s/.test(text[pieceEnd - 1])) pieceEnd--;
            const pieceText = text.slice(cursor, pieceEnd);
            if (pieceText) pieces.push({ text: pieceText, start: cursor, end: pieceEnd });
            cursor = end;
        }
        return pieces;
    }

    /** @param {string} text @param {number} cursor @param {number} hardEnd */
    findSegmentBreak(text, cursor, hardEnd) {
        const candidate = text.slice(cursor, hardEnd);
        let sentenceEnd = -1;
        const sentenceBoundary = /[.!?](?:["'”’)\]]+)?(?=\s|$)|\n{2,}/g;
        for (const match of candidate.matchAll(sentenceBoundary)) {
            const end = cursor + (match.index || 0) + match[0].length;
            sentenceEnd = end;
        }
        if (sentenceEnd !== -1) return sentenceEnd;

        let clauseEnd = -1;
        const clauseBoundary = /[;:](?=\s)/g;
        for (const match of candidate.matchAll(clauseBoundary)) {
            const end = cursor + (match.index || 0) + 1;
            if (end > cursor + 500) clauseEnd = end;
        }
        if (clauseEnd !== -1) return clauseEnd;

        for (let end = hardEnd; end > cursor + 500; end--) {
            if (/\s/.test(text[end - 1])) return end - 1;
        }
        return hardEnd;
    }

    /** @param {string} bookId */
    async openBook(bookId) {
        if (!this.storage) return;
        const openId = ++this.bookOpenId;
        this.resetAudioPlayerForBookSwitch();
        this.currentBook = null;
        this.sections = [];
        this.segments = [];
        this.historyEntries = [];
        this.researchEntries = [];
        this.currentSegmentId = null;
        this.updateStatus('Opening book...');
        const book = await this.storage.getBook(bookId);
        if (openId !== this.bookOpenId) return;
        if (!book) throw new Error('Book not found');
        book.lastOpenedAt = new Date().toISOString();
        await this.storage.putBook(book);
        const [sections, segments, historyEntries, researchEntries] = await Promise.all([
            this.storage.getSections(bookId),
            this.storage.getSegments(bookId),
            this.storage.getHistory(bookId),
            this.storage.getResearch(bookId)
        ]);
        if (openId !== this.bookOpenId) return;
        this.currentBook = book;
        this.sections = sections;
        this.segments = segments;
        this.historyEntries = historyEntries;
        this.researchEntries = researchEntries;
        await this.recoverInterruptedGenerationStates();
        if (openId !== this.bookOpenId) return;
        if (this.shouldAutoRebuildLegacyTextPlan()) {
            await this.rebuildAudioPlan();
            return;
        }
        this.currentSegmentId = this.currentBook.listeningSegmentId || this.segments[0]?.id || null;
        this.showWorkspace(true);
        this.renderWorkspace();
        this.renderLibrary();
        this.updateStatus(`Opened ${book.title}`);
    }

    shouldAutoRebuildLegacyTextPlan() {
        return this.currentBook?.format === 'txt'
            && this.currentBook.audioPlanVersion !== AUDIO_PLAN_VERSION
            && !this.segments.some(segment => this.isSegmentPlayable(segment))
            && this.sections.length > 1
            && this.sections.every(section => /^Part \d+$/.test(section.title));
    }

    /** @param {boolean} show */
    showWorkspace(show) {
        const workspace = document.getElementById('bookWorkspace');
        if (workspace) workspace.style.display = show ? 'block' : 'none';
        const shell = document.querySelector('.books-shell');
        if (shell) shell.classList.toggle('book-open', show);
        document.body.classList.toggle('books-workspace-open', show);
    }

    backToLibrary() {
        this.bookOpenId++;
        this.setReaderFullscreen(false);
        this.resetAudioPlayerForBookSwitch();
        this.showWorkspace(false);
        this.updateStatus('Bookshelf');
        this.renderLibrary();
    }

    renderWorkspace() {
        if (!this.currentBook) return;
        const title = document.getElementById('workspaceTitle');
        const meta = document.getElementById('workspaceMeta');
        if (title) title.textContent = this.currentBook.title;
        if (meta) {
            meta.textContent = `${this.currentBook.author || 'Unknown author'} · ${this.currentBook.sectionCount} chapters/sections · ${this.formatDuration(this.currentBook.generatedDurationSec)} / ${this.formatDuration(this.currentBook.estimatedDurationSec)} audio generated`;
        }
        this.renderProgress();
        this.renderChapterSelect();
        this.renderConversionSummary();
        this.renderChapterStatusList();
        this.syncGenerationUnitControls();
        this.renderReader();
        this.renderPlayerNow();
        this.renderAiResearchHistory();
        this.syncCurrentBookArchiveButton();
        if (!this.isGenerating) this.updateGenerationProgress(0, 0, 'Idle');
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

    syncCurrentBookArchiveButton() {
        const button = document.getElementById('toggleArchiveCurrentBookBtn');
        if (!button || !this.currentBook) return;
        button.textContent = this.isBookArchived(this.currentBook) ? 'Restore to main list' : 'Move to archive';
    }

    async toggleCurrentBookArchive() {
        if (!this.currentBook || !this.storage) return;
        const archived = this.isBookArchived(this.currentBook);
        this.currentBook.archivedAt = archived ? '' : new Date().toISOString();
        this.currentBook.updatedAt = new Date().toISOString();
        await this.storage.putBook(this.currentBook);
        await this.refreshLibrary();
        this.syncCurrentBookArchiveButton();
        this.updateStatus(archived ? 'Restored to main book list' : 'Moved to archive');
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
                    const statusClass = this.isSegmentPlayable(segment) ? ' generated' : segment.status === 'generating' ? ' generating' : '';
                    const currentClass = segment.id === this.currentSegmentId ? ' current' : '';
                    return `<span class="reader-segment${statusClass}${currentClass}" data-segment-id="${this.escapeHtml(segment.id)}">${this.highlight(this.escapeHtml(segment.text), query)}</span>`;
                }).join('');
            const segmentHtml = sectionSegments.map(segment => {
                const statusClass = this.isSegmentPlayable(segment) ? ' generated' : segment.status === 'generating' ? ' generating' : '';
                const currentClass = segment.id === this.currentSegmentId ? ' current' : '';
                return `<span class="reader-segment${statusClass}${currentClass}" data-segment-id="${this.escapeHtml(segment.id)}">${this.highlight(this.escapeHtml(segment.text), query)}</span>`;
            }).join('');
            const audioMap = section.html ? `<div class="reader-audio-segments">${segmentHtml}</div>` : '';
            return `<section class="reader-section" id="reader-${this.escapeHtml(section.id)}"><h3>${this.escapeHtml(this.getChapterLabel(section))}</h3>${readerBody}${audioMap}</section>`;
        }).join('');
    }

    renderChapterSelect() {
        const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('generationChapterSelect'));
        if (!select) return;
        select.innerHTML = this.sections.map(section => {
            const progress = this.getSectionAudioProgress(section.id);
            const label = `${this.getChapterLabel(section)} · ${this.formatDuration(progress.generatedSec)} / ${this.formatDuration(progress.totalSec)} generated`;
            return `<option value="${this.escapeHtml(section.id)}">${this.escapeHtml(label)}</option>`;
        }).join('');
        const currentSectionId = this.getCurrentSectionId();
        if (currentSectionId) select.value = currentSectionId;
    }

    syncGenerationUnitControls() {
        const hint = document.querySelector('.player-key-hint');
        if (hint) {
            hint.textContent = 'Keyboard: Left/Right moves through generated chapter audio. Book text never auto-scrolls while audio plays.';
        }
    }

    renderConversionSummary() {
        const costEl = document.getElementById('conversionCostText');
        if (!costEl) return;
        const done = this.segments.filter(segment => this.isSegmentPlayable(segment));
        costEl.textContent = `${this.formatCurrency(this.estimateConversionCost(done))} est`;
    }

    renderChapterStatusList() {
        const list = document.getElementById('chapterStatusList');
        if (!list) return;
        if (this.sections.length === 0) {
            list.innerHTML = '<div class="chapter-status-empty">No chapters loaded.</div>';
            return;
        }
        list.innerHTML = this.sections.map(section => {
            const sectionSegments = this.segments.filter(segment => segment.sectionId === section.id);
            const progress = this.getSectionAudioProgress(section.id);
            const chunks = sectionSegments.map(segment => {
                const classes = [
                    'chunk-dot',
                    this.isSegmentPlayable(segment) ? 'done' : segment.status === 'generating' ? 'generating' : segment.status === 'error' ? 'error' : 'pending',
                    segment.id === this.currentSegmentId ? 'current' : ''
                ].filter(Boolean).join(' ');
                const label = `Audio part ${segment.sectionSegmentIndex + 1}: ${segment.status}`;
                return `<button class="${classes}" type="button" data-segment-id="${this.escapeHtml(segment.id)}" title="${this.escapeHtml(label)}">${segment.sectionSegmentIndex + 1}</button>`;
            }).join('');
            return `
                <div class="chapter-status-item">
                    <div class="chapter-status-top">
                        <strong>${this.escapeHtml(this.getChapterLabel(section))}</strong>
                        <span>${this.formatDuration(progress.generatedSec)} / ${this.formatDuration(progress.totalSec)} generated · ${progress.percent}%</span>
                    </div>
                    <div class="chapter-status-track"><span style="width: ${progress.percent}%"></span></div>
                    <details class="chapter-audio-details">
                        <summary>Audio details</summary>
                        <div class="chunk-dot-row">${chunks}</div>
                    </details>
                </div>
            `;
        }).join('');
    }

    /** @param {string} sectionId */
    getSectionAudioProgress(sectionId) {
        const segments = this.segments.filter(segment => segment.sectionId === sectionId);
        const totalSec = segments.reduce((sum, segment) => sum + (segment.durationSec || segment.estimatedDurationSec), 0);
        const generatedSec = segments
            .filter(segment => this.isSegmentPlayable(segment))
            .reduce((sum, segment) => sum + (segment.durationSec || segment.estimatedDurationSec), 0);
        const percent = totalSec ? Math.min(100, Math.round(generatedSec / totalSec * 100)) : 0;
        return { totalSec, generatedSec, percent };
    }

    /** @param {Event} event */
    handleReaderClick(event) {
        this.handleSegmentTargetClick(event, { autoplay: false, markRead: true });
    }

    /**
     * @param {Event} event
     * @param {{ autoplay?: boolean, markRead?: boolean }} [options]
     */
    handleSegmentTargetClick(event, options = {}) {
        const autoplay = Boolean(options.autoplay);
        const target = event.target instanceof HTMLElement ? event.target : null;
        const item = target?.closest('[data-segment-id]');
        const segmentId = item?.getAttribute('data-segment-id');
        if (!segmentId) return;
        const segment = this.getSegmentById(segmentId);
        if (!segment) return;
        this.currentSegmentId = segment.id;
        if (options.markRead) this.markReadingProgress(segment);
        this.renderWorkspace();
        if (this.isSegmentPlayable(segment)) this.playSegment(segment.id, autoplay);
    }

    async generateCurrentChapter() {
        const sectionId = this.getCurrentSectionId();
        if (!sectionId) return;
        await this.generateSegments(this.segments.filter(segment => segment.sectionId === sectionId && this.isSegmentPending(segment)), false);
    }

    async generateSelectedChapter() {
        const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('generationChapterSelect'));
        const sectionId = select?.value || this.getCurrentSectionId();
        if (!sectionId) return;
        await this.generateSegments(this.segments.filter(segment => segment.sectionId === sectionId && this.isSegmentPending(segment)), false);
    }

    async generatePreviousChapter() {
        const currentSectionId = this.getCurrentSectionId();
        const currentIndex = Math.max(0, this.sections.findIndex(section => section.id === currentSectionId));
        const previous = this.sections.slice(0, currentIndex).reverse()
            .find(section => this.segments.some(segment => segment.sectionId === section.id && this.isSegmentPending(segment)));
        if (!previous) {
            this.updateStatus('No pending chapter before the current chapter');
            return;
        }
        await this.generateSegments(this.segments.filter(segment => segment.sectionId === previous.id && this.isSegmentPending(segment)), false);
    }

    async generateNextChapter() {
        const currentSectionId = this.getCurrentSectionId();
        const currentIndex = Math.max(0, this.sections.findIndex(section => section.id === currentSectionId));
        const next = this.sections.slice(currentIndex + 1)
            .find(section => this.segments.some(segment => segment.sectionId === section.id && this.isSegmentPending(segment)));
        if (!next) {
            this.updateStatus('No pending chapter after the current chapter');
            return;
        }
        await this.generateSegments(this.segments.filter(segment => segment.sectionId === next.id && this.isSegmentPending(segment)), false);
    }

    async generateCurrentChunk() {
        const current = this.getSegmentById(this.currentSegmentId || '');
        const segment = current && this.isSegmentPending(current)
            ? current
            : this.segments.find(item => this.isSegmentPending(item));
        if (!segment) {
            this.updateStatus('No pending audio parts to generate');
            return;
        }
        await this.generateSegments([segment], false);
    }

    async generateAllRemaining() {
        await this.generateSegments(this.segments.filter(segment => this.isSegmentPending(segment)), false);
    }

    /**
     * Manual and auto duration buttons extend from the playhead. Already-queued
     * or in-flight chunks are skipped so a second +15/+1 hour enqueues another
     * block after the current pipeline. Failed chunks at/after the playhead are
     * still pending (no blob), so they get filled on retry.
     * @param {number} seconds @param {boolean} automatic
     */
    async generateNextDuration(seconds, automatic) {
        const selected = this.selectPendingSegmentsForDuration(seconds, {
            fromIndex: Math.max(0, this.getCurrentSegmentIndex()),
            excludeIds: this.getGenerationClaimedSegmentIds()
        });
        await this.generateSegments(selected, automatic);
    }

    /** @returns {Set<string>} */
    getGenerationClaimedSegmentIds() {
        const claimed = new Set(this.generationQueue);
        if (this.generatingSegmentId) claimed.add(this.generatingSegmentId);
        return claimed;
    }

    /**
     * @param {number} seconds
     * @param {{ fromIndex?: number, excludeIds?: Set<string> }} [options]
     * @returns {AudioSegment[]}
     */
    selectPendingSegmentsForDuration(seconds, options = {}) {
        const fromIndex = Math.max(0, options.fromIndex || 0);
        const excludeIds = options.excludeIds || new Set();
        let total = 0;
        /** @type {AudioSegment[]} */
        const selected = [];
        for (let i = fromIndex; i < this.segments.length; i++) {
            const segment = this.segments[i];
            if (!this.isSegmentPending(segment)) continue;
            if (excludeIds.has(segment.id)) continue;
            selected.push(segment);
            total += segment.estimatedDurationSec;
            if (total >= seconds) break;
        }
        return selected;
    }

    /**
     * Add segments to the generation queue and make sure the worker is running.
     * Enqueuing while a job is in flight appends to the queue instead of being
     * ignored, so the user can line up chapters/chunks freely.
     * @param {AudioSegment[]} selected @param {boolean} automatic
     */
    async generateSegments(selected, automatic) {
        const terms = this.getAudioUnitTerms();
        if (!this.apiKey) {
            this.showApiKeyOverlay();
            this.updateStatus('API key required to generate audio');
            return;
        }
        if (!this.storage || !this.currentBook) return;

        const queuedSet = new Set(this.generationQueue);
        const toAdd = selected.filter(segment =>
            this.isSegmentPending(segment)
            && !queuedSet.has(segment.id)
            && segment.id !== this.generatingSegmentId
        );
        if (toAdd.length === 0) {
            if (!automatic) {
                const pendingExists = selected.some(segment => this.isSegmentPending(segment));
                this.updateStatus(pendingExists
                    ? `Already queued or generating`
                    : `No pending ${terms.plural} to generate`);
            }
            return;
        }

        if (!this.isGenerating && this.generationQueue.length === 0) {
            this.generationDone = 0;
            this.generationTotal = 0;
            this.generationFailed = 0;
        }
        for (const segment of toAdd) this.generationQueue.push(segment.id);
        this.generationTotal += toAdd.length;
        if (!automatic) {
            const count = `${toAdd.length} ${toAdd.length === 1 ? terms.singular : terms.plural}`;
            this.updateStatus(this.isGenerating ? `Queued ${count}` : `Generating ${count}...`);
        }
        this.renderGenerationProgress();
        this.ensureGenerationWorker();
    }

    ensureGenerationWorker() {
        if (this.isGenerating) return;
        this.runGenerationWorker();
    }

    async runGenerationWorker() {
        if (this.isGenerating) return;
        if (!this.storage || !this.currentBook || this.generationQueue.length === 0) return;
        const bookId = this.currentBook.id;
        const terms = this.getAudioUnitTerms();
        this.isGenerating = true;
        this.generationCancelled = false;
        this.generationAbort = new AbortController();
        let stoppedForFatalError = false;
        try {
            while (this.generationQueue.length > 0) {
                if (this.generationCancelled || this.currentBook?.id !== bookId) break;
                const segmentId = this.generationQueue.shift();
                const segment = this.getSegmentById(segmentId || '');
                if (!segment) {
                    this.generationTotal = Math.max(this.generationDone, this.generationTotal - 1);
                    this.renderGenerationProgress();
                    continue;
                }
                if (this.isSegmentPlayable(segment)) {
                    await this.repairPlayableSegmentMetadata(segment);
                    this.generationDone++;
                    this.renderGenerationProgress();
                    continue;
                }
                this.generatingSegmentId = segment.id;
                segment.status = 'generating';
                segment.error = '';
                await this.storage.putSegment(segment);
                this.replaceSegment(segment);
                this.renderSegmentStatus(segment);
                this.renderGenerationProgress();
                try {
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
                    this.generationDone++;
                    this.renderGenerationProgress();
                    this.renderWorkspace();
                    if (!this.getCurrentGeneratedSegment() && segment.id === this.currentSegmentId) this.loadSegmentIntoPlayer(segment, false);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const cancelled = this.generationCancelled || Boolean(this.generationAbort?.signal.aborted);
                    if (cancelled) {
                        if (this.currentBook?.id === bookId) {
                            segment.status = 'pending';
                            segment.error = '';
                            await this.storage.putSegment(segment);
                            this.replaceSegment(segment);
                            this.renderSegmentStatus(segment);
                        }
                        break;
                    }
                    segment.status = 'error';
                    segment.error = message;
                    await this.storage.putSegment(segment);
                    this.replaceSegment(segment);
                    this.renderSegmentStatus(segment);
                    this.generationDone++;
                    this.generationFailed++;
                    this.log('error', `Could not generate a ${terms.singular}: ${message}`);
                    this.renderGenerationProgress();
                    // Auth/quota failures will fail every remaining request; stop and keep them pending for retry.
                    if (this.isFatalSpeechError(message)) {
                        stoppedForFatalError = true;
                        this.generationQueue = [];
                        this.updateStatus(`Stopped after ${terms.singular} failure: ${message}`);
                        break;
                    }
                } finally {
                    this.generatingSegmentId = null;
                }
            }
            if (!this.generationCancelled && !stoppedForFatalError) {
                const failed = this.generationFailed;
                this.updateStatus(failed
                    ? `Audio generation finished with ${failed} failed ${failed === 1 ? terms.singular : terms.plural} — use +15 min / +1 hour to fill missing ones`
                    : 'Audio generation complete');
            }
        } finally {
            this.isGenerating = false;
            this.generationAbort = null;
            this.generatingSegmentId = null;
        }

        // Items can land during teardown awaits; restart cleanly if so.
        if (!this.generationCancelled && this.generationQueue.length > 0) {
            this.runGenerationWorker();
            return;
        }
        this.renderGenerationProgress();
        await this.refreshLibrary();
        await this.updateStorageEstimate();
    }

    /** Stop the in-flight generation and clear everything still queued. */
    stopGeneration() {
        this.generationQueue = [];
        if (this.isGenerating) {
            this.generationCancelled = true;
            if (this.generationAbort) this.generationAbort.abort();
        }
        this.generationDone = 0;
        this.generationTotal = 0;
        this.generationFailed = 0;
    }

    cancelGeneration() {
        if (!this.isGenerating && this.generationQueue.length === 0) return;
        this.stopGeneration();
        this.updateStatus('Cancelled generation and cleared the queue');
        this.updateGenerationProgress(0, 0, 'Cancelled');
    }

    renderGenerationProgress() {
        const terms = this.getAudioUnitTerms();
        if (!this.isGenerating && this.generationTotal === 0) {
            this.updateGenerationProgress(0, 0, 'Idle');
            return;
        }
        const queued = this.generationQueue.length;
        const message = this.isGenerating
            ? `Generating ${terms.plural}: ${this.generationDone}/${this.generationTotal} done${queued ? `, ${queued} queued` : ''}`
            : 'Generation complete';
        this.updateGenerationProgress(this.generationDone, this.generationTotal, message);
    }

    /**
     * @param {string} text
     * @param {AbortSignal | null} signal
     * @param {{ voice?: string }} [overrides]
     */
    async fetchSpeech(text, signal, overrides = {}) {
        if (!this.apiKey) throw new Error('API key not configured');
        const payload = {
            model: this.settings.model,
            input: text,
            voice: overrides.voice || this.settings.voice,
            speed: this.settings.speed,
            response_format: 'mp3'
        };
        const instructions = this.composeNarrationInstructions();
        if (instructions && this.ttsModelSupportsInstructions()) {
            /** @type {any} */ (payload).instructions = instructions;
        }
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: signal || undefined
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
        }
        return response;
    }

    composeNarrationInstructions() {
        const accent = OPENAI_TTS_ACCENTS.find(item => item.id === this.settings.accent)?.instruction || '';
        const style = OPENAI_TTS_STYLES.find(item => item.id === this.settings.style)?.instruction || '';
        const custom = this.settings.instructions.trim();
        return [accent, style, custom].filter(Boolean).join(' ');
    }

    async recalculateBookGeneration() {
        if (!this.storage || !this.currentBook) return;
        const done = this.segments.filter(segment => this.isSegmentPlayable(segment));
        this.currentBook.generatedSegmentCount = done.length;
        this.currentBook.generatedDurationSec = done.reduce((sum, segment) => sum + (segment.durationSec || segment.estimatedDurationSec), 0);
        this.currentBook.updatedAt = new Date().toISOString();
        await this.storage.putBook(this.currentBook);
    }

    playFromProgress() {
        const saved = this.getSegmentById(this.currentBook?.listeningSegmentId || '');
        const segment = saved && this.isSegmentPlayable(saved) ? saved : this.segments.find(item => this.isSegmentPlayable(item));
        if (!segment) {
            this.updateStatus('Generate audio before playing');
            return;
        }
        this.recordHistory('play-from-progress', 'Play from saved listening position');
        this.playSegment(segment.id, true);
    }

    /** @param {number} direction */
    playAdjacentGenerated(direction) {
        const currentIndex = this.getCurrentSegmentIndex();
        const generated = this.segments.filter(segment => this.isSegmentPlayable(segment));
        const currentGeneratedIndex = generated.findIndex(segment => segment.segmentIndex === currentIndex);
        let next = generated[currentGeneratedIndex + direction];
        if (!next && currentGeneratedIndex === -1) {
            next = direction > 0
                ? generated.find(segment => segment.segmentIndex > currentIndex) || generated[0]
                : Array.from(generated).reverse().find(segment => segment.segmentIndex < currentIndex) || generated[generated.length - 1];
        }
        next = next || (direction > 0 ? generated[0] : generated[generated.length - 1]);
        if (next) {
            this.recordHistory(direction > 0 ? 'next-segment' : 'previous-segment', `${direction > 0 ? 'Next' : 'Previous'} MP3 segment`);
            this.playSegment(next.id, true, false);
        }
    }

    /** @param {boolean} autoplay */
    playNextGenerated(autoplay) {
        const currentIndex = this.getCurrentSegmentIndex();
        const next = this.segments.find(segment => segment.segmentIndex > currentIndex && this.isSegmentPlayable(segment));
        if (next) {
            this.playSegment(next.id, autoplay, false);
        } else {
            this.updateStatus('End of generated audio');
        }
    }

    /** @param {string} segmentId @param {boolean} autoplay @param {boolean} [scrollReader] */
    playSegment(segmentId, autoplay, scrollReader = true) {
        const segment = this.getSegmentById(segmentId);
        if (!segment || !this.isSegmentPlayable(segment)) {
            this.updateStatus('That segment has not been generated yet');
            return;
        }
        this.repairPlayableSegmentMetadata(segment).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            this.log('warn', `Could not repair MP3 metadata: ${message}`);
        });
        this.currentSegmentId = segment.id;
        this.loadSegmentIntoPlayer(segment, autoplay);
        if (scrollReader) {
            this.renderWorkspace();
        } else {
            this.renderProgress();
            this.renderPlayerNow();
            this.updateCurrentSegmentClass();
        }
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
        this.lastAudioTimeForHistory = 0;
        this.renderPlayerNow();
        this.updatePlayerControls();
        this.preloadNextGenerated();
        if (autoplay) audio.play().catch(() => this.updateStatus('Tap play to start audio'));
    }

    restoreListeningOffset() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audio || !this.currentBook) return;
        if (audio.dataset.segmentId === this.currentBook.listeningSegmentId && this.currentBook.listeningOffsetSec > 0 && this.currentBook.listeningOffsetSec < audio.duration - 1) {
            audio.currentTime = this.currentBook.listeningOffsetSec;
        }
        this.updatePlayerControls();
    }

    async handleAudioMetadataLoaded() {
        this.restoreListeningOffset();
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audio || !this.storage || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
        const segment = this.getSegmentById(audio.dataset.segmentId || '');
        if (!segment) return;
        const actualDuration = Math.round(audio.duration * 1000) / 1000;
        if (Math.abs((segment.durationSec || 0) - actualDuration) < 0.01) return;
        segment.durationSec = actualDuration;
        await this.storage.putSegment(segment);
        if (this.currentBook?.id !== segment.bookId) return;
        this.replaceSegment(segment);
        await this.recalculateBookGeneration();
        this.renderProgress();
        this.renderLibrary();
    }

    handleAudioTimeUpdate() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audio || !this.currentBook || !this.storage) return;
        const segmentId = audio.dataset.segmentId || this.currentSegmentId || '';
        const segment = this.getSegmentById(segmentId);
        if (!segment) return;
        this.updatePlayerControls();
        this.currentBook.listeningSegmentId = segment.id;
        this.currentBook.listeningOffsetSec = audio.currentTime || 0;
        const ratio = audio.duration ? Math.min(1, audio.currentTime / audio.duration) : 0;
        this.updateReadAlongProgress(segment, ratio);
        this.renderProgress();
        this.renderPlayerNow();
        this.preloadNextGenerated();
        const now = Date.now();
        if (now - this.lastProgressSavedAt > 5000) {
            this.lastProgressSavedAt = now;
            this.currentBook.updatedAt = new Date().toISOString();
            this.storage.putBook(this.currentBook);
            this.renderLibrary();
        }
        if (!audio.paused && now - this.lastListenHistoryAt > 10000) {
            const delta = Math.max(0, (audio.currentTime || 0) - this.lastAudioTimeForHistory);
            if (delta > 0) this.recordHistory('listen-progress', 'Listening progress sample', delta);
            this.lastAudioTimeForHistory = audio.currentTime || 0;
            this.lastListenHistoryAt = now;
        }
        if (this.autoGenerateAhead && !this.isGenerating) this.ensureGeneratedAhead();
    }

    handleAudioPlay() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        this.lastAudioTimeForHistory = audio?.currentTime || 0;
        this.lastListenHistoryAt = Date.now();
        this.recordHistory('play', 'Playback started');
        this.updatePlayerControls();
    }

    handleAudioPause() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (audio) {
            const delta = Math.max(0, (audio.currentTime || 0) - this.lastAudioTimeForHistory);
            if (delta > 0) this.recordHistory('pause', 'Playback paused', delta);
        } else {
            this.recordHistory('pause', 'Playback paused');
        }
        this.updatePlayerControls();
    }

    handleAudioEnded() {
        this.recordHistory('segment-ended', 'MP3 segment ended');
        this.playNextGenerated(true);
    }

    togglePlayPause() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audio || !audio.src) {
            this.playFromProgress();
            return;
        }
        if (audio.paused) audio.play().catch(() => this.updateStatus('Tap play to start audio'));
        else audio.pause();
    }

    /** @param {number} seconds @param {string} action */
    seekRelative(seconds, action) {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audio || !Number.isFinite(audio.duration)) return;
        this.seekTo(Math.max(0, Math.min(audio.duration, audio.currentTime + seconds)), action);
    }

    /** @param {number} direction */
    quadraticSeek(direction) {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
        const current = audio.currentTime || 0;
        let target;
        if (direction < 0) {
            target = current / 2;
        } else {
            target = current < audio.duration / 2
                ? audio.duration - current
                : current + (audio.duration - current) / 2;
        }
        this.seekTo(Math.max(0, Math.min(audio.duration, target)), direction < 0 ? 'quadratic-back' : 'quadratic-forward');
    }

    /** @param {MouseEvent} event */
    handleSeekTrackClick(event) {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        const track = /** @type {HTMLElement | null} */ (document.getElementById('playerSeekTrack'));
        if (!audio || !track || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
        const rect = track.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        this.seekTo(ratio * audio.duration, 'seek-bar');
    }

    /** @param {number} target @param {string} action */
    seekTo(target, action) {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (!audio) return;
        const from = audio.currentTime || 0;
        audio.currentTime = target;
        this.lastAudioTimeForHistory = target;
        this.recordHistory(action, `${this.formatClock(from)} -> ${this.formatClock(target)}`);
        this.updatePlayerControls();
    }

    updatePlayerControls() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        const playBtn = document.getElementById('playPauseBtn');
        const currentEl = document.getElementById('playerCurrentTime');
        const durationEl = document.getElementById('playerDuration');
        const fill = /** @type {HTMLElement | null} */ (document.getElementById('playerProgressFill'));
        const current = audio?.currentTime || 0;
        const duration = Number.isFinite(audio?.duration) ? audio.duration : 0;
        if (playBtn) playBtn.textContent = audio && !audio.paused ? 'Pause' : 'Play';
        if (currentEl) currentEl.textContent = this.formatClock(current);
        if (durationEl) durationEl.textContent = this.formatClock(duration);
        if (fill) fill.style.width = duration ? `${Math.min(100, Math.max(0, current / duration * 100))}%` : '0%';
    }

    ensureGeneratedAhead() {
        if (!this.autoGenerateAhead || !this.apiKey) return;
        const ahead = this.generatedAheadSeconds();
        if (ahead < AUTO_AHEAD_SECONDS) this.generateNextDuration(AUTO_AHEAD_SECONDS - ahead, true);
    }

    generatedAheadSeconds() {
        const startIndex = Math.max(0, this.getCurrentSegmentIndex());
        let total = 0;
        for (let i = startIndex; i < this.segments.length; i++) {
            const segment = this.segments[i];
            if (!this.isSegmentPlayable(segment)) break;
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
            this.updateStatus(`Current ${this.getAudioUnitTerms().singular} has no MP3 yet`);
            return;
        }
        this.downloadBlob(segment.blob, this.segmentFilename(this.currentBook, segment));
    }

    async downloadCurrentChapter() {
        if (!this.currentBook) return;
        const sectionId = this.getCurrentSectionId();
        const section = this.sections.find(item => item.id === sectionId);
        const generated = this.segments.filter(segment => segment.sectionId === sectionId && this.isSegmentPlayable(segment));
        if (!section || generated.length === 0) {
            this.updateStatus('Current chapter has no generated audio yet');
            return;
        }
        const blobs = generated.map(segment => /** @type {Blob} */ (segment.blob));
        const chapterName = this.safeFilename(this.getChapterLabel(section));
        this.downloadBlob(new Blob(blobs, { type: 'audio/mpeg' }), `${this.safeFilename(this.currentBook.title)}-${chapterName}.mp3`);
    }

    async downloadAllSegments() {
        if (!this.currentBook) return;
        const done = this.segments.filter(segment => this.isSegmentPlayable(segment));
        if (done.length === 0) {
            this.updateStatus(`No generated MP3 ${this.getAudioUnitTerms().plural} to download`);
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
        const done = segments.filter(segment => this.isSegmentPlayable(segment));
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
        this.updateStatus(`Deleted current ${this.getAudioUnitTerms().singular} MP3`);
    }

    async deleteCurrentBookAudio() {
        if (this.currentBook) await this.deleteBookAudio(this.currentBook.id);
    }

    async requestRebuildAudioPlan() {
        const button = document.getElementById('rebuildAudioPlanBtn');
        if (!this.rebuildAudioPlanArmed) {
            this.rebuildAudioPlanArmed = true;
            if (button) button.textContent = 'Confirm: delete audio and rebuild';
            this.updateStatus('Rebuilding the audio plan deletes every generated MP3 for this book. Press the confirmation button to continue.');
            return;
        }
        this.rebuildAudioPlanArmed = false;
        if (button) button.textContent = 'Rebuild sentence-safe audio plan';
        await this.rebuildAudioPlan();
    }

    async rebuildAudioPlan() {
        if (!this.currentBook || !this.storage) return;
        const book = this.currentBook;
        const oldListeningSegment = this.getSegmentById(book.listeningSegmentId);
        const oldListeningDuration = oldListeningSegment
            ? oldListeningSegment.durationSec || oldListeningSegment.estimatedDurationSec
            : 0;
        const listeningRatio = oldListeningDuration
            ? Math.max(0, Math.min(1, book.listeningOffsetSec / oldListeningDuration))
            : 0;
        const listeningCharOffset = oldListeningSegment
            ? Math.round(oldListeningSegment.charStart + (oldListeningSegment.charEnd - oldListeningSegment.charStart) * listeningRatio)
            : 0;
        const rebuilt = book.contentOrigin === 'url'
            ? this.assembleSectionsAndSegments(
                book.id,
                this.sections.map(section => ({ title: section.title, text: section.text, html: section.html }))
            )
            : await this.parseFile(
                new File([book.rawFile], book.fileName, { type: book.fileType }),
                book.id
            );
        const rebuiltSections = 'sections' in rebuilt ? rebuilt.sections : [];
        const rebuiltSegments = 'segments' in rebuilt ? rebuilt.segments : [];
        const rebuiltCharCount = 'charCount' in rebuilt
            ? rebuilt.charCount
            : rebuilt.book.charCount;
        const rebuiltWordCount = 'totalWords' in rebuilt
            ? rebuilt.totalWords
            : rebuilt.book.wordCount;
        this.resetAudioPlayerForBookSwitch();
        book.sectionCount = rebuiltSections.length;
        book.segmentCount = rebuiltSegments.length;
        book.audioPlanVersion = AUDIO_PLAN_VERSION;
        book.generatedSegmentCount = 0;
        book.charCount = rebuiltCharCount;
        book.wordCount = rebuiltWordCount;
        book.estimatedDurationSec = rebuiltSegments.reduce((sum, segment) => sum + segment.estimatedDurationSec, 0);
        book.generatedDurationSec = 0;
        const rebuiltListeningSegment = rebuiltSegments.find(segment =>
            listeningCharOffset >= segment.charStart && listeningCharOffset < segment.charEnd
        ) || rebuiltSegments[0];
        book.listeningSegmentId = rebuiltListeningSegment?.id || '';
        book.listeningOffsetSec = rebuiltListeningSegment
            ? Math.max(0, listeningCharOffset - rebuiltListeningSegment.charStart)
                / Math.max(1, rebuiltListeningSegment.charEnd - rebuiltListeningSegment.charStart)
                * rebuiltListeningSegment.estimatedDurationSec
            : 0;
        book.updatedAt = new Date().toISOString();
        await this.storage.replaceBookContent(book, rebuiltSections, rebuiltSegments);
        this.currentBook = book;
        this.sections = rebuiltSections;
        this.segments = rebuiltSegments;
        this.currentSegmentId = book.listeningSegmentId || null;
        this.renderWorkspace();
        await this.refreshLibrary();
        await this.updateStorageEstimate();
        this.updateStatus('Rebuilt the chapter audio plan with sentence-safe boundaries; generated audio was cleared');
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
            this.researchEntries = [];
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

    /** @param {AudioSegment} segment @param {string} action */
    markReadingProgress(segment, action = 'read-position') {
        if (!this.currentBook || !this.storage) return;
        this.currentBook.readingSectionId = segment.sectionId;
        this.currentBook.readingCharOffset = segment.charStart;
        this.currentBook.updatedAt = new Date().toISOString();
        this.storage.putBook(this.currentBook);
        if (action.startsWith('reader') || action === 'read-position') {
            const now = Date.now();
            const wordOffset = this.estimateWordOffset(segment.charStart);
            const readWords = Math.max(0, wordOffset - this.lastReadWordOffset);
            const readSec = this.lastReadHistoryAt ? Math.max(0, (now - this.lastReadHistoryAt) / 1000) : 0;
            this.lastReadWordOffset = wordOffset;
            this.lastReadHistoryAt = now;
            this.recordHistory(action, 'Reader position changed', 0, readSec, readWords);
        }
    }

    renderPlayerNow() {
        const el = document.getElementById('playerNow');
        if (!el) return;
        const segment = this.getSegmentById(this.currentSegmentId || '');
        if (!segment) {
            el.textContent = 'No MP3 selected';
            return;
        }
        const sectionSegments = this.segments.filter(item => item.sectionId === segment.sectionId);
        const before = sectionSegments
            .filter(item => item.segmentIndex < segment.segmentIndex)
            .reduce((sum, item) => sum + (item.durationSec || item.estimatedDurationSec), 0);
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        const position = before + (audio?.dataset.segmentId === segment.id ? audio.currentTime || 0 : 0);
        const total = sectionSegments.reduce((sum, item) => sum + (item.durationSec || item.estimatedDurationSec), 0);
        const ready = this.isSegmentPlayable(segment);
        const section = this.sections.find(item => item.id === segment.sectionId);
        const chapterLabel = section ? this.getChapterLabel(section) : this.getSectionTitle(segment.sectionId);
        el.textContent = `${chapterLabel} · ${this.formatDuration(position)} / ${this.formatDuration(total)} · ${ready ? 'audio ready' : 'audio not generated'}${ready ? ` · Voice: ${this.settingsSummary(segment.audioSettings)}` : ''}`;
    }

    /** @param {AudioSegment} segment */
    renderSegmentStatus(segment) {
        const node = document.querySelector(`.reader-segment[data-segment-id="${CSS.escape(segment.id)}"]`);
        if (!node) return;
        node.classList.toggle('generated', this.isSegmentPlayable(segment));
        node.classList.toggle('generating', segment.status === 'generating');
    }

    /** @param {number} done @param {number} total @param {string} message */
    updateGenerationProgress(done, total, message) {
        const status = document.getElementById('generationStatus');
        const fill = document.getElementById('generationProgressFill');
        const detail = document.getElementById('generationDetail');
        const percent = total ? Math.round(done / total * 100) : 0;
        if (status) status.textContent = message;
        if (fill) fill.style.width = `${percent}%`;
        if (detail) {
            const generated = this.segments.filter(segment => this.isSegmentPlayable(segment)).length;
            const remainingInJob = Math.max(0, total - done);
            const terms = this.getAudioUnitTerms();
            detail.textContent = total
                ? `${done}/${total} in this job (${percent}%) · ${remainingInJob} remaining · ${generated}/${this.segments.length} total MP3 ${terms.plural} ready`
                : `${generated}/${this.segments.length} total MP3 ${terms.plural} ready`;
        }
    }

    preloadNextGenerated() {
        const currentIndex = this.getCurrentSegmentIndex();
        const next = this.segments.find(segment => segment.segmentIndex > currentIndex && this.isSegmentPlayable(segment));
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

    resetAudioPlayerForBookSwitch() {
        this.stopGeneration();
        this.rebuildAudioPlanArmed = false;
        const rebuildButton = document.getElementById('rebuildAudioPlanBtn');
        if (rebuildButton) rebuildButton.textContent = 'Rebuild sentence-safe audio plan';
        this.aiQuestionVoiceCore?.stopListening();
        this.aiQuestionAbort?.abort();
        this.aiQuestionAbort = null;
        this.aiQuestionInFlight = false;
        this.stopAiQuestionTimer(true);
        this.setAiQuestionBusy(false);
        this.stopAiAnswerSpeech();
        const questionPanel = document.getElementById('aiQuestionPanel');
        if (questionPanel) questionPanel.style.display = 'none';
        this.aiQuestionSegmentId = null;
        this.lastAiAnswer = '';
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            audio.removeAttribute('data-segment-id');
            audio.load();
        }
        this.releaseAudioUrls();
        this.lastAudioTimeForHistory = 0;
        this.updatePlayerControls();
    }

    goToLatestRead() {
        const sectionId = this.currentBook?.readingSectionId || this.sections[0]?.id || '';
        this.scrollReaderToSection(sectionId);
    }

    goToPlayingSection() {
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        const segment = this.getSegmentById(audio?.dataset.segmentId || this.currentSegmentId || '');
        if (segment) this.scrollReaderToSection(segment.sectionId);
    }

    /** @param {string} sectionId */
    scrollReaderToSection(sectionId) {
        const node = document.getElementById(`reader-${sectionId}`);
        if (node) node.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    updateCurrentSegmentClass() {
        document.querySelectorAll('.reader-segment.current').forEach(node => node.classList.remove('current'));
        if (!this.currentSegmentId) return;
        const node = document.querySelector(`.reader-segment[data-segment-id="${CSS.escape(this.currentSegmentId)}"]`);
        if (node) node.classList.add('current');
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        const segment = this.getSegmentById(this.currentSegmentId);
        const ratio = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? (audio.currentTime || 0) / audio.duration : 0;
        if (segment) this.updateReadAlongProgress(segment, ratio);
    }

    /** @param {AudioSegment} segment @param {number} ratio */
    updateReadAlongProgress(segment, ratio) {
        document.querySelectorAll('.reader-segment').forEach(node => {
            if (node instanceof HTMLElement) node.style.setProperty('--read-progress', '0%');
        });
        const node = document.querySelector(`.reader-segment[data-segment-id="${CSS.escape(segment.id)}"]`);
        if (node instanceof HTMLElement) {
            const percent = `${Math.max(0, Math.min(100, ratio * 100))}%`;
            node.style.setProperty('--read-progress', percent);
        }
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

    hasSplitChapters() {
        return this.sections.some(section => this.segments.filter(segment => segment.sectionId === section.id).length > 1);
    }

    getAudioUnitTerms() {
        return this.hasSplitChapters()
            ? { singular: 'audio part', plural: 'audio parts' }
            : { singular: 'chapter', plural: 'chapters' };
    }

    getCurrentGeneratedSegment() {
        const segment = this.getSegmentById(this.currentSegmentId || '');
        return this.isSegmentPlayable(segment) ? segment : null;
    }

    /** @param {string} id */
    getSegmentById(id) {
        return this.segments.find(segment => segment.id === id) || null;
    }

    /** @param {string} sectionId */
    getSectionTitle(sectionId) {
        return this.sections.find(section => section.id === sectionId)?.title || 'Section';
    }

    /** @param {BookSection} section */
    getChapterLabel(section) {
        const inferred = this.getInferredChapterLabels().get(section.id);
        if (inferred) return inferred;
        const title = (section.title || '').trim();
        const numbered = /^(chapter|part|book|section|page|prologue|epilogue)\b/i.test(title);
        if (!title) return `Chapter ${section.spineIndex + 1}`;
        if (numbered) return title;
        return `Chapter ${section.spineIndex + 1}: ${title}`;
    }

    getInferredChapterLabels() {
        const labels = new Map();
        const parsed = this.sections.map(section => this.parseChapterLikeTitle(section.title));
        let bestStart = -1;
        let bestLength = 0;
        for (let i = 0; i < parsed.length; i++) {
            if (parsed[i]?.number !== 1) continue;
            let length = 1;
            for (let j = i + 1; j < parsed.length; j++) {
                if (parsed[j]?.number !== length + 1) break;
                length++;
            }
            if (length > bestLength) {
                bestStart = i;
                bestLength = length;
            }
        }
        if (bestStart <= 0 || bestLength < 2) return labels;

        for (let i = 0; i < bestStart; i++) {
            const title = (this.sections[i].title || '').trim();
            const parsedTitle = parsed[i];
            const suffix = title && !parsedTitle?.number ? `: ${title}` : '';
            labels.set(this.sections[i].id, `Front matter ${i + 1}${suffix}`);
        }

        for (let i = bestStart; i < bestStart + bestLength; i++) {
            const parsedTitle = parsed[i];
            if (!parsedTitle) continue;
            const suffix = parsedTitle.suffix ? `: ${parsedTitle.suffix}` : '';
            labels.set(this.sections[i].id, `Chapter ${parsedTitle.number}${suffix}`);
        }

        for (let i = bestStart + bestLength; i < this.sections.length; i++) {
            const title = (this.sections[i].title || '').trim();
            const parsedTitle = parsed[i];
            if (parsedTitle) {
                const suffix = parsedTitle.suffix ? `: ${parsedTitle.suffix}` : '';
                labels.set(this.sections[i].id, `Chapter ${parsedTitle.number}${suffix}`);
            } else if (title) {
                labels.set(this.sections[i].id, title);
            }
        }

        return labels;
    }

    /** @param {string} title */
    parseChapterLikeTitle(title) {
        const clean = (title || '').trim();
        if (!clean) return null;
        const chapterMatch = clean.match(/^chapter\s+(\d+)\b\s*[:.\-]?\s*(.*)$/i);
        if (chapterMatch) {
            return { number: Number(chapterMatch[1]), suffix: chapterMatch[2].trim() };
        }
        const numericMatch = clean.match(/^(\d+)\b\s*[:.\-]?\s*(.*)$/);
        if (numericMatch) {
            return { number: Number(numericMatch[1]), suffix: numericMatch[2].trim() };
        }
        return null;
    }

    /** @param {Settings | null | undefined} settings */
    settingsSummary(settings) {
        if (!settings) return 'Unknown voice settings';
        const voice = OPENAI_TTS_VOICES.find(item => item.id === settings.voice)?.label || settings.voice || 'Unknown voice';
        const model = OPENAI_TTS_MODELS.find(item => item.id === settings.model)?.label || settings.model || 'Unknown model';
        const accent = OPENAI_TTS_ACCENTS.find(item => item.id === settings.accent)?.label || 'Default';
        const style = OPENAI_TTS_STYLES.find(item => item.id === settings.style)?.label || 'Audiobook narrator';
        return `${voice} · ${model} · ${this.formatSpeed(settings.speed || 1)}x · ${accent} · ${style}`;
    }

    /** @param {AudioSegment[]} segments */
    estimateConversionCost(segments) {
        return segments.reduce((sum, segment) => sum + this.estimateSegmentCost(segment), 0);
    }

    /** @param {AudioSegment} segment */
    estimateSegmentCost(segment) {
        const model = segment.audioSettings?.model || this.settings.model;
        if (model === 'tts-1') return segment.text.length * 15 / 1000000;
        if (model === 'tts-1-hd') return segment.text.length * 30 / 1000000;
        const seconds = segment.durationSec || segment.estimatedDurationSec || 0;
        return seconds / 60 * 0.015;
    }

    /** @param {BookRecord} book */
    getBookReadPercent(book) {
        if (!book.charCount) return 0;
        return Math.max(0, Math.min(100, Math.round((book.readingCharOffset || 0) / book.charCount * 100)));
    }

    /** @param {BookRecord} book */
    getBookGeneratedPercent(book) {
        if (!book.estimatedDurationSec) return 0;
        return Math.max(0, Math.min(100, Math.round((book.generatedDurationSec || 0) / book.estimatedDurationSec * 100)));
    }

    /** @param {BookRecord} book */
    isBookArchived(book) {
        return Boolean(book.archivedAt);
    }

    /** @param {AudioSegment | null | undefined} segment */
    isSegmentPlayable(segment) {
        return Boolean(segment?.blob);
    }

    /** @param {AudioSegment} segment */
    isSegmentPending(segment) {
        return !this.isSegmentPlayable(segment);
    }

    /**
     * Page reloads can leave chunks stuck as "generating" with no blob.
     * Treat those as pending again so +15 / +1 hour can fill them.
     */
    async recoverInterruptedGenerationStates() {
        if (!this.storage) return;
        let changed = false;
        for (const segment of this.segments) {
            if (segment.status !== 'generating' || this.isSegmentPlayable(segment)) continue;
            segment.status = 'pending';
            segment.error = '';
            await this.storage.putSegment(segment);
            this.replaceSegment(segment);
            changed = true;
        }
        if (changed) this.log('info', 'Reset interrupted MP3 generations so missing audio can be filled');
    }

    /** @param {string} message */
    isFatalSpeechError(message) {
        const lower = message.toLowerCase();
        return lower.includes('invalid api key')
            || lower.includes('incorrect api key')
            || lower.includes('authentication')
            || lower.includes('insufficient_quota')
            || lower.includes('exceeded your current quota')
            || lower.includes('billing')
            || lower.includes('rate limit');
    }

    /** @param {AudioSegment} segment */
    async repairPlayableSegmentMetadata(segment) {
        if (!this.isSegmentPlayable(segment)) return;
        let changed = false;
        if (segment.status !== 'done') {
            segment.status = 'done';
            segment.error = '';
            changed = true;
        }
        if (!segment.audioSize && segment.blob) {
            segment.audioSize = segment.blob.size;
            changed = true;
        }
        if (!segment.generatedAt) {
            segment.generatedAt = new Date().toISOString();
            changed = true;
        }
        if (!segment.durationSec) {
            segment.durationSec = segment.estimatedDurationSec;
            changed = true;
        }
        if (changed && this.storage) {
            await this.storage.putSegment(segment);
            this.replaceSegment(segment);
        }
    }

    /** @param {number} charOffset */
    estimateWordOffset(charOffset) {
        if (!this.currentBook?.charCount || !this.currentBook.wordCount) return 0;
        return Math.round(Math.max(0, Math.min(1, charOffset / this.currentBook.charCount)) * this.currentBook.wordCount);
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

    /** @param {number} seconds */
    formatDurationHtml(seconds) {
        const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
        const totalMinutes = Math.max(0, Math.round(safeSeconds / 60));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const label = this.formatDuration(seconds);
        return `
            <span class="duration-value" aria-label="${this.escapeHtml(label)}">
                <span class="duration-number">${this.formatPaddedNumberHtml(hours, 2)}</span><span class="duration-unit">h</span>
                <span class="duration-number">${this.formatPaddedNumberHtml(minutes, 2)}</span><span class="duration-unit">m</span>
            </span>
        `;
    }

    /** @param {number} value @param {number} width */
    formatPaddedNumberHtml(value, width) {
        const text = String(Math.max(0, Math.floor(value)));
        const padLength = Math.max(0, width - text.length);
        const pad = Array.from({ length: padLength }, () => '<span class="numeric-placeholder">0</span>').join('');
        return `${pad}${this.escapeHtml(text)}`;
    }

    /** @param {number} value */
    formatSpeed(value) {
        return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
    }

    /** @param {number} value */
    formatCurrency(value) {
        if (value < 0.01) return `$${value.toFixed(4)}`;
        return `$${value.toFixed(2)}`;
    }

    /** @param {number} seconds */
    formatClock(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
        const whole = Math.floor(seconds);
        const mins = Math.floor(whole / 60);
        const secs = whole % 60;
        return `${mins}:${String(secs).padStart(2, '0')}`;
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
        const section = this.sections.find(item => item.id === segment.sectionId);
        const chapterPart = section
            ? `${String(section.spineIndex + 1).padStart(3, '0')}-${this.safeFilename(section.title).slice(0, 48)}`
            : String(segment.segmentIndex + 1).padStart(4, '0');
        return `${this.safeFilename(book.title)}-${chapterPart}-chunk-${String(segment.sectionSegmentIndex + 1).padStart(2, '0')}.mp3`;
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

    /**
     * @param {string} action
     * @param {string} detail
     * @param {number} [listenedSec]
     * @param {number} [readSec]
     * @param {number} [readWords]
     */
    recordHistory(action, detail, listenedSec = 0, readSec = 0, readWords = 0) {
        if (!this.storage || !this.currentBook) return;
        const segment = this.getSegmentById(this.currentSegmentId || this.currentBook.listeningSegmentId || '');
        const audio = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        const now = new Date();
        const entry = {
            id: this.createId('history'),
            bookId: this.currentBook.id,
            dateKey: this.dateKey(now),
            timestamp: now.toISOString(),
            action,
            segmentId: segment?.id || '',
            sectionId: segment?.sectionId || this.currentBook.readingSectionId || '',
            segmentIndex: segment?.segmentIndex ?? -1,
            positionSec: audio?.currentTime || this.currentBook.listeningOffsetSec || 0,
            durationSec: Number.isFinite(audio?.duration) ? audio.duration : segment?.durationSec || segment?.estimatedDurationSec || 0,
            listenedSec,
            readSec,
            readWords,
            detail
        };
        this.historyEntries.unshift(entry);
        this.storage.putHistory(entry);
        if (document.getElementById('historyPanel')?.style.display !== 'none') this.renderHistoryPanel();
    }

    /** @param {Date} date */
    dateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /** @param {boolean} show */
    showHistoryPanel(show) {
        const panel = document.getElementById('historyPanel');
        if (panel) panel.style.display = show ? 'block' : 'none';
        if (show) this.renderHistoryPanel();
    }

    renderHistoryPanel() {
        const summaryEl = document.getElementById('historySummary');
        const listEl = document.getElementById('historyList');
        if (!summaryEl || !listEl) return;
        const byDay = new Map();
        for (const entry of this.historyEntries) {
            if (!byDay.has(entry.dateKey)) byDay.set(entry.dateKey, { listened: 0, read: 0, words: 0, events: 0 });
            const day = byDay.get(entry.dateKey);
            day.listened += entry.listenedSec || 0;
            day.read += entry.readSec || 0;
            day.words += entry.readWords || 0;
            day.events++;
        }
        const dayRows = Array.from(byDay.entries()).slice(0, 7).map(([day, totals]) => {
            const wpm = totals.read > 30 && totals.words > 0 ? ` · read ~${Math.round(totals.words / (totals.read / 60))} wpm` : '';
            return `<div>${this.escapeHtml(day)}: listened ${this.formatDuration(totals.listened)} · read ${this.formatDuration(totals.read)}${wpm} · ${totals.events} events</div>`;
        });
        summaryEl.innerHTML = dayRows.length ? dayRows.join('') : '<div>No history yet.</div>';
        listEl.innerHTML = this.historyEntries.slice(0, 120).map(entry => {
            const date = new Date(entry.timestamp);
            const section = entry.sectionId ? this.getSectionTitle(entry.sectionId) : 'Book';
            const segment = entry.segmentIndex >= 0 ? `seg ${entry.segmentIndex + 1}` : '';
            return `<div class="history-item">${this.escapeHtml(date.toLocaleString())} · ${this.escapeHtml(entry.action)} · ${this.escapeHtml(section)} ${this.escapeHtml(segment)} · ${this.escapeHtml(entry.detail)}</div>`;
        }).join('');
    }

    clearLog() {
        const logContent = document.getElementById('logContent');
        if (logContent) logContent.innerHTML = '';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BooksController();
});
