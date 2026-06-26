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

async function seedFrontMatterBook(page) {
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
        await page.goto(`${BASE_URL}/ebook.html`, { waitUntil: 'networkidle' });
        await clearBooksDb(page);
        await page.reload({ waitUntil: 'networkidle' });

        for (const [index, name] of ['one', 'two'].entries()) {
            await page.setInputFiles('#fileInput', {
                name: `${name}.txt`,
                mimeType: 'text/plain',
                buffer: Buffer.from(`${name} text `.repeat(120))
            });
            await page.waitForFunction(expectedCount => {
                return document.querySelectorAll('.saved-book-item').length === expectedCount
                    && !document.querySelector('.books-shell')?.classList.contains('book-open');
            }, index + 1);
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
                metaText: first.querySelector('.saved-book-meta')?.textContent || '',
                durationColumns: first.querySelectorAll('.duration-value .duration-number').length,
                inlineButtons: first.querySelectorAll('button, [data-action]').length,
                archiveToggleText: document.querySelector('#toggleArchiveViewBtn')?.textContent || '',
                libraryDisplay: getComputedStyle(document.querySelector('.books-library-panel')).display,
                workspaceVisible: getComputedStyle(document.querySelector('#bookWorkspace')).display !== 'none',
                summaryText: document.querySelector('#libraryProgressSummary')?.textContent || '',
                librarySearchPlaceholder: document.querySelector('#librarySearch')?.getAttribute('placeholder') || ''
            };
        });
        report.check(`books import stays on shelf with overall progress (rows=${shelf.rowCount}, height=${shelf.rowHeight})`,
            shelf.rowCount === 2 && shelf.rowHeight <= 42
            && shelf.titleNowrap === 'nowrap' && shelf.metaNowrap === 'nowrap'
            && !shelf.metaText.includes('TXT') && shelf.metaText.includes('Read') && shelf.metaText.includes('MP3')
            && shelf.durationColumns === 2 && shelf.archiveToggleText === 'Show archive'
            && shelf.inlineButtons === 0 && shelf.libraryDisplay !== 'none' && !shelf.workspaceVisible
            && shelf.librarySearchPlaceholder.includes('titles, authors, and filenames')
            && shelf.summaryText.includes('Overall progress') && shelf.summaryText.includes('2 books'));

        await page.click('.saved-book-item[data-book-id]');
        await page.waitForFunction(() => document.querySelector('.books-shell')?.classList.contains('book-open'));
        const opened = await page.evaluate(() => ({
            libraryHidden: getComputedStyle(document.querySelector('.books-library-panel')).display === 'none',
            workspaceVisible: getComputedStyle(document.querySelector('#bookWorkspace')).display !== 'none',
            backText: document.querySelector('#backToLibraryBtn')?.textContent || '',
            hasSpinePanel: Boolean(document.querySelector('.spine-panel, #spineList')),
            chunkFallbackVisible: getComputedStyle(document.querySelector('#generateCurrentChunkBtn')).display !== 'none',
            chapterOptionText: document.querySelector('#generationChapterSelect option')?.textContent || ''
        }));
        report.check('books open into book-only mode with no interior spine panel',
            opened.libraryHidden && opened.workspaceVisible && opened.backText.includes('Bookshelf') && !opened.hasSpinePanel
            && !opened.chunkFallbackVisible && opened.chapterOptionText.includes('chapter') && !opened.chapterOptionText.includes('chunk'));
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
            speedSliderCount: document.querySelectorAll('.speed-slider, input[type="range"][id*="TtsSpeed"], input[type="range"][id*="ttsSpeed"]').length,
            speedButtonCount: document.querySelectorAll('[data-tts-speed-step]').length,
            generatorSpeedValue: document.querySelector('#generatorTtsSpeedValue')?.textContent || '',
            hasInstructions: Boolean(document.querySelector('#generatorTtsInstructions')),
            voiceConfigDisplay: getComputedStyle(document.querySelector('#voiceConfigPanel')).display,
            voiceSummary: document.querySelector('#currentVoiceSummary')?.textContent || '',
            conversionCost: document.querySelector('#conversionCostText')?.textContent || '',
            chapterStatusCount: document.querySelectorAll('.chapter-status-item').length,
            chunkDotCount: document.querySelectorAll('.chunk-dot').length,
            playerNow: document.querySelector('#playerNow')?.textContent || '',
            sampleButtons: Array.from(document.querySelectorAll('#voiceSampleGrid button')).map(button => button.textContent.trim()),
            sampleStatus: document.querySelector('#voiceSampleStatus')?.textContent || '',
            controlCount: document.querySelectorAll('.player-control-grid button').length,
            controlLabels: Array.from(document.querySelectorAll('.player-control-grid button')).map(button => button.textContent.trim()),
            readerSearchPlaceholder: document.querySelector('#readerSearch')?.getAttribute('placeholder') || '',
            nativeAudioDisplay: getComputedStyle(document.querySelector('#audioPlayer')).display,
            readerBoxed: getComputedStyle(document.querySelector('.reader-segment')).borderLeftStyle !== 'none'
        }));
        report.check('books chapter-first generation and TTS option layout',
            layout.progressRow.includes('Read') && layout.generationColumns >= 5
            && ['-Chapter', 'Current chapter', '+Chapter', 'Whole book', '+Chunk', '+15 min']
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
            && layout.speedSliderCount === 0 && layout.speedButtonCount === 2 && layout.generatorSpeedValue === '1x'
            && layout.voiceConfigDisplay === 'none' && layout.voiceSummary.includes('Alloy')
            && layout.conversionCost.includes('$') && layout.chapterStatusCount === 1 && layout.chunkDotCount === 2
            && ['Alloy', 'Ash', 'Ballad', 'Cedar', 'Coral', 'Echo', 'Fable', 'Marin', 'Nova', 'Onyx', 'Sage', 'Shimmer', 'Verse']
                .every(voice => layout.sampleButtons.includes(voice))
            && layout.sampleStatus.includes('short sample')
            && layout.controlCount === 7
            && ['Prev', '-30s', 'Half back', 'Play', 'Half fwd', '+30s', 'Next']
                .every((label, index) => layout.controlLabels[index] === label)
            && layout.readerSearchPlaceholder.includes("book's contents")
            && layout.playerNow.includes('Voice:') && layout.nativeAudioDisplay === 'none'
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
            && readAlong !== '' && readAlong !== '0%'
            && player.playCalls.includes('seg-1') && player.historyVisible
            && ['quadratic-forward', 'quadratic-back', 'forward-30', 'next-segment']
                .every(action => player.actions.includes(action)));
        await page.close();
    }

    {
        const page = await browser.newPage();
        collectErrors(page, 'books-front-matter', report.errors);
        await page.goto(`${BASE_URL}/ebook.html`, { waitUntil: 'networkidle' });
        await clearBooksDb(page);
        await page.reload({ waitUntil: 'networkidle' });
        await seedFrontMatterBook(page);
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('.saved-book-item[data-book-id="book-suite-front-matter"]');
        await page.waitForSelector('#bookWorkspace[style*="block"]');
        const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#generationChapterSelect option')).map(option => option.textContent.trim()));
        report.check('books infer front matter before numeric chapter run',
            labels[0].startsWith('Front matter 1')
            && labels[1].startsWith('Front matter 2: Contents')
            && labels[2].startsWith('Chapter 1')
            && labels[3].startsWith('Chapter 2')
            && labels[4].startsWith('Chapter 3')
            && labels[5].startsWith("Author's Note"));
        await page.close();
    }

    await browser.close();
    report.finish();
})();
