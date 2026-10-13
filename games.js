// @ts-check
//-----------------------------------------------------------------------
// GAMES
// The Find board. Eight letters, editable from the right column or from
// the left cell a line connects to. The page shows scores only. It never
// lists category words.
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

    const puzzle = puzzleApi.PUZZLE;
    const constraintsHost = document.getElementById('findConstraints');
    const slotsHost = document.getElementById('findSlots');
    const lines = document.getElementById('findLines');
    const scoreNode = document.getElementById('findScore');
    const clearButton = document.getElementById('findClear');
    if (!constraintsHost || !slotsHost || !(lines instanceof SVGSVGElement) || !scoreNode || !clearButton) {
        throw new Error('Find board markup is missing');
    }

    /** @type {string[]} */
    const letters = Array.from({ length: puzzle.slotCount }, () => '');

    /**
     * @param {unknown} data
     * @returns {data is { letters: string[] }}
     */
    function isSavedBoard(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
        const saved = /** @type {{ letters?: unknown }} */ (data).letters;
        return Array.isArray(saved)
            && saved.length === puzzle.slotCount
            && saved.every(letter => typeof letter === 'string' && (letter === '' || /^[a-z]$/.test(letter)));
    }

    const saved = store.loadJson(keys.GAMES_FIND, { letters }, isSavedBoard);
    saved.letters.forEach((letter, index) => {
        letters[index] = letter;
    });

    /** @type {HTMLInputElement[]} */
    const inputs = [];
    /** @type {HTMLElement[]} */
    const rows = [];
    /** @type {HTMLInputElement[][]} */
    const leftInputs = [];

    function persist() {
        store.saveJson(keys.GAMES_FIND, { letters: letters.slice() });
    }

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
        const board = puzzleApi.scoreBoard(letters);
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

    for (let index = 0; index < puzzle.slotCount; index++) {
        const slot = document.createElement('div');
        slot.className = 'find-slot';
        const input = document.createElement('input');
        input.className = 'text-input';
        input.type = 'text';
        input.maxLength = puzzle.slotCount - index;
        input.autocapitalize = 'characters';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-label', `Letter ${index + 1}`);
        input.dataset.slot = String(index);
        const slotRun = [];
        for (let slotIndex = index; slotIndex < puzzle.slotCount; slotIndex++) slotRun.push(slotIndex);
        bindInput(input, slotRun, written => {
            const dest = Math.min(puzzle.slotCount - 1, index + written);
            if (dest !== index) inputs[dest].focus();
        }, event => {
            if (event.key === 'ArrowDown' || event.key === 'Enter') {
                event.preventDefault();
                if (index < puzzle.slotCount - 1) inputs[index + 1].focus();
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
