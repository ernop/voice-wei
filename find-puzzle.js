// @ts-check
//-----------------------------------------------------------------------
// FIND PUZZLE
// Eight letters on the right. Each constraint reads three of them, top
// target first, into a category word on the left. Puzzle 1 is Dana
// Moshkovitz's first projection puzzle (play.pptx slide 2, solution on
// slide 3). The other ten use the same categories and the same lexicon,
// with a different wiring. Each has one column that scores 18. Those
// columns live in the test, not here, so the page cannot show them.
//
// Score, from the puzzle page: a category word scores 1 per letter, and a
// partial spelling scores 1 per letter that matches in place. The lexicon
// is for scoring only. The page never lists those words.
//-----------------------------------------------------------------------

const FindPuzzle = (function () {
    'use strict';

    /** @type {Readonly<Record<string, readonly string[]>>} */
    const LEXICON = Object.freeze({
        animal: Object.freeze([
            'ant', 'ape', 'asp', 'bat', 'bee', 'boa', 'bug', 'cat', 'cow', 'cub',
            'doe', 'dog', 'eel', 'elk', 'emu', 'ewe', 'fly', 'fox', 'gnu', 'hen',
            'hog', 'jay', 'kid', 'kit', 'koi', 'owl', 'pig', 'pup', 'ram', 'rat',
            'roe', 'sow', 'yak'
        ]),
        verb: Object.freeze([
            'act', 'add', 'aim', 'ask', 'ban', 'beg', 'bet', 'bid', 'bow', 'buy',
            'cry', 'cut', 'dig', 'dip', 'dry', 'eat', 'end', 'fit', 'fix', 'fly',
            'fry', 'get', 'hem', 'hit', 'hop', 'hug', 'jam', 'jog', 'jot', 'lay',
            'let', 'lie', 'lit', 'mix', 'mop', 'nap', 'nip', 'nod', 'pat', 'pay',
            'pet', 'ply', 'pry', 'put', 'rid', 'rip', 'rob', 'row', 'rub', 'run',
            'saw', 'say', 'see', 'set', 'sew', 'sip', 'sit', 'ski', 'sob', 'sow',
            'tag', 'tan', 'tap', 'tax', 'tip', 'tow', 'try', 'tug', 'use', 'vie',
            'vow', 'wag', 'wed', 'wet', 'win', 'zip'
        ]),
        transportation: Object.freeze([
            'bus', 'cab', 'car', 'jet', 'rig', 'sub', 'suv', 'tug', 'van'
        ]),
        food: Object.freeze([
            'ale', 'bun', 'cob', 'cod', 'dip', 'egg', 'fig', 'gum', 'ham', 'jam',
            'lox', 'nut', 'oat', 'oil', 'pea', 'pho', 'pie', 'pop', 'rib', 'rum',
            'rye', 'soy', 'tea', 'yam'
        ]),
        furniture: Object.freeze(['bed', 'cot', 'pew', 'rug'])
    });

    const CATEGORIES = Object.freeze(['animal', 'verb', 'transportation', 'food', 'furniture', 'verb']);
    const COLORS = Object.freeze(['#ff4d4d', '#5dff8a', '#ffd000', '#4da3ff', '#ffffff', '#d28bff']);

    /**
     * @param {string} id
     * @param {readonly (readonly number[])[]} wirings
     */
    function makePuzzle(id, wirings) {
        return Object.freeze({
            id,
            slotCount: 8,
            constraints: Object.freeze(wirings.map((slots, index) => Object.freeze({
                category: CATEGORIES[index],
                color: COLORS[index],
                slots: Object.freeze(slots)
            })))
        });
    }

    // Slot indexes are top-to-bottom on the right column, which is the
    // letter order. Puzzle 1 is the slide connectors. Each later wiring
    // was accepted only when one assignment scored 18, every letter sat
    // on at least two lines, and the figure was connected.
    const PUZZLES = Object.freeze([
        makePuzzle('projection-1', [[0, 3, 6], [1, 3, 7], [2, 3, 4], [1, 5, 7], [0, 5, 6], [2, 4, 7]]),
        makePuzzle('projection-2', [[0, 4, 6], [1, 4, 6], [0, 5, 7], [1, 2, 4], [1, 2, 3], [3, 5, 7]]),
        makePuzzle('projection-3', [[4, 5, 7], [1, 3, 6], [1, 4, 5], [3, 4, 7], [0, 2, 6], [0, 2, 7]]),
        makePuzzle('projection-4', [[0, 3, 6], [0, 4, 6], [1, 4, 7], [2, 4, 5], [1, 2, 5], [0, 3, 7]]),
        makePuzzle('projection-5', [[1, 5, 6], [0, 2, 7], [0, 5, 7], [1, 2, 6], [1, 3, 4], [0, 3, 4]]),
        makePuzzle('projection-6', [[0, 4, 6], [1, 3, 7], [2, 3, 6], [1, 3, 4], [0, 5, 6], [2, 5, 7]]),
        makePuzzle('projection-7', [[2, 4, 7], [1, 3, 5], [0, 3, 5], [1, 4, 7], [2, 3, 6], [0, 4, 6]]),
        makePuzzle('projection-8', [[2, 3, 6], [1, 4, 7], [1, 3, 6], [2, 3, 5], [0, 5, 7], [0, 4, 7]]),
        makePuzzle('projection-9', [[5, 6, 7], [0, 2, 7], [1, 6, 7], [3, 4, 5], [0, 2, 3], [1, 4, 5]]),
        makePuzzle('projection-10', [[1, 3, 6], [0, 2, 4], [0, 2, 5], [3, 5, 7], [1, 3, 4], [1, 6, 7]]),
        makePuzzle('projection-11', [[1, 3, 4], [0, 3, 6], [2, 5, 7], [1, 3, 6], [0, 5, 7], [2, 3, 4]])
    ]);
    const PUZZLE = PUZZLES[0];

    function assertPuzzle() {
        const categories = Object.keys(LEXICON);
        categories.forEach(category => {
            const seen = new Set();
            LEXICON[category].forEach(word => {
                if (!/^[a-z]{3}$/.test(word)) {
                    throw new Error(`Find lexicon ${category} has a non-word "${word}"`);
                }
                if (seen.has(word)) {
                    throw new Error(`Find lexicon ${category} repeats "${word}"`);
                }
                seen.add(word);
            });
        });
        if (PUZZLES.length === 0 || PUZZLE !== PUZZLES[0] || PUZZLE.id !== 'projection-1') {
            throw new Error('Find puzzle 1 must stay first');
        }
        const ids = new Set();
        const wirings = new Set();
        PUZZLES.forEach(puzzle => {
            if (ids.has(puzzle.id)) throw new Error(`Find puzzle id ${puzzle.id} repeats`);
            ids.add(puzzle.id);
            if (puzzle.slotCount !== 8 || puzzle.constraints.length !== CATEGORIES.length) {
                throw new Error(`Find puzzle ${puzzle.id} is not an eight-letter, six-line board`);
            }
            const degree = Array.from({ length: puzzle.slotCount }, () => 0);
            const lines = new Set();
            puzzle.constraints.forEach((constraint, index) => {
                if (constraint.category !== CATEGORIES[index] || constraint.color !== COLORS[index]) {
                    throw new Error(`Find puzzle ${puzzle.id} line ${index + 1} drifted from the row order`);
                }
                if (!Object.prototype.hasOwnProperty.call(LEXICON, constraint.category)) {
                    throw new Error(`Find puzzle category "${constraint.category}" has no lexicon`);
                }
                if (constraint.slots.length !== 3) {
                    throw new Error(`Find constraint ${constraint.category} must read 3 letters`);
                }
                for (let i = 0; i < constraint.slots.length; i++) {
                    const slot = constraint.slots[i];
                    if (slot < 0 || slot >= puzzle.slotCount) {
                        throw new Error(`Find puzzle ${puzzle.id} slot ${slot} is outside the column`);
                    }
                    if (i > 0 && slot <= constraint.slots[i - 1]) {
                        throw new Error(`Find puzzle ${puzzle.id} slots must run top to bottom`);
                    }
                    degree[slot]++;
                }
                const lineKey = constraint.slots.join(',');
                if (lines.has(lineKey)) throw new Error(`Find puzzle ${puzzle.id} repeats a line`);
                lines.add(lineKey);
            });
            degree.forEach((count, slot) => {
                if (count < 2) {
                    throw new Error(`Find puzzle ${puzzle.id} letter ${slot + 1} is on fewer than two lines`);
                }
            });
            const parent = Array.from({ length: puzzle.slotCount }, (_, slot) => slot);
            const find = (/** @type {number} */ slot) => {
                let at = slot;
                while (parent[at] !== at) {
                    parent[at] = parent[parent[at]];
                    at = parent[at];
                }
                return at;
            };
            puzzle.constraints.forEach(constraint => {
                parent[find(constraint.slots[1])] = find(constraint.slots[0]);
                parent[find(constraint.slots[2])] = find(constraint.slots[0]);
            });
            const root = find(0);
            for (let slot = 1; slot < puzzle.slotCount; slot++) {
                if (find(slot) !== root) throw new Error(`Find puzzle ${puzzle.id} leaves a letter disconnected`);
            }
            const wiring = puzzle.constraints.map(constraint => constraint.slots.join(',')).sort().join('|');
            if (wirings.has(wiring)) throw new Error(`Find puzzle ${puzzle.id} repeats another wiring`);
            wirings.add(wiring);
        });
    }

    /**
     * @param {readonly string[]} letters
     * @param {readonly number[]} slots
     * @returns {string[]}
     */
    function project(letters, slots) {
        return slots.map(slot => letters[slot] || '');
    }

    /**
     * Best in-place overlap between the projected letters and the category.
     * Empty cells never match. Tied words stay inside the score; callers
     * must not show them. A zero overlap lists none.
     * @param {string} category
     * @param {readonly string[]} projected
     * @returns {{ score: number, words: string[] }}
     */
    function scoreProjection(category, projected) {
        const lexicon = LEXICON[category];
        if (!lexicon) {
            throw new Error(`Unknown Find category "${category}"`);
        }
        let best = 0;
        /** @type {string[]} */
        const matched = [];
        lexicon.forEach(word => {
            if (word.length !== projected.length) return;
            let hits = 0;
            for (let i = 0; i < word.length; i++) {
                if (projected[i] && projected[i] === word[i]) hits++;
            }
            if (hits === 0 || hits < best) return;
            if (hits > best) {
                best = hits;
                matched.length = 0;
            }
            matched.push(word);
        });
        matched.sort();
        return { score: best, words: matched };
    }

    /**
     * @param {readonly string[]} projected
     * @param {readonly string[]} words
     * @returns {Array<'empty' | 'match' | 'miss'>}
     */
    function letterMarks(projected, words) {
        return projected.map((letter, index) => {
            if (!letter) return 'empty';
            const agreed = words.some(word => word[index] === letter);
            return agreed ? 'match' : 'miss';
        });
    }

    /**
     * @param {readonly string[]} letters
     * @param {{ id: string, slotCount: number, constraints: readonly { category: string, color: string, slots: readonly number[] }[] }} [puzzle]
     * @returns {{ total: number, rows: Array<{ category: string, color: string, slots: readonly number[], projected: string[], score: number, words: string[] }> }}
     */
    function scoreBoard(letters, puzzle = PUZZLE) {
        if (!Array.isArray(letters) || letters.length !== puzzle.slotCount) {
            throw new Error(`Find board needs ${puzzle.slotCount} letters`);
        }
        const rows = puzzle.constraints.map(constraint => {
            const projected = project(letters, constraint.slots);
            const scored = scoreProjection(constraint.category, projected);
            return {
                category: constraint.category,
                color: constraint.color,
                slots: constraint.slots,
                projected,
                score: scored.score,
                words: scored.words
            };
        });
        const total = rows.reduce((sum, row) => sum + row.score, 0);
        return { total, rows };
    }

    assertPuzzle();

    return Object.freeze({
        LEXICON,
        PUZZLES,
        PUZZLE,
        project,
        scoreProjection,
        letterMarks,
        scoreBoard
    });
})();

window.FindPuzzle = FindPuzzle;
