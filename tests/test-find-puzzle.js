// @ts-check
// Find puzzle: the score is positional overlap with the category lexicon.
// The page shows that score and never names a category word. Left cells
// edit the same letters as the right column.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

const SOLUTION = ['c', 's', 'c', 'a', 'r', 'o', 't', 'y'];

function loadPuzzle() {
    const code = fs.readFileSync(path.join(__dirname, '..', 'find-puzzle.js'), 'utf8');
    const context = { window: /** @type {any} */ ({}) };
    vm.createContext(context);
    vm.runInContext(code, context);
    return context.window.FindPuzzle;
}

/**
 * @param {import('playwright').Page} tab
 * @param {readonly string[]} letters
 */
async function fillLetters(tab, letters) {
    for (let index = 0; index < letters.length; index++) {
        await tab.locator(`[data-slot="${index}"]`).fill(letters[index]);
    }
}

(async () => {
    const report = createReporter('find puzzle');
    const FindPuzzle = loadPuzzle();
    const empty = FindPuzzle.scoreBoard(Array.from({ length: 8 }, () => ''));
    report.check('empty board scores 0', empty.total === 0 && empty.rows.every(row => row.score === 0 && row.words.length === 0));

    const solved = FindPuzzle.scoreBoard(SOLUTION);
    report.check('solution scores 18', solved.total === 18 && solved.rows.every(row => row.score === 3));
    report.check('solution words are cat say car soy cot cry',
        solved.rows.map(row => row.words.join(',')).join(' ') === 'cat say car soy cot cry');

    const shifted = SOLUTION.slice();
    shifted[5] = 'e';
    const partial = FindPuzzle.scoreBoard(shifted);
    report.check('changing o to e scores 16 and misses furniture',
        partial.total === 16
        && partial.rows[4].score === 2
        && partial.rows[4].words.join(',') === 'cot'
        && partial.rows[4].projected.join('') === 'cet');
    report.check('furniture e is a miss against cot',
        FindPuzzle.letterMarks(partial.rows[4].projected, partial.rows[4].words).join(',') === 'match,miss,match');

    const bat = FindPuzzle.scoreProjection('animal', ['b', 'a', 't']);
    const cab = FindPuzzle.scoreProjection('transportation', ['c', 'a', 'b']);
    const bet = FindPuzzle.scoreProjection('furniture', ['b', 'e', 't']);
    report.check('published examples: bat 3, cab 3, bet 2 as bed',
        bat.score === 3 && bat.words.includes('bat')
        && cab.score === 3 && cab.words.includes('cab')
        && bet.score === 2 && bet.words.join(',') === 'bed');

    const browser = await launch();
    const tab = await browser.newPage();
    /** @type {string[]} */
    const pageErrors = [];
    collectErrors(tab, 'games.html', pageErrors);
    await tab.goto(`${BASE_URL}/games.html`, { waitUntil: 'networkidle', timeout: 30000 });
    await tab.waitForFunction(() => document.querySelectorAll('#findLines line').length === 18);
    const layout = await tab.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.find-row')).map(node => node.getBoundingClientRect());
        const slots = Array.from(document.querySelectorAll('.find-slot input')).map(node => node.getBoundingClientRect());
        const lines = Array.from(document.querySelectorAll('#findLines line')).map(node => ({
            y1: Number(node.getAttribute('y1')),
            y2: Number(node.getAttribute('y2'))
        }));
        const gamesTab = document.querySelector('.nav-tab.active');
        return {
            rowCount: rows.length,
            slotCount: slots.length,
            lineCount: lines.length,
            topsAligned: Math.abs(rows[0].top - slots[0].top) < 6,
            bottomsAligned: Math.abs(rows[rows.length - 1].bottom - slots[slots.length - 1].bottom) < 6,
            animalLinesDescend: lines[0].y2 < lines[1].y2 && lines[1].y2 < lines[2].y2,
            activeTab: gamesTab ? gamesTab.textContent : '',
            pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            categoriesFit: Array.from(document.querySelectorAll('.find-category')).every(node => {
                const box = node.getBoundingClientRect();
                const slotLeft = document.querySelector('.find-slot')?.getBoundingClientRect().left || 0;
                const full = node.scrollWidth <= node.clientWidth + 1;
                const clear = box.right <= slotLeft - 20;
                return full && clear && (node.textContent !== 'transportation' || box.width > 80);
            }),
            boardHeight: document.getElementById('findBoard')?.getBoundingClientRect().height || 0
        };
    });
    report.check('six rows, eight letters, eighteen lines',
        layout.rowCount === 6 && layout.slotCount === 8 && layout.lineCount === 18);
    report.check('rows and letters share the top and bottom',
        layout.topsAligned && layout.bottomsAligned);
    report.check('a color reads top line first', layout.animalLinesDescend);
    report.check('Games tab is active', layout.activeTab === 'Games');
    report.check('desktop board does not widen the page', layout.pageOverflow === false);
    report.check('category names sit clear of the letters', layout.categoriesFit);
    report.check('the board is the letter column, not the viewport',
        layout.boardHeight > 280 && layout.boardHeight < 640);

    const lead = await tab.locator('.find-lead').innerText();
    report.check('lead is one short line', lead.length < 50 && !/closest|suggest|spelling/i.test(lead));
    report.check('no suggestion element', await tab.locator('.find-spell').count() === 0);

    await fillLetters(tab, SOLUTION);
    await tab.waitForFunction(() => document.getElementById('findScore')?.textContent === '18');
    const leaked = await tab.evaluate(() => {
        const categories = new Set(['animal', 'verb', 'transportation', 'food', 'furniture']);
        return Array.from(document.querySelectorAll('#findConstraints *'))
            .filter(node => node.childElementCount === 0)
            .map(node => (node.textContent || '').trim().toLowerCase())
            .filter(text => text.length > 1 && !categories.has(text) && !/^\d+$/.test(text));
    });
    report.check('a finished board names no category words', leaked.length === 0);
    const saved = await tab.evaluate(() => {
        const raw = localStorage.getItem('voice-wei:games-find');
        return raw ? JSON.parse(raw).data.letters.join('') : '';
    });
    report.check('letters persist', saved === 'cscaroty');

    await tab.locator('[data-slot="5"]').fill('e');
    await tab.waitForFunction(() => document.getElementById('findScore')?.textContent === '16');
    const marked = await tab.locator('.is-miss, .is-match').count();
    report.check('partial letters are not marked right or wrong', marked === 0);

    await tab.locator('[data-row="0"][data-letter="0"]').fill('b');
    await tab.waitForFunction(() => {
        const right = document.querySelector('[data-slot="0"]');
        const shared = document.querySelector('[data-row="4"][data-letter="0"]');
        return right instanceof HTMLInputElement && shared instanceof HTMLInputElement
            && right.value === 'b' && shared.value === 'b';
    });
    report.check('typing on the left writes the shared letter', true);

    await tab.click('#findClear');
    await tab.waitForFunction(() => document.getElementById('findScore')?.textContent === '0');
    const cleared = await tab.locator('[data-slot="0"]').inputValue();
    report.check('clear empties the column', cleared === '');

    await tab.locator('[data-slot="0"]').fill('c');
    await tab.reload({ waitUntil: 'networkidle' });
    await tab.waitForFunction(() => document.querySelector('[data-slot="0"]')?.value === 'c');
    report.check('a letter survives reload', true);

    await tab.setViewportSize({ width: 390, height: 844 });
    await tab.waitForFunction(() => document.querySelectorAll('#findLines line').length === 18);
    const phone = await tab.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        score: document.getElementById('findScore')?.textContent,
        rowNowrap: Array.from(document.querySelectorAll('.find-row')).every(row => getComputedStyle(row).whiteSpace === 'nowrap'),
        categoriesFit: Array.from(document.querySelectorAll('.find-category')).every(node => {
            const box = node.getBoundingClientRect();
            const slotLeft = document.querySelector('.find-slot')?.getBoundingClientRect().left || 0;
            return node.textContent === 'transportation'
                ? box.width > 70 && box.right <= slotLeft - 16
                : box.right <= slotLeft - 16;
        })
    }));
    report.check('phone width does not overflow', phone.overflow === false);
    report.check('transportation stays fully visible on a phone', phone.categoriesFit);
    report.check('reloaded letter still scores', phone.score === '2');
    report.check('rows stay one line', phone.rowNowrap);

    await tab.screenshot({ path: '/opt/cursor/artifacts/find-phone.png', fullPage: true });
    await fillLetters(tab, SOLUTION);
    await tab.waitForFunction(() => document.getElementById('findScore')?.textContent === '18');
    await tab.screenshot({ path: '/opt/cursor/artifacts/find-phone-solved.png', fullPage: true });
    await tab.setViewportSize({ width: 1280, height: 900 });
    await tab.waitForFunction(() => document.querySelectorAll('#findLines line').length === 18);
    await tab.screenshot({ path: '/opt/cursor/artifacts/find-desktop-solved.png', fullPage: true });

    const home = await browser.newPage();
    collectErrors(home, 'index.html', pageErrors);
    await home.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 30000 });
    const card = await home.locator('a.home-card[href="games.html"] h2').textContent();
    report.check('home card links to Games', card === 'Games');

    pageErrors.forEach(error => report.errors.push(error));
    report.check('games.html stays free of console errors', pageErrors.length === 0);

    await browser.close();
    report.finish();
})().catch(err => {
    console.error(err);
    process.exit(1);
});
