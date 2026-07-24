// @ts-check
// Books-specific fast checks: local library shape, reader mode, custom player,
// and local history. These are intentionally browser-level because the feature
// depends on IndexedDB, Blob URLs, and DOM layout.

const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

async function clearBooksDb(page) {
    await page.evaluate(async () => {
        await new Promise(resolve => {
            const deleteRequest = indexedDB.deleteDatabase('voice-wei-books');
            deleteRequest.onsuccess = () => resolve(undefined);
            deleteRequest.onerror = () => resolve(undefined);
            deleteRequest.onblocked = () => resolve(undefined);
        });
    });
}

async function seedGeneratedBook(page) {
    await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('voice-wei-books', 5);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const put = (store, value) => new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).put(value);
            req.onsuccess = () => resolve(undefined);
            req.onerror = () => reject(req.error);
        });
        const now = new Date().toISOString();
        const book = {
            id: 'book-suite-generated',
            schemaVersion: 3,
            title: 'Generated Suite Book',
            author: 'Suite',
            format: 'txt',
            fileName: 'generated-suite.txt',
            fileType: 'text/plain',
            fileSize: 20,
            rawFile: new Blob(['suite'], { type: 'text/plain' }),
            sectionCount: 1,
            segmentCount: 2,
            generatedSegmentCount: 2,
            wordCount: 20,
            charCount: 200,
            estimatedDurationSec: 720,
            generatedDurationSec: 720,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: now,
            readingSectionId: 'sec-0',
            readingCharOffset: 0,
            listeningSegmentId: 'seg-0',
            listeningOffsetSec: 0,
            legacyAudioBlob: null,
            legacyAudioSize: 0
        };
        const section = {
            key: 'book-suite-generated:sec-0',
            bookId: book.id,
            id: 'sec-0',
            spineIndex: 0,
            title: 'Section',
            text: 'First segment. Second segment.',
            html: '',
            charStart: 0,
            charEnd: 200,
            wordCount: 20
        };
        const segment = (id, index) => ({
            key: `book-suite-generated:${id}`,
            bookId: book.id,
            id,
            sectionId: 'sec-0',
            segmentIndex: index,
            sectionSegmentIndex: index,
            charStart: index * 100,
            charEnd: index * 100 + 99,
            text: `Segment ${index}`,
            wordCount: 10,
            estimatedDurationSec: 360,
            status: index === 1 ? 'pending' : 'done',
            blob: new Blob([`fake-${id}`], { type: 'audio/mpeg' }),
            audioSize: 10,
            durationSec: 360,
            generatedAt: now,
            audioSettings: { voice: 'alloy', model: 'tts-1', speed: 1 },
            error: ''
        });
        await put('books', book);
        await put('sections', section);
        await put('segments', segment('seg-0', 0));
        await put('segments', segment('seg-1', 1));
        db.close();
    });
}

async function seedGapBook(page) {
    await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('voice-wei-books', 5);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const put = (store, value) => new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).put(value);
            req.onsuccess = () => resolve(undefined);
            req.onerror = () => reject(req.error);
        });
        const now = new Date().toISOString();
        const book = {
            id: 'book-suite-gap',
            schemaVersion: 3,
            title: 'Gap Suite Book',
            author: 'Suite',
            format: 'txt',
            fileName: 'gap-suite.txt',
            fileType: 'text/plain',
            fileSize: 20,
            rawFile: new Blob(['suite'], { type: 'text/plain' }),
            sectionCount: 1,
            segmentCount: 6,
            generatedSegmentCount: 0,
            wordCount: 60,
            charCount: 600,
            estimatedDurationSec: 1800,
            generatedDurationSec: 0,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: now,
            readingSectionId: 'sec-gap',
            readingCharOffset: 0,
            listeningSegmentId: 'seg-gap-0',
            listeningOffsetSec: 0,
            legacyAudioBlob: null,
            legacyAudioSize: 0
        };
        const section = {
            key: 'book-suite-gap:sec-gap',
            bookId: book.id,
            id: 'sec-gap',
            spineIndex: 0,
            title: 'Section',
            text: 'Six pending chunks for duration enqueue checks.',
            html: '',
            charStart: 0,
            charEnd: 600,
            wordCount: 60
        };
        const segment = (index) => ({
            key: `book-suite-gap:seg-gap-${index}`,
            bookId: book.id,
            id: `seg-gap-${index}`,
            sectionId: 'sec-gap',
            segmentIndex: index,
            sectionSegmentIndex: index,
            charStart: index * 100,
            charEnd: index * 100 + 99,
            text: `DURATION_CHUNK_${index}`,
            wordCount: 10,
            estimatedDurationSec: 300,
            status: 'pending',
            blob: null,
            audioSize: 0,
            durationSec: 0,
            generatedAt: '',
            audioSettings: null,
            error: ''
        });
        await put('books', book);
        await put('sections', section);
        for (let index = 0; index < 6; index++) await put('segments', segment(index));
        db.close();
    });
}

async function seedSecondGeneratedBook(page) {
    await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('voice-wei-books', 5);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const put = (store, value) => new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).put(value);
            req.onsuccess = () => resolve(undefined);
            req.onerror = () => reject(req.error);
        });
        const now = new Date().toISOString();
        const book = {
            id: 'book-suite-generated-two',
            schemaVersion: 3,
            title: 'Generated Suite Book Two',
            author: 'Suite',
            format: 'txt',
            fileName: 'generated-suite-two.txt',
            fileType: 'text/plain',
            fileSize: 20,
            rawFile: new Blob(['suite two'], { type: 'text/plain' }),
            sectionCount: 1,
            segmentCount: 1,
            generatedSegmentCount: 1,
            wordCount: 10,
            charCount: 100,
            estimatedDurationSec: 360,
            generatedDurationSec: 360,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: now,
            archivedAt: '',
            readingSectionId: 'sec-b',
            readingCharOffset: 0,
            listeningSegmentId: 'seg-b0',
            listeningOffsetSec: 0,
            legacyAudioBlob: null,
            legacyAudioSize: 0
        };
        await put('books', book);
        await put('sections', {
            key: 'book-suite-generated-two:sec-b',
            bookId: book.id,
            id: 'sec-b',
            spineIndex: 0,
            title: 'Section Two',
            text: 'Only segment.',
            html: '',
            charStart: 0,
            charEnd: 100,
            wordCount: 10
        });
        await put('segments', {
            key: 'book-suite-generated-two:seg-b0',
            bookId: book.id,
            id: 'seg-b0',
            sectionId: 'sec-b',
            segmentIndex: 0,
            sectionSegmentIndex: 0,
            charStart: 0,
            charEnd: 100,
            text: 'Only segment.',
            wordCount: 10,
            estimatedDurationSec: 360,
            status: 'done',
            blob: new Blob(['fake-second-book'], { type: 'audio/mpeg' }),
            audioSize: 10,
            durationSec: 360,
            generatedAt: now,
            audioSettings: { voice: 'verse', model: 'gpt-4o-mini-tts', speed: 1 },
            error: ''
        });
        db.close();
    });
}

