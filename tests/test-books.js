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
            const req = indexedDB.open('voice-wei-books', 4);
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
            status: 'done',
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

(async () => {
    const report = createReporter('books');
    const browser = await launch();

    {
        const page = await browser.newPage({ viewport: { width: 460, height: 900 } });
        collectErrors(page, 'books-library', report.errors);
        await page.goto(`${BASE_URL}/ebook.html`, { waitUntil: 'networkidle' });
        await clearBooksDb(page);
        await page.reload({ waitUntil: 'networkidle' });

        for (const name of ['one', 'two']) {
            await page.setInputFiles('#fileInput', {
                name: `${name}.txt`,
                mimeType: 'text/plain',
                buffer: Buffer.from(`${name} text `.repeat(120))
            });
            await page.waitForSelector('#backToLibraryBtn', { timeout: 10000 });
            await page.click('#backToLibraryBtn');
            await page.waitForFunction(() => !document.querySelector('.books-shell')?.classList.contains('book-open'));
        }

        const shelf = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.saved-book-item'));
            const first = rows[0];
            const rect = first.getBoundingClientRect();
            return {
                rowCount: rows.length,
                rowHeight: rect.height,
                titleNowrap: getComputedStyle(first.querySelector('.saved-book-title')).whiteSpace,
                metaNowrap: getComputedStyle(first.querySelector('.saved-book-meta')).whiteSpace,
                inlineButtons: first.querySelectorAll('button, [data-action]').length,
                libraryDisplay: getComputedStyle(document.querySelector('.books-library-panel')).display
            };
        });
        report.check(`books shelf is dense rows (rows=${shelf.rowCount}, height=${shelf.rowHeight})`,
            shelf.rowCount === 2 && shelf.rowHeight <= 42
            && shelf.titleNowrap === 'nowrap' && shelf.metaNowrap === 'nowrap'
            && shelf.inlineButtons === 0 && shelf.libraryDisplay !== 'none');

        await page.click('.saved-book-item[data-book-id]');
        await page.waitForFunction(() => document.querySelector('.books-shell')?.classList.contains('book-open'));
        const opened = await page.evaluate(() => ({
            libraryHidden: getComputedStyle(document.querySelector('.books-library-panel')).display === 'none',
            workspaceVisible: getComputedStyle(document.querySelector('#bookWorkspace')).display !== 'none',
            backText: document.querySelector('#backToLibraryBtn')?.textContent || '',
            hasSpinePanel: Boolean(document.querySelector('.spine-panel, #spineList'))
        }));
        report.check('books open into book-only mode with no interior spine panel',
            opened.libraryHidden && opened.workspaceVisible && opened.backText.includes('Bookshelf') && !opened.hasSpinePanel);
        await page.close();
    }

    {
        const page = await browser.newPage();
        collectErrors(page, 'books-player', report.errors);
        await page.addInitScript(() => localStorage.setItem('voice-wei:api-key:openai', 'sk-test-books-suite'));
        await page.goto(`${BASE_URL}/ebook.html`, { waitUntil: 'networkidle' });
        await clearBooksDb(page);
        await page.reload({ waitUntil: 'networkidle' });
        await seedGeneratedBook(page);
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('.saved-book-item[data-book-id="book-suite-generated"]');
        await page.waitForSelector('#bookWorkspace[style*="block"]');
        await page.evaluate(() => {
            Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 360; } });
            window.__bookPlayCalls = [];
            HTMLMediaElement.prototype.play = function () {
                window.__bookPlayCalls.push(this.dataset.segmentId || 'none');
                this.dispatchEvent(new Event('play'));
                return Promise.resolve();
            };
            HTMLMediaElement.prototype.pause = function () {
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
            hasInstructions: Boolean(document.querySelector('#generatorTtsInstructions')),
            sampleButtons: Array.from(document.querySelectorAll('#voiceSampleGrid button')).map(button => button.textContent.trim()),
            sampleStatus: document.querySelector('#voiceSampleStatus')?.textContent || '',
            controlCount: document.querySelectorAll('.player-control-grid button').length,
            nativeAudioDisplay: getComputedStyle(document.querySelector('#audioPlayer')).display,
            readerBoxed: getComputedStyle(document.querySelector('.reader-segment')).borderLeftStyle !== 'none'
        }));
        report.check('books chapter-first generation and TTS option layout',
            layout.progressRow.includes('Read') && layout.generationColumns === 5
            && ['Current chapter', 'Next chapter', 'Whole book', '+Chunk', '+15 min']
                .every(label => layout.generationButtons.includes(label))
            && layout.selectedChapterButton.includes('Selected chapter')
            && layout.chapterOptions.some(label => label.includes('Section') && label.includes('chunks ready'))
            && ['ash', 'ballad', 'cedar', 'coral', 'marin', 'sage', 'verse']
                .every(voice => layout.voiceOptions.includes(voice))
            && layout.modelOptions.includes('gpt-4o-mini-tts') && layout.hasInstructions
            && layout.modelLabels.some(label => label.includes('$0.60') && label.includes('$12'))
            && layout.pricingLine.includes('~$0.015/min')
            && ['default', 'american', 'british', 'australian', 'irish', 'scottish', 'indian', 'new-york', 'southern-us']
                .every(accent => layout.accentOptions.includes(accent))
            && ['audiobook', 'neutral', 'dramatic', 'warm', 'documentary', 'bedtime', 'whisper']
                .every(style => layout.styleOptions.includes(style))
            && ['Alloy', 'Ash', 'Ballad', 'Cedar', 'Coral', 'Echo', 'Fable', 'Marin', 'Nova', 'Onyx', 'Sage', 'Shimmer', 'Verse']
                .every(voice => layout.sampleButtons.includes(voice))
            && layout.sampleStatus.includes('short sample')
            && layout.controlCount === 7 && layout.nativeAudioDisplay === 'none'
            && layout.readerBoxed === false);

        await page.evaluate(() => {
            window.__bookSpeechPayloads = [];
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === 'string' ? input : input.url;
                if (url === 'https://api.openai.com/v1/audio/speech') {
                    window.__bookSpeechPayloads.push(JSON.parse(String(init?.body || '{}')));
                    return new Response(new Blob(['fake-sample'], { type: 'audio/mpeg' }), { status: 200 });
                }
                return originalFetch(input, init);
            };
        });
        await page.selectOption('#generatorTtsAccent', 'british');
        await page.selectOption('#generatorTtsStyle', 'dramatic');
        await page.click('[data-voice-sample="verse"]');
        await page.waitForFunction(() => window.__bookSpeechPayloads?.length === 1);
        const samplePayload = await page.evaluate(() => window.__bookSpeechPayloads[0]);
        report.check('books voice sample uses selected speech settings with clicked voice',
            samplePayload.model === 'gpt-4o-mini-tts'
            && samplePayload.voice === 'verse'
            && samplePayload.response_format === 'mp3'
            && samplePayload.input.includes('Torrenthia')
            && samplePayload.instructions.includes('British English accent')
            && samplePayload.instructions.includes('dramatic suspense'));

        await page.click('#playFromProgressBtn');
        await page.waitForFunction(() => document.querySelector('#audioPlayer')?.dataset.segmentId === 'seg-0');
        await page.evaluate(() => {
            const audio = document.querySelector('#audioPlayer');
            audio.currentTime = 60;
            audio.dispatchEvent(new Event('timeupdate'));
        });
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
                const req = indexedDB.open('voice-wei-books', 4);
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
            && player.playCalls.includes('seg-1') && player.historyVisible
            && ['quadratic-forward', 'quadratic-back', 'forward-30', 'next-segment']
                .every(action => player.actions.includes(action)));
        await page.close();
    }

    await browser.close();
    report.finish();
})();
