// @ts-check
// Books storage: the IndexedDB database holding every saved book, its reader
// sections and audio parts, the listening history, and saved research. The
// record shapes below are what the stores hold.

const EBOOK_DB_NAME = 'voice-wei-books';
const EBOOK_DB_VERSION = 5;
const BOOK_STORE = 'books';
const SECTION_STORE = 'sections';
const SEGMENT_STORE = 'segments';
const HISTORY_STORE = 'history';
const RESEARCH_STORE = 'research';

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
 * @property {BooksSettings | null} audioSettings
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
 * @property {BookResearchCitation[]} citations
 * @property {BookResearchSource[]} sources
 * @property {BookResearchImage[]} images
 * @property {Record<string, any>} request
 * @property {string} modelLabel
 * @property {number} elapsedMs
 * @property {boolean} spokenAtReturn
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

window.BooksStorage = BooksStorage;