async function seedFrontMatterBook(page) {
    await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('voice-wei-books', 5);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const put = (store, value) => new Promise((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).put(value);
            req.onsuccess = () => resolve(undefined);
            req.onerror = () => reject(req.error);
        });
        const now = new Date().toISOString();
        const book = {
            id: 'book-suite-front-matter',
            schemaVersion: 3,
            title: 'Front Matter Suite Book',
            author: 'Suite',
            format: 'txt',
            fileName: 'front-matter-suite.txt',
            fileType: 'text/plain',
            fileSize: 20,
            rawFile: new Blob(['suite'], { type: 'text/plain' }),
            sectionCount: 6,
            segmentCount: 6,
            generatedSegmentCount: 0,
            wordCount: 60,
            charCount: 600,
            estimatedDurationSec: 360,
            generatedDurationSec: 0,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: now,
            archivedAt: '',
            readingSectionId: 'sec-0',
            readingCharOffset: 0,
            listeningSegmentId: 'seg-0',
            listeningOffsetSec: 0,
            legacyAudioBlob: null,
            legacyAudioSize: 0
        };
        const titles = ['Chapter 2', 'Contents', '1', '2', '3', "Author's Note"];
        await put('books', book);
        for (let index = 0; index < titles.length; index++) {
            const sectionId = `sec-${index}`;
            await put('sections', {
                key: `book-suite-front-matter:${sectionId}`,
                bookId: book.id,
                id: sectionId,
                spineIndex: index,
                title: titles[index],
                text: `${titles[index]} text.`,
                html: '',
                charStart: index * 100,
                charEnd: index * 100 + 99,
                wordCount: 10
            });
            await put('segments', {
                key: `book-suite-front-matter:seg-${index}`,
                bookId: book.id,
                id: `seg-${index}`,
                sectionId,
                segmentIndex: index,
                sectionSegmentIndex: 0,
                charStart: index * 100,
                charEnd: index * 100 + 99,
                text: `${titles[index]} text.`,
                wordCount: 10,
                estimatedDurationSec: 60,
                status: 'pending',
                blob: null,
                audioSize: 0,
                durationSec: 0,
                generatedAt: '',
                audioSettings: null,
                error: ''
            });
        }
        db.close();
    });
}

