// @ts-check
// Find puzzle: the score is positional overlap with the category lexicon.
// The page shows that score and never names a category word. Left cells
// edit the same letters as the right column.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

const SOLUTION = ['c', 's', 'c', 'a', 'r', 'o', 't', 'y'];

/** Letter columns that score 18. The page must not render these. */
const SOLUTIONS = {
    'projection-1': SOLUTION,
    'projection-2': ['j', 'p', 'e', 'w', 'a', 'e', 'y', 't'],
    'projection-3': ['p', 'v', 'e', 'o', 'a', 'n', 'w', 't'],
    'projection-4': ['s', 'c', 'o', 'o', 'a', 't', 'w', 'b'],
    'projection-5': ['s', 'p', 'o', 'e', 'w', 'u', 'p', 'b'],
    'projection-6': ['c', 'p', 'j', 'e', 'a', 'o', 't', 't'],
    'projection-7': ['t', 'h', 'r', 'u', 'a', 'g', 'g', 'm'],
    'projection-8': ['b', 'r', 'p', 'i', 'i', 'e', 'g', 'd'],
    'projection-9': ['b', 'r', 'e', 'd', 'i', 'p', 'i', 'g'],
    'projection-10': ['r', 'b', 'i', 'e', 'd', 'g', 'e', 'g'],
    'projection-11': ['r', 'c', 't', 'o', 'w', 'u', 'b', 'g']
};

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

    report.check('eleven boards, puzzle 1 first',
        FindPuzzle.PUZZLES.length === 11 && FindPuzzle.PUZZLE === FindPuzzle.PUZZLES[0]);
    const wiringKeys = FindPuzzle.PUZZLES.map(puzzle => puzzle.constraints.map(row => row.slots.join(',')).sort().join('|'));
    report.check('each wiring is its own', new Set(wiringKeys).size === FindPuzzle.PUZZLES.length);
    FindPuzzle.PUZZLES.forEach(puzzle => {
        const letters = SOLUTIONS[puzzle.id];
        const perfect = FindPuzzle.scoreBoard(letters, puzzle);
        const spelled = perfect.rows.map(row => row.words[0]);
        const degree = Array.from({ length: 8 }, () => 0);
        puzzle.constraints.forEach(row => row.slots.forEach(slot => { degree[slot]++; }));
        report.check(`${puzzle.id} scores 18 on one word per line`,
            perfect.total === 18
            && perfect.rows.every(row => row.score === 3 && row.words.length === 1 && row.projected.join('') === row.words[0])
            && new Set(spelled).size === 6
            && degree.every(count => count >= 2));
    });

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
    const chips = await tab.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('#findPuzzles .vf-btn'));
        const tops = buttons.map(node => node.getBoundingClientRect().top);
        return {
            count: buttons.length,
            labels: buttons.map(node => (node.textContent || '').trim()).join(''),
            oneLine: tops.length > 0 && Math.max(...tops) - Math.min(...tops) < 2,
            selected: buttons.filter(node => node.classList.contains('selected')).map(node => node.getAttribute('data-puzzle'))
        };
    });
    report.check('eleven puzzle numbers on one line',
        chips.count === 11 && chips.labels === '1234567891011' && chips.oneLine && chips.selected.join(',') === 'projection-1');

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
        if (!raw) return '';
        const data = JSON.parse(raw).data;
        return data.puzzleId === 'projection-1' && data.boards ? data.boards['projection-1'].join('') : '';
    });
    report.check('letters persist on puzzle 1', saved === 'cscaroty');

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

    const phoneChips = await tab.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('#findPuzzles .vf-btn'));
        const tops = buttons.map(node => node.getBoundingClientRect().top);
        return {
            oneLine: tops.length === 11 && Math.max(...tops) - Math.min(...tops) < 2,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        };
    });
    report.check('puzzle numbers stay one line on a phone', phoneChips.oneLine && phoneChips.overflow === false);
    await tab.screenshot({ path: '/opt/cursor/artifacts/find-phone.png', fullPage: true });

    await tab.locator('[data-puzzle="projection-2"]').click();
    await tab.waitForFunction(() => {
        const lines = Array.from(document.querySelectorAll('#findLines line'))
            .filter(node => node.getAttribute('data-row') === '0')
            .map(node => node.getAttribute('data-target'));
        return document.getElementById('findScore')?.textContent === '0'
            && lines.join(',') === '0,4,6';
    });
    const puzzleTwo = await tab.evaluate(() => {
        const categories = new Set(['animal', 'verb', 'transportation', 'food', 'furniture']);
        const leaked = Array.from(document.querySelectorAll('#findConstraints *'))
            .filter(node => node.childElementCount === 0)
            .map(node => (node.textContent || '').trim().toLowerCase())
            .filter(text => text.length > 1 && !categories.has(text) && !/^\d+$/.test(text));
        return {
            leaked: leaked.length,
            selected: document.querySelector('#findPuzzles .vf-btn.selected')?.getAttribute('data-puzzle') || '',
            slot: document.querySelector('[data-slot="0"]') instanceof HTMLInputElement
                ? document.querySelector('[data-slot="0"]').value
                : ''
        };
    });
    report.check('puzzle 2 opens empty and names no words',
        puzzleTwo.leaked === 0 && puzzleTwo.selected === 'projection-2' && puzzleTwo.slot === '');
    await tab.screenshot({ path: '/opt/cursor/artifacts/find-phone-puzzle-2.png', fullPage: true });

    await tab.locator('[data-puzzle="projection-1"]').click();
    await tab.waitForFunction(() => document.querySelector('[data-slot="0"]')?.value === 'c'
        && document.getElementById('findScore')?.textContent === '2');
    report.check('puzzle 1 keeps its letter', true);

    await fillLetters(tab, SOLUTION);
    await tab.waitForFunction(() => document.getElementById('findScore')?.textContent === '18');
    await tab.screenshot({ path: '/opt/cursor/artifacts/find-phone-solved.png', fullPage: true });
    await tab.setViewportSize({ width: 1280, height: 900 });
    await tab.waitForFunction(() => document.querySelectorAll('#findLines line').length === 18);
    await tab.screenshot({ path: '/opt/cursor/artifacts/find-desktop-solved.png', fullPage: true });

    const legacy = await browser.newPage();
    collectErrors(legacy, 'games.html', pageErrors);
    await legacy.goto(`${BASE_URL}/games.html`, { waitUntil: 'networkidle', timeout: 30000 });
    await legacy.evaluate(() => {
        localStorage.setItem('voice-wei:games-find', JSON.stringify({
            v: '1',
            data: { letters: ['q', '', '', '', '', '', '', ''] }
        }));
    });
    await legacy.reload({ waitUntil: 'networkidle' });
    await legacy.waitForFunction(() => document.querySelector('[data-slot="0"]')?.value === 'q');
    const migrated = await legacy.evaluate(() => {
        const data = JSON.parse(localStorage.getItem('voice-wei:games-find') || '{}').data;
        return {
            puzzleId: data.puzzleId,
            letters: data.boards && data.boards['projection-1'] ? data.boards['projection-1'].join('') : '',
            keptOldKey: Object.prototype.hasOwnProperty.call(data, 'letters')
        };
    });
    report.check('an older save stays on puzzle 1',
        migrated.puzzleId === 'projection-1' && migrated.letters === 'q' && migrated.keptOldKey === false);

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
