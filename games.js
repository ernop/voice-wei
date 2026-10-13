// @ts-check
//-----------------------------------------------------------------------
// GAMES
// The Find board. Letters live in the right-hand column; each constraint
// projects three of them. Scoring and spelling hints come from FindPuzzle.
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

    function persist() {
        store.saveJson(keys.GAMES_FIND, { letters: letters.slice() });
    }

    /**
     * @param {readonly string[]} words
     * @returns {string}
     */
    function hintText(words) {
        const shown = words.slice(0, 8);
        const extra = words.length - shown.length;
        const list = shown.join(' · ');
        return extra > 0 ? `${list} +${extra}` : list;
    }

    function render() {
        const board = puzzleApi.scoreBoard(letters);
        scoreNode.textContent = String(board.total);
        board.rows.forEach((rowScore, rowIndex) => {
            const row = rows[rowIndex];
            const cells = row.querySelectorAll('.find-cell');
            const marks = puzzleApi.letterMarks(rowScore.projected, rowScore.words);
            rowScore.projected.forEach((letter, cellIndex) => {
                const cell = cells[cellIndex];
                if (!(cell instanceof HTMLElement)) return;
                cell.textContent = letter ? letter.toUpperCase() : '';
                cell.classList.toggle('is-match', marks[cellIndex] === 'match');
                cell.classList.toggle('is-miss', marks[cellIndex] === 'miss');
                cell.style.borderColor = marks[cellIndex] === 'miss'
                    ? '#ff4d4d'
                    : (marks[cellIndex] === 'match' ? rowScore.color : '#fff');
            });
            const points = row.querySelector('.find-points');
            if (points) points.textContent = String(rowScore.score);
            const spell = row.querySelector('.find-spell');
            if (spell) {
                const anyLetter = rowScore.projected.some(letter => letter !== '');
                spell.textContent = rowScore.words.length
                    ? hintText(rowScore.words)
                    : (anyLetter ? 'none' : '');
            }
            const spoken = rowScore.projected.map(letter => letter || 'blank').join(' ');
            const spelling = rowScore.words.length ? `, ${rowScore.words.slice(0, 8).join(' ')}` : '';
            row.setAttribute('aria-label',
                `${rowScore.category}, ${spoken}, ${rowScore.score} points${spelling}`);
        });
        inputs.forEach((input, index) => {
            if (input.value.toLowerCase() !== letters[index]) {
                input.value = letters[index];
            }
        });
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

    puzzle.constraints.forEach(constraint => {
        const row = document.createElement('div');
        row.className = 'find-row';
        row.setAttribute('role', 'group');

        const cellRow = document.createElement('div');
        cellRow.className = 'find-cells';
        for (let i = 0; i < constraint.slots.length; i++) {
            const cell = document.createElement('div');
            cell.className = 'find-cell';
            cellRow.appendChild(cell);
        }

        const points = document.createElement('div');
        points.className = 'find-points';
        points.textContent = '0';

        const category = document.createElement('div');
        category.className = 'find-category';
        category.textContent = constraint.category;
        category.style.color = constraint.color;

        const spell = document.createElement('div');
        spell.className = 'find-spell';

        row.appendChild(cellRow);
        row.appendChild(points);
        row.appendChild(category);
        row.appendChild(spell);
        constraintsHost.appendChild(row);
        rows.push(row);
    });

    for (let index = 0; index < puzzle.slotCount; index++) {
        const slot = document.createElement('div');
        slot.className = 'find-slot';
        const input = document.createElement('input');
        input.className = 'text-input';
        input.type = 'text';
        input.maxLength = 8;
        input.autocapitalize = 'characters';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-label', `Letter ${index + 1}`);
        input.dataset.slot = String(index);
        input.value = letters[index];

        input.addEventListener('input', () => {
            const chars = (input.value.toLowerCase().match(/[a-z]/g) || []).join('');
            if (chars.length === 0) {
                letters[index] = '';
            } else {
                const room = puzzle.slotCount - index;
                const written = chars.slice(0, room);
                for (let offset = 0; offset < written.length; offset++) {
                    letters[index + offset] = written[offset];
                }
            }
            persist();
            render();
            if (chars.length > 1) {
                const dest = Math.min(puzzle.slotCount - 1, index + chars.length);
                inputs[dest].focus();
            } else if (chars.length === 1 && index < puzzle.slotCount - 1) {
                inputs[index + 1].focus();
            }
        });

        input.addEventListener('keydown', event => {
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
        inputs[0].focus();
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