(async () => {
    const report = createReporter('books');
    const browser = await launch();

    {
        const page = await browser.newPage({ viewport: { width: 460, height: 900 } });
        collectErrors(page, 'books-library', report.errors);
        await page.goto(`${BASE_URL}/ebook.html`, { waitUntil: 'load' });
        await clearBooksDb(page);
        await page.reload({ waitUntil: 'load' });

        for (const [index, name] of ['one', 'two'].entries()) {
            await page.setInputFiles('#fileInput', {
                name: `${name}.txt`,
                mimeType: 'text/plain',
                buffer: Buffer.from(`${name} text `.repeat(120))
            });
            await page.waitForFunction(({ expectedCount, title }) => {
                return document.querySelectorAll('.saved-book-item').length === expectedCount
                    && !document.querySelector('.books-shell')?.classList.contains('book-open')
                    && document.querySelector('#status')?.textContent?.includes(`Imported ${title} and added`);
            }, { expectedCount: index + 1, title: name });
        }

        const shelf = await page.evaluate(async () => {
            const rows = Array.from(document.querySelectorAll('.saved-book-item'));
            const first = rows[0];
            const rect = first.getBoundingClientRect();
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('voice-wei-books', 5);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const segments = await new Promise((resolve, reject) => {
                const tx = db.transaction('segments', 'readonly');
                const req = tx.objectStore('segments').getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            return {
                rowCount: rows.length,
                rowHeight: rect.height,
                titleNowrap: getComputedStyle(first.querySelector('.saved-book-title')).whiteSpace,
                metaNowrap: getComputedStyle(first.querySelector('.saved-book-meta')).whiteSpace,
                metaText: first.querySelector('.saved-book-meta')?.textContent || '',
                durationColumns: first.querySelectorAll('.duration-value .duration-number').length,
                inlineButtons: first.querySelectorAll('button, [data-action]').length,
                archiveToggleText: document.querySelector('#toggleArchiveViewBtn')?.textContent || '',
                libraryDisplay: getComputedStyle(document.querySelector('.books-library-panel')).display,
                workspaceVisible: getComputedStyle(document.querySelector('#bookWorkspace')).display !== 'none',
                summaryText: document.querySelector('#libraryProgressSummary')?.textContent || '',
                librarySearchPlaceholder: document.querySelector('#librarySearch')?.getAttribute('placeholder') || '',
                exactSegmentOffsets: segments.every(segment =>
                    segment.text === segment.text.trim()
                    && segment.text.length === segment.charEnd - segment.charStart)
            };
        });
        report.check(`books import stays on shelf with overall progress (rows=${shelf.rowCount}, height=${shelf.rowHeight})`,
            shelf.rowCount === 2 && shelf.rowHeight <= 42
            && shelf.titleNowrap === 'nowrap' && shelf.metaNowrap === 'nowrap'
            && !shelf.metaText.includes('TXT') && shelf.metaText.includes('Read') && shelf.metaText.includes('Audio')
            && shelf.durationColumns === 2 && shelf.archiveToggleText === 'Show archive'
            && shelf.inlineButtons === 0 && shelf.libraryDisplay !== 'none' && !shelf.workspaceVisible
            && shelf.librarySearchPlaceholder.includes('titles, authors, and filenames')
            && shelf.summaryText.includes('Overall progress') && shelf.summaryText.includes('2 books') && shelf.summaryText.includes('audio')
            && shelf.exactSegmentOffsets);

        await page.click('.saved-book-item[data-book-id]');
        await page.waitForFunction(() => document.querySelector('.books-shell')?.classList.contains('book-open'));
        const opened = await page.evaluate(() => ({
            libraryHidden: getComputedStyle(document.querySelector('.books-library-panel')).display === 'none',
            workspaceVisible: getComputedStyle(document.querySelector('#bookWorkspace')).display !== 'none',
            backText: document.querySelector('#backToLibraryBtn')?.textContent || '',
            hasSpinePanel: Boolean(document.querySelector('.spine-panel, #spineList')),
            advancedAudioOpen: document.querySelector('.audio-parts-advanced')?.open,
            chapterOptionText: document.querySelector('#generationChapterSelect option')?.textContent || ''
        }));
        report.check('books open into book-only mode with no interior spine panel',
            opened.libraryHidden && opened.workspaceVisible && opened.backText.includes('Bookshelf') && !opened.hasSpinePanel
            && !opened.advancedAudioOpen && opened.chapterOptionText.includes('generated') && !opened.chapterOptionText.includes('chunk'));
        await page.click('#toggleArchiveCurrentBookBtn');
        await page.click('#backToLibraryBtn');
        await page.waitForFunction(() => !document.querySelector('.books-shell')?.classList.contains('book-open'));
        const archivedMain = await page.evaluate(() => ({
            rowCount: document.querySelectorAll('.saved-book-item').length,
            status: document.querySelector('#status')?.textContent || ''
        }));
        await page.click('#toggleArchiveViewBtn');
        await page.waitForFunction(() => document.querySelector('#toggleArchiveViewBtn')?.textContent === 'Show main list');
        const archivedView = await page.evaluate(() => ({
            rowCount: document.querySelectorAll('.saved-book-item').length,
            summary: document.querySelector('#libraryProgressSummary')?.textContent || ''
        }));
        await page.click('.saved-book-item[data-book-id]');
        await page.waitForFunction(() => document.querySelector('.books-shell')?.classList.contains('book-open'));
        const restoreText = await page.evaluate(() => document.querySelector('#toggleArchiveCurrentBookBtn')?.textContent || '');
        await page.click('#toggleArchiveCurrentBookBtn');
        await page.click('#backToLibraryBtn');
        await page.waitForFunction(() => !document.querySelector('.books-shell')?.classList.contains('book-open'));
        const restoredArchiveRows = await page.evaluate(() => document.querySelectorAll('.saved-book-item').length);
        await page.click('#toggleArchiveViewBtn');
        await page.waitForFunction(() => document.querySelector('#toggleArchiveViewBtn')?.textContent === 'Show archive');
        const restoredMainRows = await page.evaluate(() => document.querySelectorAll('.saved-book-item').length);
        report.check('books can move a book to archive and view archived shelf',
            archivedMain.rowCount === 1 && archivedMain.status.includes('Bookshelf')
            && archivedView.rowCount === 1 && archivedView.summary.includes('Archive progress')
            && restoreText === 'Restore to main list'
            && restoredArchiveRows === 0 && restoredMainRows === 2);
        await page.close();
    }

    {
        const page = await browser.newPage();
        collectErrors(page, 'books-sentence-boundaries', report.errors);
        await page.goto(`${BASE_URL}/ebook.html`, { waitUntil: 'load' });
        await clearBooksDb(page);
        await page.reload({ waitUntil: 'load' });
        const hardWrappedSentence = `${'This sentence continues across a visual line wrap without ending\n'.repeat(56)}and finally ends here."`;
        const following = ` Second sentence begins cleanly. ${'More ordinary prose follows. '.repeat(80)}`;
        const sourceText = [
            'CONTENTS',
            'CHAPTER 1. First.',
            'CHAPTER 2. Second.',
            '',
            'This front matter explains the edition. '.repeat(12),
            '',
            'CHAPTER 1. First.',
            hardWrappedSentence + following,
            '',
            'CHAPTER 2. Second.',
            `Short intro. ${'This deliberately long sentence continues without terminal punctuation across another visual line\n'.repeat(60)}and eventually ends.`
        ].join('\n');
        await page.setInputFiles('#fileInput', {
            name: 'hard-wrapped.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(sourceText)
        });
        await page.waitForFunction(() => document.querySelectorAll('.saved-book-item').length === 1);
        const parsedText = await page.evaluate(async () => {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('voice-wei-books', 5);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const segments = await new Promise((resolve, reject) => {
                const tx = db.transaction('segments', 'readonly');
                const req = tx.objectStore('segments').getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const sections = await new Promise((resolve, reject) => {
                const tx = db.transaction('sections', 'readonly');
                const req = tx.objectStore('sections').getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            segments.sort((a, b) => a.segmentIndex - b.segmentIndex);
            sections.sort((a, b) => a.spineIndex - b.spineIndex);
            return {
                boundaries: segments.map(segment => segment.text),
                sectionTitles: sections.map(section => section.title)
            };
        });
        const boundaries = parsedText.boundaries;
        report.check('books ignore hard-wrapped newlines and split MP3 audio at sentence endings',
            boundaries.length >= 2
            && boundaries.slice(0, 4).every(text => /[.!?]["'”’)]?$/.test(text))
            && !boundaries.some(text => text.endsWith('without ending'))
            && boundaries.every(text => text.length <= 3800));
        const shortSentenceIndex = boundaries.findIndex(text => text.endsWith('Short intro.'));
        report.check('books prefer a short complete sentence over cutting the following long sentence',
            shortSentenceIndex !== -1
            && boundaries[shortSentenceIndex + 1]?.startsWith('This deliberately long sentence'));
        report.check('books infer real TXT chapter headings instead of exposing arbitrary parts',
            parsedText.sectionTitles.includes('CHAPTER 1. First.')
            && parsedText.sectionTitles.includes('CHAPTER 2. Second.')
            && !parsedText.sectionTitles.some(title => /^Part \d+/.test(title)));
        await page.click('.saved-book-item[data-book-id]');
        await page.click('.audio-parts-advanced > summary');
        await page.click('#rebuildAudioPlanBtn');
        const armedRebuild = await page.evaluate(() => ({
            button: document.querySelector('#rebuildAudioPlanBtn')?.textContent || '',
            status: document.querySelector('#status')?.textContent || ''
        }));
        await page.click('#rebuildAudioPlanBtn');
        await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('sentence-safe boundaries'));
        report.check('books require explicit confirmation before rebuilding the sentence-safe audio plan',
            armedRebuild.button.includes('Confirm')
            && armedRebuild.status.includes('deletes every generated MP3'));
        await page.evaluate(async () => {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('voice-wei-books', 5);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const sections = await new Promise((resolve, reject) => {
                const tx = db.transaction('sections', 'readonly');
                const req = tx.objectStore('sections').getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const segments = await new Promise((resolve, reject) => {
                const tx = db.transaction('segments', 'readonly');
                const req = tx.objectStore('segments').getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            for (let index = 0; index < sections.length; index++) {
                sections[index].title = `Part ${index + 1}`;
                await new Promise((resolve, reject) => {
                    const tx = db.transaction('sections', 'readwrite');
                    const req = tx.objectStore('sections').put(sections[index]);
                    req.onsuccess = () => resolve(undefined);
                    req.onerror = () => reject(req.error);
                });
            }
            await new Promise((resolve, reject) => {
                const tx = db.transaction('books', 'readwrite');
                const store = tx.objectStore('books');
                const get = store.get(sections[0].bookId);
                get.onsuccess = () => {
                    delete get.result.audioPlanVersion;
                    const laterSegment = segments[Math.min(2, segments.length - 1)];
                    get.result.readingCharOffset = 0;
                    get.result.listeningSegmentId = laterSegment.id;
                    get.result.listeningOffsetSec = laterSegment.estimatedDurationSec / 2;
                    const put = store.put(get.result);
                    put.onsuccess = () => resolve(undefined);
                    put.onerror = () => reject(put.error);
                };
                get.onerror = () => reject(get.error);
            });
            db.close();
        });
        await page.reload({ waitUntil: 'load' });
        await page.click('.saved-book-item[data-book-id]');
        await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('sentence-safe boundaries'));
        const migratedState = await page.evaluate(async () => {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('voice-wei-books', 5);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const book = await new Promise((resolve, reject) => {
                const tx = db.transaction('books', 'readonly');
                const req = tx.objectStore('books').getAll();
                req.onsuccess = () => resolve(req.result[0]);
                req.onerror = () => reject(req.error);
            });
            db.close();
            return {
                labels: Array.from(document.querySelectorAll('#generationChapterSelect option')).map(option => option.textContent || ''),
                readingCharOffset: book.readingCharOffset,
                listeningSegmentId: book.listeningSegmentId,
                listeningOffsetSec: book.listeningOffsetSec
            };
        });
        report.check('books automatically replace legacy Part plans when no generated audio would be lost',
            migratedState.labels.some(label => label.includes('Chapter 1: First.'))
            && !migratedState.labels.some(label => /^Part \d+/.test(label)));
        report.check('books preserve listening separately from reading while rebuilding audio',
            migratedState.readingCharOffset === 0
            && migratedState.listeningSegmentId !== 'seg-0'
            && migratedState.listeningOffsetSec > 0);
        await page.close();
    }

    {
        const page = await browser.newPage();
        collectErrors(page, 'books-player', report.errors);
        await page.addInitScript(() => {
            localStorage.setItem('voice-wei:api-key:openai', 'sk-test-books-suite');
            /** @type {any} */ (window).SpeechRecognition = class {
                start() {
                    this.onstart?.();
                    setTimeout(() => {
                        const result = [{ transcript: 'What does this passage mean?' }];
                        result.isFinal = true;
                        this.onresult?.({ resultIndex: 0, results: [result] });
                        this.onend?.();
                    }, 0);
                }
                stop() {
                    this.onend?.();
                }
            };
        });
        await page.goto(`${BASE_URL}/ebook.html`, { waitUntil: 'load' });
        await clearBooksDb(page);
        await page.reload({ waitUntil: 'load' });
        await seedGeneratedBook(page);
        await seedSecondGeneratedBook(page);
        await page.reload({ waitUntil: 'load' });
        await page.click('.saved-book-item[data-book-id="book-suite-generated"]');
        await page.waitForSelector('#bookWorkspace[style*="block"]');
        await page.evaluate(() => {
            Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 360; } });
            window.__bookScrollCalls = [];
            Element.prototype.scrollIntoView = function () {
                window.__bookScrollCalls.push(this.id || this.getAttribute('data-segment-id') || this.className || 'unknown');
            };
            window.__bookMediaPaused = true;
            Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
                configurable: true,
                get() { return window.__bookMediaPaused; }
            });
            window.__bookPlayCalls = [];
            window.__bookPauseCalls = [];
            HTMLMediaElement.prototype.play = function () {
                window.__bookMediaPaused = false;
                window.__bookPlayCalls.push(this.dataset.segmentId || 'none');
                this.dispatchEvent(new Event('play'));
                return Promise.resolve();
            };
            HTMLMediaElement.prototype.pause = function () {
                window.__bookMediaPaused = true;
                window.__bookPauseCalls.push(this.dataset.segmentId || 'none');
                this.dispatchEvent(new Event('pause'));
            };
        });

        const layout = await page.evaluate(() => ({
            progressRow: Array.from(document.querySelectorAll('.book-progress-card span')).map(el => el.textContent.trim()).join(' | '),
            generationColumns: getComputedStyle(document.querySelector('.generator-actions')).gridTemplateColumns.split(' ').length,
            generationButtons: Array.from(document.querySelectorAll('.generator-actions button')).map(button => button.textContent.trim()),
            selectedChapterButton: document.querySelector('#generateSelectedChapterBtn')?.textContent || '',
            chapterOptions: Array.from(document.querySelectorAll('#generationChapterSelect option')).map(option => option.textContent.trim()),
            voiceOptions: Array.from(document.querySelectorAll('#generatorTtsVoice option')).map(option => option.value),
            modelOptions: Array.from(document.querySelectorAll('#generatorTtsModel option')).map(option => option.value),
            modelLabels: Array.from(document.querySelectorAll('#generatorTtsModel option')).map(option => option.textContent.trim()),
            pricingLine: document.querySelector('#generatorModelPricingDescription')?.textContent || '',
            accentOptions: Array.from(document.querySelectorAll('#generatorTtsAccent option')).map(option => option.value),
            styleOptions: Array.from(document.querySelectorAll('#generatorTtsStyle option')).map(option => option.value),
            speedSliderCount: document.querySelectorAll('.speed-slider, input[type="range"][id*="TtsSpeed"], input[type="range"][id*="ttsSpeed"]').length,
            speedButtonCount: document.querySelectorAll('[data-tts-speed-step]').length,
            generatorSpeedValue: document.querySelector('#generatorTtsSpeedValue')?.textContent || '',
            hasInstructions: Boolean(document.querySelector('#generatorTtsInstructions')),
            voiceConfigDisplay: getComputedStyle(document.querySelector('#voiceConfigPanel')).display,
            voiceSummary: document.querySelector('#currentVoiceSummary')?.textContent || '',
            conversionCost: document.querySelector('#conversionCostText')?.textContent || '',
            chapterStatusCount: document.querySelectorAll('.chapter-status-item').length,
            chunkDotCount: document.querySelectorAll('.chunk-dot').length,
            chapterAudioDetailsClosed: Array.from(document.querySelectorAll('.chapter-audio-details')).every(details => !details.open),
            advancedAudioClosed: !document.querySelector('.audio-parts-advanced')?.open,
            playerNow: document.querySelector('#playerNow')?.textContent || '',
            aiQuestionButton: document.querySelector('#aiQuestionBtn')?.textContent?.trim() || '',
            aiResearchTitle: document.querySelector('#aiResearchTitle')?.textContent?.trim() || '',
            aiResearchRoute: document.querySelector('#aiResearchRoute')?.textContent?.trim() || '',
            aiQuestionSpeakDefault: document.querySelector('#speakAiAnswersToggle')?.checked,
            aiQuestionPanelDisplay: getComputedStyle(document.querySelector('#aiQuestionPanel')).display,
            answerNavLabels: Array.from(document.querySelectorAll('#aiAnswerNavigation button')).map(button => button.textContent.trim()),
            sampleButtons: Array.from(document.querySelectorAll('#voiceSampleGrid button')).map(button => button.textContent.trim()),
            sampleStatus: document.querySelector('#voiceSampleStatus')?.textContent || '',
            controlCount: document.querySelectorAll('.player-control-grid button').length,
            controlLabels: Array.from(document.querySelectorAll('.player-control-grid button')).map(button => button.textContent.trim()),
            readerSearchPlaceholder: document.querySelector('#readerSearch')?.getAttribute('placeholder') || '',
            readerJumpButtons: [
                document.querySelector('#goToLatestReadBtn')?.textContent?.trim(),
                document.querySelector('#goToPlayingSectionBtn')?.textContent?.trim()
            ],
            sectionOrder: {
                listen: document.querySelector('.player-card')?.getBoundingClientRect().top || 0,
                ai: document.querySelector('.ai-research-card')?.getBoundingClientRect().top || 0,
                convert: document.querySelector('.generator-card')?.getBoundingClientRect().top || 0,
                reader: document.querySelector('.reader-panel')?.getBoundingClientRect().top || 0,
                log: document.querySelector('#logContainer')?.getBoundingClientRect().top || 0
            },
            nativeAudioDisplay: getComputedStyle(document.querySelector('#audioPlayer')).display,
            readerBoxed: getComputedStyle(document.querySelector('.reader-segment')).borderLeftStyle !== 'none'
        }));
        report.check('books chapter-first generation and TTS option layout',
            layout.progressRow.includes('Read') && layout.generationColumns >= 5
            && ['-Chapter', 'Current chapter', '+Chapter', 'Whole book', '+15 min', '+1 hour']
                .every(label => layout.generationButtons.includes(label))
            && !layout.generationButtons.includes('+Chunk')
            && layout.selectedChapterButton.includes('Selected chapter')
            && layout.chapterOptions.some(label => label.includes('Section') && label.includes('generated'))
            && ['ash', 'ballad', 'cedar', 'coral', 'marin', 'sage', 'verse']
                .every(voice => layout.voiceOptions.includes(voice))
            && layout.modelOptions.includes('gpt-4o-mini-tts') && layout.hasInstructions
            && layout.modelLabels.some(label => label.includes('$0.60') && label.includes('$12'))
            && layout.pricingLine.includes('~$0.015/min')
            && ['default', 'american', 'british', 'australian', 'irish', 'scottish', 'indian', 'new-york', 'southern-us']
                .every(accent => layout.accentOptions.includes(accent))
            && ['audiobook', 'neutral', 'dramatic', 'warm', 'documentary', 'bedtime', 'whisper']
                .every(style => layout.styleOptions.includes(style))
            && layout.speedSliderCount === 0 && layout.speedButtonCount === 2 && layout.generatorSpeedValue === '1x'
            && layout.voiceConfigDisplay === 'none' && layout.voiceSummary.includes('Alloy')
            && layout.conversionCost.includes('$') && layout.chapterStatusCount === 1 && layout.chunkDotCount === 2
            && layout.chapterAudioDetailsClosed && layout.advancedAudioClosed
            && ['Alloy', 'Ash', 'Ballad', 'Cedar', 'Coral', 'Echo', 'Fable', 'Marin', 'Nova', 'Onyx', 'Sage', 'Shimmer', 'Verse']
                .every(voice => layout.sampleButtons.includes(voice))
            && layout.sampleStatus.includes('short sample')
            && layout.controlCount === 7
            && ['Prev', '-30s', 'Half back', 'Play', 'Half fwd', '+30s', 'Next']
                .every((label, index) => layout.controlLabels[index] === label)
            && layout.readerSearchPlaceholder.includes("book's contents")
            && layout.readerJumpButtons[0] === 'Go to latest read'
            && layout.readerJumpButtons[1] === 'Go to playing section'
            && layout.sectionOrder.listen < layout.sectionOrder.ai
            && layout.sectionOrder.ai < layout.sectionOrder.convert
            && layout.sectionOrder.convert < layout.sectionOrder.reader
            && layout.sectionOrder.reader < layout.sectionOrder.log
            && layout.playerNow.includes('Voice:') && layout.nativeAudioDisplay === 'none'
            && layout.readerBoxed === false
            && layout.aiQuestionButton === 'AI question'
            && layout.aiResearchTitle.includes('Ask about what you are hearing')
            && layout.aiResearchRoute.includes('OpenAI Responses API')
            && layout.aiResearchRoute.includes('GPT-5.6 Sol')
            && layout.aiResearchRoute.includes('reasoning high')
            && layout.aiQuestionSpeakDefault === false
            && ['Page −', 'Para −', 'Sent −', 'Play', 'Sent +', 'Para +', 'Page +']
                .every((label, index) => layout.answerNavLabels[index] === label)
            && layout.aiQuestionPanelDisplay === 'none');

        await page.evaluate(() => {
            window.__bookSpeechPayloads = [];
            window.__bookQuestionPayloads = [];
            window.__bookSpokenAnswers = [];
            window.__bookQuestionRelease = null;
            window.__bookAnswerSpeechRelease = null;
            VoiceOutput.speak = (text, options = {}) => new Promise(resolve => {
                window.__bookSpokenAnswers.push(text);
                options.onBoundary?.({ charIndex: text.indexOf('Independent') });
                window.__bookAnswerSpeechRelease = resolve;
            });
            VoiceOutput.stop = () => {
                window.__bookAnswerSpeechRelease?.();
                window.__bookAnswerSpeechRelease = null;
            };
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === 'string' ? input : input.url;
                if (url === 'https://api.openai.com/v1/audio/speech') {
                    window.__bookSpeechPayloads.push(JSON.parse(String(init?.body || '{}')));
                    return new Response(new Blob(['fake-sample'], { type: 'audio/mpeg' }), { status: 200 });
                }
                if (url === 'https://api.openai.com/v1/responses') {
                    window.__bookQuestionPayloads.push(JSON.parse(String(init?.body || '{}')));
                    await new Promise(resolve => { window.__bookQuestionRelease = resolve; });
                    const answer = 'The passage tests the Books research flow.\n\nIndependent research confirms the second point [1].';
                    const citationStart = answer.indexOf('[1]');
                    return new Response(JSON.stringify({
                        output_text: answer,
                        output: [{
                            type: 'web_search_call',
                            action: {
                                sources: [{ type: 'url', url: 'https://example.com/source' }]
                            },
                            results: [{
                                type: 'image_result',
                                image_url: 'https://127.0.0.1/private.jpg',
                                thumbnail_url: 'https://127.0.0.1/private-thumb.jpg',
                                source_website_url: 'https://127.0.0.1/private',
                                caption: 'Private network image'
                            }, {
                                type: 'image_result',
                                image_url: 'https://example.com/research-image.jpg',
                                thumbnail_url: 'https://example.com/research-thumb.jpg',
                                source_website_url: 'https://example.com/source',
                                caption: 'Research image'
                            }]
                        }, {
                            type: 'message',
                            content: [{
                                type: 'output_text',
                                text: answer,
                                annotations: [{
                                    type: 'url_citation',
                                    start_index: citationStart,
                                    end_index: citationStart + 3,
                                    url: 'https://example.com/source',
                                    title: 'Source One'
                                }]
                            }]
                        }]
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return originalFetch(input, init);
            };
        });
        await page.click('#toggleVoiceConfigBtn');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('#voiceConfigPanel')).display !== 'none');
        await page.selectOption('#generatorTtsAccent', 'british');
        await page.selectOption('#generatorTtsStyle', 'dramatic');
        await page.click('#generatorTtsSpeedValue + [data-tts-speed-step="0.1"]');
        await page.click('[data-voice-sample="verse"]');
        await page.waitForFunction(() => window.__bookSpeechPayloads?.length === 1);
        const samplePayload = await page.evaluate(() => window.__bookSpeechPayloads[0]);
        report.check('books voice sample uses selected speech settings with clicked voice',
            samplePayload.model === 'gpt-4o-mini-tts'
            && samplePayload.voice === 'verse'
            && samplePayload.speed === 1.1
            && samplePayload.response_format === 'mp3'
            && samplePayload.input.includes('Torrenthia')
            && samplePayload.instructions.includes('British English accent')
            && samplePayload.instructions.includes('dramatic suspense'));

        await page.click('#playFromProgressBtn');
        await page.waitForFunction(() => document.querySelector('#audioPlayer')?.dataset.segmentId === 'seg-0');
        await page.click('#aiQuestionBtn');
        await page.waitForFunction(() => (window.__bookQuestionPayloads || []).length === 1);
        await page.waitForTimeout(1100);
        const inFlight = await page.evaluate(() => ({
            elapsed: document.querySelector('#aiQuestionElapsed')?.textContent || '',
            status: document.querySelector('#aiQuestionStatus')?.textContent || '',
            requestPreview: document.querySelector('#aiQuestionRequestPreview')?.textContent || '',
            context: document.querySelector('#aiQuestionContextText')?.textContent || ''
        }));
        await page.check('#speakAiAnswersToggle');
        await page.evaluate(() => window.__bookQuestionRelease?.());
        await page.waitForFunction(() => document.querySelector('#aiQuestionAnswerText')?.textContent?.includes('Books research flow'));
        await page.waitForFunction(() => window.__bookSpokenAnswers?.length === 1);
        const aiQuestion = await page.evaluate(async () => {
            const payload = window.__bookQuestionPayloads[0] || {};
            const questionIndex = String(payload.input || '').indexOf('Reader question: What does this passage mean?');
            const chunkIndex = String(payload.input || '').indexOf('Full text of the current audio context:\nSegment 0');
            const saved = JSON.parse(localStorage.getItem('voice-wei:ebook-settings') || '{}');
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('voice-wei-books', 5);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const researchRecords = await new Promise((resolve, reject) => {
                const tx = db.transaction('research', 'readonly');
                const req = tx.objectStore('research').index('bookId').getAll('book-suite-generated');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            const research = researchRecords[0] || {};
            return {
                panelVisible: getComputedStyle(document.querySelector('#aiQuestionPanel')).display !== 'none',
                context: document.querySelector('#aiQuestionContextText')?.textContent || '',
                question: document.querySelector('#aiQuestionInput')?.value || '',
                answer: document.querySelector('#aiQuestionAnswerText')?.textContent || '',
                model: payload.model,
                reasoning: payload.reasoning?.effort,
                toolChoice: payload.tool_choice,
                searchContext: payload.tools?.[0]?.search_context_size,
                contentTypes: payload.tools?.[0]?.search_content_types || [],
                imageCount: payload.tools?.[0]?.image_settings?.max_results,
                maxOutputTokens: payload.max_output_tokens,
                instructions: payload.instructions || '',
                questionBeforeChunk: questionIndex >= 0 && chunkIndex > questionIndex,
                spokenAnswers: window.__bookSpokenAnswers,
                pauseCalls: window.__bookPauseCalls,
                persistedSpeak: saved.data?.speakAiAnswers,
                sourceHref: document.querySelector('#aiQuestionSources a')?.getAttribute('href') || '',
                citationHref: document.querySelector('#aiQuestionAnswerText a')?.getAttribute('href') || '',
                imageHref: document.querySelector('#aiQuestionImages .ai-question-image')?.getAttribute('href') || '',
                imageSrc: document.querySelector('#aiQuestionImages img')?.getAttribute('src') || '',
                renderedImageCount: document.querySelectorAll('#aiQuestionImages .ai-question-image').length,
                highlightedAnswer: document.querySelector('.ai-answer-sentence.current')?.textContent || '',
                playButton: document.querySelector('#repeatAiAnswerBtn')?.textContent || '',
                finalStatus: document.querySelector('#aiQuestionStatus')?.textContent || '',
                researchCount: document.querySelector('#aiResearchHistoryCount')?.textContent || '',
                savedQuestion: research.question,
                savedAnswer: research.answer,
                savedBookText: research.bookText,
                savedSourceUrl: research.sources?.[0]?.url,
                savedImageUrl: research.images?.[0]?.imageUrl,
                savedModelLabel: research.modelLabel
            };
        });
        report.check('books AI Research discloses prompt, times request, searches web/images, and honors live speech toggle',
            aiQuestion.panelVisible
            && aiQuestion.context === 'Segment 0'
            && aiQuestion.question === 'What does this passage mean?'
            && aiQuestion.answer.includes('Books research flow')
            && aiQuestion.model === 'gpt-5.6'
            && aiQuestion.reasoning === 'high'
            && aiQuestion.toolChoice === 'required'
            && aiQuestion.searchContext === 'high'
            && aiQuestion.contentTypes.includes('text')
            && aiQuestion.contentTypes.includes('image')
            && aiQuestion.imageCount === 6
            && aiQuestion.maxOutputTokens === 12000
            && aiQuestion.instructions.includes('deeply research every question')
            && aiQuestion.instructions.includes('Do not treat it as canonically true')
            && aiQuestion.instructions.includes('You work for the listener')
            && aiQuestion.questionBeforeChunk
            && aiQuestion.spokenAnswers.includes(aiQuestion.answer)
            && aiQuestion.pauseCalls.includes('seg-0')
            && aiQuestion.persistedSpeak === true
            && aiQuestion.sourceHref === 'https://example.com/source'
            && aiQuestion.citationHref === 'https://example.com/source'
            && aiQuestion.imageHref === 'https://example.com/source'
            && aiQuestion.imageSrc === 'https://example.com/research-thumb.jpg'
            && aiQuestion.renderedImageCount === 1
            && aiQuestion.highlightedAnswer.includes('Independent research')
            && aiQuestion.playButton === 'Stop'
            && aiQuestion.finalStatus.includes('OpenAI Responses API')
            && aiQuestion.finalStatus.includes('GPT-5.6 Sol')
            && aiQuestion.finalStatus.includes('saved')
            && aiQuestion.researchCount === '1'
            && aiQuestion.savedQuestion === aiQuestion.question
            && aiQuestion.savedAnswer === aiQuestion.answer
            && aiQuestion.savedBookText === 'Segment 0'
            && aiQuestion.savedSourceUrl === 'https://example.com/source'
            && aiQuestion.savedImageUrl === 'https://example.com/research-image.jpg'
            && aiQuestion.savedModelLabel.includes('GPT-5.6 Sol')
            && inFlight.elapsed === '1s'
            && inFlight.status.includes('Sending to OpenAI Responses API')
            && inFlight.status.includes('GPT-5.6 Sol')
            && inFlight.requestPreview.includes('POST https://api.openai.com/v1/responses')
            && inFlight.requestPreview.includes('deeply research every question')
            && inFlight.requestPreview.includes('[Full current book context shown separately below')
            && !inFlight.requestPreview.includes('Segment 0')
            && inFlight.context === 'Segment 0');
        await page.click('#repeatAiAnswerBtn');
        await page.waitForFunction(() => document.querySelector('#repeatAiAnswerBtn')?.textContent === 'Play');
        await page.click('[data-ai-answer-nav="sentence-back"]');
        const firstSentence = await page.evaluate(() => document.querySelector('.ai-answer-sentence.current')?.textContent || '');
        await page.click('[data-ai-answer-nav="paragraph-forward"]');
        const nextParagraph = await page.evaluate(() => document.querySelector('.ai-answer-sentence.current')?.textContent || '');
        await page.click('[data-ai-answer-nav="paragraph-back"]');
        await page.click('[data-ai-answer-nav="sentence-forward"]');
        const nextSentence = await page.evaluate(() => document.querySelector('.ai-answer-sentence.current')?.textContent || '');
        await page.click('#repeatAiAnswerBtn');
        await page.waitForFunction(() => window.__bookSpokenAnswers?.length === 2);
        const resumedSpeech = await page.evaluate(() => window.__bookSpokenAnswers[1]);
        await page.click('#repeatAiAnswerBtn');
        report.check('books answer buttons navigate sentences/paragraphs and resume local speech there',
            firstSentence.includes('passage tests')
            && nextParagraph.includes('Independent research')
            && nextSentence.includes('Independent research')
            && resumedSpeech.trimStart().startsWith('Independent research'));
        await page.click('.ai-research-history > summary');
        await page.click('.ai-research-history-item');
        await page.waitForFunction(() => document.querySelector('#aiQuestionStatus')?.textContent?.includes('Saved research'));
        const restoredResearch = await page.evaluate(() => ({
            question: document.querySelector('#aiQuestionInput')?.value || '',
            answer: document.querySelector('#aiQuestionAnswerText')?.textContent || '',
            context: document.querySelector('#aiQuestionContextText')?.textContent || ''
        }));
        report.check('books restore complete saved AI research from IndexedDB',
            restoredResearch.question === 'What does this passage mean?'
            && restoredResearch.answer.includes('Books research flow')
            && restoredResearch.context === 'Segment 0');
        await page.evaluate(() => {
            const audio = document.querySelector('#audioPlayer');
            audio.currentTime = 60;
            audio.dispatchEvent(new Event('timeupdate'));
        });
        const readAlong = await page.evaluate(() => getComputedStyle(document.querySelector('.reader-segment.current')).getPropertyValue('--read-progress').trim());
        await page.click('#quadraticForwardBtn');
        const qForward = await page.evaluate(() => document.querySelector('#audioPlayer').currentTime);
        await page.evaluate(() => { document.querySelector('#audioPlayer').currentTime = 60; });
        await page.click('#quadraticBackBtn');
        const qBack = await page.evaluate(() => document.querySelector('#audioPlayer').currentTime);
        await page.click('#forward30Btn');
        const plus30 = await page.evaluate(() => document.querySelector('#audioPlayer').currentTime);
        await page.click('#nextSegmentBtn');
        await page.waitForFunction(() => document.querySelector('#audioPlayer')?.dataset.segmentId === 'seg-1');
        await page.click('#showHistoryBtn');
        await page.waitForSelector('#historyPanel[style*="block"]');
        const player = await page.evaluate(async () => {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('voice-wei-books', 5);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const entries = await new Promise((resolve, reject) => {
                const tx = db.transaction('history', 'readonly');
                const req = tx.objectStore('history').index('bookId').getAll('book-suite-generated');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            return {
                segmentId: document.querySelector('#audioPlayer')?.dataset.segmentId,
                playCalls: window.__bookPlayCalls,
                actions: entries.map(entry => entry.action),
                historyVisible: document.querySelector('#historyPanel')?.style.display === 'block'
            };
        });
        report.check(`books custom player jumps/history (qf=${qForward}, qb=${qBack}, +30=${plus30})`,
            Math.abs(qForward - 300) <= 0.5 && Math.abs(qBack - 30) <= 0.5
            && Math.abs(plus30 - 60) <= 0.5 && player.segmentId === 'seg-1'
            && readAlong !== '' && readAlong !== '0%'
            && player.playCalls.includes('seg-1') && player.historyVisible
            && ['ai-question', 'quadratic-forward', 'quadratic-back', 'forward-30', 'next-segment']
                .every(action => player.actions.includes(action)));

        await page.evaluate(() => {
            Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 417; } });
            document.querySelector('#audioPlayer').dispatchEvent(new Event('loadedmetadata'));
        });
        await page.waitForFunction(async () => {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('voice-wei-books', 5);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const segment = await new Promise((resolve, reject) => {
                const tx = db.transaction('segments', 'readonly');
                const req = tx.objectStore('segments').get('book-suite-generated:seg-1');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            return segment?.durationSec === 417;
        });
        const actualDuration = await page.evaluate(async () => {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('voice-wei-books', 5);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const book = await new Promise((resolve, reject) => {
                const tx = db.transaction('books', 'readonly');
                const req = tx.objectStore('books').get('book-suite-generated');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            return book.generatedDurationSec;
        });
        report.check('books persist decoded MP3 duration for generated accounting', actualDuration === 777);

        const automaticScrollCalls = await page.evaluate(() => window.__bookScrollCalls.slice());
        await page.click('#goToPlayingSectionBtn');
        await page.click('#goToLatestReadBtn');
        const explicitScrollCalls = await page.evaluate(() => window.__bookScrollCalls.slice());
        report.check('books never auto-scroll the window and expose explicit reader jumps',
            automaticScrollCalls.length === 0
            && explicitScrollCalls.length === 2
            && explicitScrollCalls.every(target => target === 'reader-sec-0'));

        await page.click('#backToLibraryBtn');
        await page.waitForFunction(() => !document.querySelector('.books-shell')?.classList.contains('book-open'));
        await page.click('.saved-book-item[data-book-id="book-suite-generated-two"]');
        await page.waitForSelector('#bookWorkspace[style*="block"]');
        const clearedBeforeSecondPlay = await page.evaluate(() => {
            const audio = document.querySelector('#audioPlayer');
            return !audio?.getAttribute('src') && !audio?.dataset.segmentId;
        });
        await page.click('#playFromProgressBtn');
        await page.waitForFunction(() => document.querySelector('#audioPlayer')?.dataset.segmentId === 'seg-b0');
        const switchedBook = await page.evaluate(() => ({
            segmentId: document.querySelector('#audioPlayer')?.dataset.segmentId,
            playCalls: window.__bookPlayCalls
        }));
        report.check('books clear stale MP3 when switching books',
            clearedBeforeSecondPlay && switchedBook.segmentId === 'seg-b0'
            && switchedBook.playCalls.includes('seg-b0'));

        await page.click('.chapter-audio-details > summary');
        await page.click('.chunk-dot[data-segment-id="seg-b0"]');
        await page.waitForFunction(() => (window.__bookPlayCalls || []).filter(id => id === 'seg-b0').length >= 2);
        const chunkClickPlay = await page.evaluate(() => ({
            segmentId: document.querySelector('#audioPlayer')?.dataset.segmentId,
            playCalls: window.__bookPlayCalls
        }));
        report.check('books chapter-list chunk click plays immediately',
            chunkClickPlay.segmentId === 'seg-b0'
            && chunkClickPlay.playCalls.filter(id => id === 'seg-b0').length >= 2);
        await page.reload({ waitUntil: 'load' });
        await page.click('.saved-book-item[data-book-id="book-suite-generated"]');
        await page.waitForSelector('#bookWorkspace[style*="block"]');
        await page.click('.ai-research-history > summary');
        await page.click('.ai-research-history-item');
        const researchAfterReload = await page.evaluate(() => ({
            count: document.querySelector('#aiResearchHistoryCount')?.textContent || '',
            question: document.querySelector('#aiQuestionInput')?.value || '',
            answer: document.querySelector('#aiQuestionAnswerText')?.textContent || ''
        }));
        report.check('books saved AI research survives reload with complete output',
            researchAfterReload.count === '1'
            && researchAfterReload.question === 'What does this passage mean?'
            && researchAfterReload.answer.includes('Books research flow'));
        await page.close();
    }

    {
        const page = await browser.newPage();
        collectErrors(page, 'books-duration-enqueue', report.errors);
        await page.addInitScript(() => localStorage.setItem('voice-wei:api-key:openai', 'sk-test-books-suite'));
        await page.goto(`${BASE_URL}/ebook.html`, { waitUntil: 'load' });
        await clearBooksDb(page);
        await page.reload({ waitUntil: 'load' });
        await seedGapBook(page);
        await page.reload({ waitUntil: 'load' });
        await page.click('.saved-book-item[data-book-id="book-suite-gap"]');
        await page.waitForSelector('#bookWorkspace[style*="block"]');
        await page.evaluate(() => {
            window.__bookSpeechPayloads = [];
            window.__speechReleases = [];
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === 'string' ? input : input.url;
                if (url === 'https://api.openai.com/v1/audio/speech') {
                    window.__bookSpeechPayloads.push(JSON.parse(String(init?.body || '{}')));
                    await new Promise(resolve => window.__speechReleases.push(resolve));
                    return new Response(new Blob(['fake-duration'], { type: 'audio/mpeg' }), { status: 200 });
                }
                return originalFetch(input, init);
            };
        });
        await page.click('#generateNext15Btn');
        await page.waitForFunction(() => (window.__bookSpeechPayloads || []).length === 1);
        await page.click('#generateNext15Btn');
        const queuedStatus = await page.evaluate(() => document.querySelector('#status')?.textContent || '');
        await page.evaluate(async () => {
            const deadline = Date.now() + 10000;
            while (document.querySelectorAll('.chunk-dot.done').length < 6) {
                if (Date.now() > deadline) throw new Error('timed out draining speech queue');
                for (const release of window.__speechReleases.splice(0)) release();
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        });
        const enqueue = await page.evaluate(() => ({
            inputs: (window.__bookSpeechPayloads || []).map(payload => payload.input),
            doneDots: document.querySelectorAll('.chunk-dot.done').length
        }));
        report.check('books second +15 min enqueues the next fifteen after current queue',
            queuedStatus.includes('Queued')
            && enqueue.inputs.slice(0, 3).join('|') === 'DURATION_CHUNK_0|DURATION_CHUNK_1|DURATION_CHUNK_2'
            && enqueue.inputs.slice(3, 6).join('|') === 'DURATION_CHUNK_3|DURATION_CHUNK_4|DURATION_CHUNK_5'
            && enqueue.doneDots === 6);
        await page.close();
    }

    {
        const page = await browser.newPage();
        collectErrors(page, 'books-front-matter', report.errors);
        await page.goto(`${BASE_URL}/ebook.html`, { waitUntil: 'load' });
        await clearBooksDb(page);
        await page.reload({ waitUntil: 'load' });
        await seedFrontMatterBook(page);
        await page.reload({ waitUntil: 'load' });
        await page.click('.saved-book-item[data-book-id="book-suite-front-matter"]');
        await page.waitForSelector('#bookWorkspace[style*="block"]');
        await page.evaluate(() => {
            window.__readerJumpCalls = [];
            Element.prototype.scrollIntoView = function () {
                window.__readerJumpCalls.push(this.id || 'unknown');
            };
        });
        await page.selectOption('#generationChapterSelect', 'sec-3');
        await page.click('#goToPlayingSectionBtn');
        await page.click('#goToLatestReadBtn');
        const separateReaderJumps = await page.evaluate(() => window.__readerJumpCalls.slice());
        const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#generationChapterSelect option')).map(option => option.textContent.trim()));
        report.check('books infer front matter before numeric chapter run',
            labels[0].startsWith('Front matter 1')
            && labels[1].startsWith('Front matter 2: Contents')
            && labels[2].startsWith('Chapter 1')
            && labels[3].startsWith('Chapter 2')
            && labels[4].startsWith('Chapter 3')
            && labels[5].startsWith("Author's Note"));
        report.check('books keep latest-read and currently-selected audio section as separate reader jumps',
            separateReaderJumps[0] === 'reader-sec-3'
            && separateReaderJumps[1] === 'reader-sec-0');
        await page.close();
    }

    await browser.close();
    report.finish();
})();
