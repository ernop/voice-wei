// @ts-check
//-----------------------------------------------------------------------
// FIND PUZZLE
// Dana Moshkovitz's first projection puzzle (play.pptx slide 2, solution
// on slide 3). Eight letters on the right. Each constraint reads three of
// them, top target first, into a category word on the left.
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

    // Slot indexes are top-to-bottom on the right column, which is the
    // letter order. Read off the slide connectors (solution cat/say/car/
    // soy/cot/cry against letters c,s,c,a,r,o,t,y).
    const PUZZLE = Object.freeze({
        id: 'projection-1',
        slotCount: 8,
        constraints: Object.freeze([
            Object.freeze({ category: 'animal', color: '#ff4d4d', slots: Object.freeze([0, 3, 6]) }),
            Object.freeze({ category: 'verb', color: '#5dff8a', slots: Object.freeze([1, 3, 7]) }),
            Object.freeze({ category: 'transportation', color: '#ffd000', slots: Object.freeze([2, 3, 4]) }),
            Object.freeze({ category: 'food', color: '#4da3ff', slots: Object.freeze([1, 5, 7]) }),
            Object.freeze({ category: 'furniture', color: '#ffffff', slots: Object.freeze([0, 5, 6]) }),
            Object.freeze({ category: 'verb', color: '#d28bff', slots: Object.freeze([2, 4, 7]) })
        ])
    });

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
        if (PUZZLE.constraints.length === 0) {
            throw new Error('Find puzzle has no constraints');
        }
        PUZZLE.constraints.forEach(constraint => {
            if (!Object.prototype.hasOwnProperty.call(LEXICON, constraint.category)) {
                throw new Error(`Find puzzle category "${constraint.category}" has no lexicon`);
            }
            if (constraint.slots.length !== 3) {
                throw new Error(`Find constraint ${constraint.category} must read 3 letters`);
            }
            for (let i = 0; i < constraint.slots.length; i++) {
                const slot = constraint.slots[i];
                if (slot < 0 || slot >= PUZZLE.slotCount) {
                    throw new Error(`Find constraint ${constraint.category} slot ${slot} is outside the column`);
                }
                if (i > 0 && slot <= constraint.slots[i - 1]) {
                    throw new Error(`Find constraint ${constraint.category} slots must run top to bottom`);
                }
            }
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
     * @returns {{ total: number, rows: Array<{ category: string, color: string, slots: readonly number[], projected: string[], score: number, words: string[] }> }}
     */
    function scoreBoard(letters) {
        if (!Array.isArray(letters) || letters.length !== PUZZLE.slotCount) {
            throw new Error(`Find board needs ${PUZZLE.slotCount} letters`);
        }
        const rows = PUZZLE.constraints.map(constraint => {
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
        PUZZLE,
        project,
        scoreProjection,
        letterMarks,
        scoreBoard
    });
})();

window.FindPuzzle = FindPuzzle;
