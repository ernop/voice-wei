// @ts-check
//-----------------------------------------------------------------------
// GAMES
// The Find boards. Eight letters, editable from the right column or from
// the left cell a line connects to. The page shows scores only. It never
// lists category words. Each puzzle keeps its own letters.
//-----------------------------------------------------------------------

(function () {
    'use strict';

    const puzzleApi = window.FindPuzzle;
    if (!puzzleApi) {
        throw new Error('FindPuzzle is not loaded');
    }
    const store = window.SettingsStore;
    const keys = window.StorageKeys;
    if (!store || !keys || !keys.GAMES_FIND) {
        throw new Error('Games persistence is not loaded');
    }

    const constraintsHost = document.getElementById('findConstraints');
    const slotsHost = document.getElementById('findSlots');
    const lines = document.getElementById('findLines');
    const scoreNode = document.getElementById('findScore');
    const clearButton = document.getElementById('findClear');
    const puzzlesHost = document.getElementById('findPuzzles');
    if (!constraintsHost || !slotsHost || !(lines instanceof SVGSVGElement) || !scoreNode || !clearButton || !puzzlesHost) {
        throw new Error('Find board markup is missing');
    }

    /**
     * @param {unknown} value
     * @returns {value is string[]}
     */
    function isLetterRow(value) {
        return Array.isArray(value)
            && value.length === puzzleApi.PUZZLE.slotCount
            && value.every(letter => typeof letter === 'string' && (letter === '' || /^[a-z]$/.test(letter)));
    }

    /**
     * @param {unknown} data
     * @returns {boolean}
     */
    function isSaved(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
        const record = /** @type {{ letters?: unknown, puzzleId?: unknown, boards?: unknown }} */ (data);
        if (record.boards !== undefined) {
            if (typeof record.puzzleId !== 'string') return false;
            if (!puzzleApi.PUZZLES.some(item => item.id === record.puzzleId)) return false;
            if (!record.boards || typeof record.boards !== 'object' || Array.isArray(record.boards)) return false;
            const boardsSaved = /** @type {Record<string, unknown>} */ (record.boards);
            return Object.keys(boardsSaved).every(id => isLetterRow(boardsSaved[id]));
        }
        return isLetterRow(record.letters);
    }

    /** @type {Record<string, string[]>} */
    const boards = {};
    puzzleApi.PUZZLES.forEach(item => {
        boards[item.id] = Array.from({ length: item.slotCount }, () => '');
    });

    let puzzleId = puzzleApi.PUZZLE.id;
    let puzzle = puzzleApi.PUZZLE;
    let letters = boards[puzzleId];
    let upgrade = false;

    const saved = store.loadJson(keys.GAMES_FIND, null, isSaved);
    if (saved && typeof saved === 'object') {
        const record = /** @type {{ letters?: string[], puzzleId?: string, boards?: Record<string, string[]> }} */ (saved);
        if (record.boards && record.puzzleId) {
            const next = puzzleApi.PUZZLES.find(item => item.id === record.puzzleId);
            if (!next) throw new Error(`Unknown Find puzzle ${record.puzzleId}`);
            puzzleId = next.id;
            puzzle = next;
            puzzleApi.PUZZLES.forEach(item => {
                const row = record.boards && record.boards[item.id];
                if (isLetterRow(row)) boards[item.id] = row.slice();
            });
            letters = boards[puzzleId];
        } else if (isLetterRow(record.letters)) {
            boards[puzzleApi.PUZZLE.id] = record.letters.slice();
            letters = boards[puzzleId];
            upgrade = true;
        }
    }

    /** @type {HTMLInputElement[]} */
    const inputs = [];
    /** @type {HTMLElement[]} */
    const rows = [];
    /** @type {HTMLInputElement[][]} */
    const leftInputs = [];
    /** @type {HTMLButtonElement[]} */
    const chips = [];

    function persist() {
        /** @type {Record<string, string[]>} */
        const stored = {};
        puzzleApi.PUZZLES.forEach(item => {
            stored[item.id] = boards[item.id].slice();
        });
        store.saveJson(keys.GAMES_FIND, { puzzleId, boards: stored });
    }

    if (upgrade) persist();

    /** @param {string} raw */
    function readLetters(raw) {
        return (raw.toLowerCase().match(/[a-z]/g) || []).join('');
    }

    /**
     * @param {HTMLInputElement} input
     * @param {string} letter
     */
    function showLetter(input, letter) {
        if (input.value.toLowerCase() !== letter) input.value = letter;
    }

    function render() {
        const board = puzzleApi.scoreBoard(letters, puzzle);
        scoreNode.textContent = String(board.total);
        board.rows.forEach((rowScore, rowIndex) => {
            const row = rows[rowIndex];
            rowScore.projected.forEach((letter, cellIndex) => {
                showLetter(leftInputs[rowIndex][cellIndex], letter);
            });
            const points = row.querySelector('.find-points');
            if (points) points.textContent = String(rowScore.score);
            const spoken = rowScore.projected.map(letter => letter || 'blank').join(' ');
            row.setAttribute('aria-label', `${rowScore.category}, ${spoken}, ${rowScore.score}`);
        });
        inputs.forEach((input, index) => showLetter(input, letters[index]));
        drawLines();
    }

    function drawLines() {
        const board = document.getElementById('findBoard');
        if (!board) return;
        while (lines.firstChild) lines.removeChild(lines.firstChild);
        const boardRect = board.getBoundingClientRect();
        if (boardRect.width < 1 || boardRect.height < 1) return;
        lines.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);
        const starts = [0.2, 0.5, 0.8];
        puzzle.constraints.forEach((constraint, rowIndex) => {
            const row = rows[rowIndex];
            const rowRect = row.getBoundingClientRect();
            constraint.slots.forEach((slotIndex, letterIndex) => {
                const slot = inputs[slotIndex];
                const slotRect = slot.getBoundingClientRect();
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', String(rowRect.right - boardRect.left));
                line.setAttribute('y1', String(rowRect.top - boardRect.top + rowRect.height * starts[letterIndex]));
                line.setAttribute('x2', String(slotRect.left - boardRect.left));
                line.setAttribute('y2', String(slotRect.top - boardRect.top + slotRect.height / 2));
                line.setAttribute('stroke', constraint.color);
                line.setAttribute('stroke-width', '2.5');
                line.setAttribute('stroke-linecap', 'round');
                line.dataset.row = String(rowIndex);
                line.dataset.target = String(slotIndex);
                lines.appendChild(line);
            });
        });
    }

    /**
     * @param {HTMLInputElement} input
     * @param {readonly number[]} slotRun slots this paste may fill, first is this box
     * @param {(written: number) => void} focusAfter
     * @param {(event: KeyboardEvent) => void} onKey
     */
    function bindInput(input, slotRun, focusAfter, onKey) {
        input.addEventListener('input', () => {
            const chars = readLetters(input.value);
            if (chars.length === 0) {
                letters[slotRun[0]] = '';
            } else {
                for (let offset = 0; offset < chars.length && offset < slotRun.length; offset++) {
                    letters[slotRun[offset]] = chars[offset];
                }
            }
            persist();
            render();
            if (chars.length > 0) focusAfter(chars.length);
        });
        input.addEventListener('keydown', onKey);
    }

    function buildRows() {
        constraintsHost.replaceChildren();
        rows.length = 0;
        leftInputs.length = 0;
        puzzle.constraints.forEach((constraint, rowIndex) => {
            const row = document.createElement('div');
            row.className = 'find-row';
            row.setAttribute('role', 'group');

            const cellRow = document.createElement('div');
            cellRow.className = 'find-cells';
            /** @type {HTMLInputElement[]} */
            const cells = [];
            for (let letterIndex = 0; letterIndex < constraint.slots.length; letterIndex++) {
                const input = document.createElement('input');
                input.className = 'text-input';
                input.type = 'text';
                input.maxLength = constraint.slots.length - letterIndex;
                input.autocapitalize = 'characters';
                input.autocomplete = 'off';
                input.spellcheck = false;
                input.dataset.row = String(rowIndex);
                input.dataset.letter = String(letterIndex);
                input.setAttribute('aria-label', `${constraint.category} letter ${letterIndex + 1}`);
                const slotRun = constraint.slots.slice(letterIndex);
                bindInput(input, slotRun, written => {
                    const next = Math.min(cells.length - 1, letterIndex + written);
                    if (next !== letterIndex) cells[next].focus();
                }, event => {
                    if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        if (letterIndex < cells.length - 1) cells[letterIndex + 1].focus();
                    } else if (event.key === 'ArrowLeft' || (event.key === 'Backspace' && input.value === '')) {
                        if (letterIndex === 0) return;
                        event.preventDefault();
                        if (event.key === 'Backspace') {
                            letters[constraint.slots[letterIndex - 1]] = '';
                            persist();
                            render();
                        }
                        cells[letterIndex - 1].focus();
                    } else if (event.key === 'ArrowDown' && rowIndex < puzzle.constraints.length - 1) {
                        event.preventDefault();
                        leftInputs[rowIndex + 1][letterIndex].focus();
                    } else if (event.key === 'ArrowUp' && rowIndex > 0) {
                        event.preventDefault();
                        leftInputs[rowIndex - 1][letterIndex].focus();
                    }
                });
                cellRow.appendChild(input);
                cells.push(input);
            }
            leftInputs.push(cells);

            const points = document.createElement('div');
            points.className = 'find-points';
            points.textContent = '0';

            const category = document.createElement('div');
            category.className = 'find-category';
            category.textContent = constraint.category;
            category.style.color = constraint.color;

            row.appendChild(cellRow);
            row.appendChild(points);
            row.appendChild(category);
            constraintsHost.appendChild(row);
            rows.push(row);
        });
    }

    function markChips() {
        chips.forEach(chip => {
            const on = chip.dataset.puzzle === puzzleId;
            chip.classList.toggle('selected', on);
            chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    /**
     * @param {string} id
     */
    function selectPuzzle(id) {
        if (id === puzzleId) return;
        const next = puzzleApi.PUZZLES.find(item => item.id === id);
        if (!next) throw new Error(`Unknown Find puzzle ${id}`);
        puzzleId = next.id;
        puzzle = next;
        letters = boards[puzzleId];
        buildRows();
        markChips();
        persist();
        render();
    }

    const chipRow = document.createElement('div');
    chipRow.className = 'segment-row';
    chipRow.setAttribute('role', 'group');
    chipRow.setAttribute('aria-label', 'Puzzle');
    puzzleApi.PUZZLES.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'vf-btn';
        button.textContent = String(index + 1);
        button.dataset.puzzle = item.id;
        button.setAttribute('aria-label', `Puzzle ${index + 1}`);
        button.addEventListener('click', () => selectPuzzle(item.id));
        chipRow.appendChild(button);
        chips.push(button);
    });
    puzzlesHost.appendChild(chipRow);
    markChips();

    for (let index = 0; index < puzzleApi.PUZZLE.slotCount; index++) {
        const slot = document.createElement('div');
        slot.className = 'find-slot';
        const input = document.createElement('input');
        input.className = 'text-input';
        input.type = 'text';
        input.maxLength = puzzleApi.PUZZLE.slotCount - index;
        input.autocapitalize = 'characters';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-label', `Letter ${index + 1}`);
        input.dataset.slot = String(index);
        const slotRun = [];
        for (let slotIndex = index; slotIndex < puzzleApi.PUZZLE.slotCount; slotIndex++) slotRun.push(slotIndex);
        bindInput(input, slotRun, written => {
            const dest = Math.min(puzzleApi.PUZZLE.slotCount - 1, index + written);
            if (dest !== index) inputs[dest].focus();
        }, event => {
            if (event.key === 'ArrowDown' || event.key === 'Enter') {
                event.preventDefault();
                if (index < puzzleApi.PUZZLE.slotCount - 1) inputs[index + 1].focus();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (index > 0) inputs[index - 1].focus();
            } else if (event.key === 'Backspace' && input.value === '' && index > 0) {
                event.preventDefault();
                letters[index - 1] = '';
                persist();
                render();
                inputs[index - 1].focus();
            }
        });
        slot.appendChild(input);
        slotsHost.appendChild(slot);
        inputs.push(input);
    }

    buildRows();

    clearButton.addEventListener('click', () => {
        for (let index = 0; index < letters.length; index++) letters[index] = '';
        persist();
        render();
        leftInputs[0][0].focus();
    });

    render();
    requestAnimationFrame(() => drawLines());
    window.addEventListener('resize', drawLines);
    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => drawLines());
        observer.observe(lines);
    }
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => drawLines());
    }
})();
