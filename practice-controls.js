// @ts-check
//-----------------------------------------------------------------------
// PRACTICE CONTROLS
// Shared wiring for the practice-page control language: single-select
// button groups ([data-*] + .selected), discrete +/- steppers
// ([data-step-key]/[data-step-delta]), and checkbox toggles.
//-----------------------------------------------------------------------

const PracticeControls = (function () {
    'use strict';

    function getEl(id) { return document.getElementById(id); }

    /** @param {string} id @param {string} text */
    function setValueText(id, text) {
        const el = getEl(id);
        if (el) el.textContent = text;
    }

    /** @param {number} ms */
    function formatSeconds(ms) {
        return `${ms / 1000}s`;
    }

    /**
     * Move .selected to the button whose attribute matches expectedValue.
     * @param {string} attr @param {string | number | boolean} expectedValue
     */
    function syncSingleSelect(attr, expectedValue) {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', btn.getAttribute(attr) === String(expectedValue));
        });
    }

    /**
     * Wire a mutually exclusive button group. apply(parsedValue) runs on
     * click after .selected has moved.
     * @param {string} attr
     * @param {(raw: string) => any} parse
     * @param {any} currentValue
     * @param {(value: any) => void} apply
     */
    function wireSingleSelect(attr, parse, currentValue, apply) {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            const raw = btn.getAttribute(attr) || '';
            if (String(parse(raw)) === String(currentValue)) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                document.querySelectorAll(`[${attr}]`).forEach(other => other.classList.remove('selected'));
                btn.classList.add('selected');
                apply(parse(raw));
            });
        });
    }

    /**
     * Wire every [data-step-key] button to step(key, delta).
     * @param {(key: string, delta: number) => void} step
     */
    function wireSteppers(step) {
        document.querySelectorAll('[data-step-key]').forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => {
                step(btn.getAttribute('data-step-key') || '', Number(btn.getAttribute('data-step-delta') || 0));
            });
        });
    }

    /**
     * Refresh disabled state on every [data-step-key] button.
     * @param {(key: string, delta: number) => boolean} isDisabled
     */
    function syncStepperDisabled(isDisabled) {
        document.querySelectorAll('[data-step-key]').forEach(el => {
            const btn = /** @type {HTMLButtonElement} */ (el);
            const key = btn.getAttribute('data-step-key') || '';
            const delta = Number(btn.getAttribute('data-step-delta') || 0);
            btn.disabled = isDisabled(key, delta);
        });
    }

    /**
     * Step through a discrete value list. Returns the next value, or null
     * at the boundary. When current is not in the list (e.g. set by a
     * voice command), snaps to the nearest list value in the direction.
     * @param {ReadonlyArray<number>} values @param {number} current @param {number} delta
     */
    function stepValue(values, current, delta) {
        const index = values.indexOf(current);
        if (index === -1) {
            if (delta > 0) {
                const higher = values.find(value => value > current);
                return higher === undefined ? null : higher;
            }
            const lower = [...values].reverse().find(value => value < current);
            return lower === undefined ? null : lower;
        }
        const nextIndex = Math.max(0, Math.min(values.length - 1, index + delta));
        return nextIndex === index ? null : values[nextIndex];
    }

    /**
     * Disabled-state companion to stepValue.
     * @param {ReadonlyArray<number>} values @param {number} current @param {number} delta
     */
    function stepDisabled(values, current, delta) {
        return stepValue(values, current, delta) === null;
    }

    /**
     * Bind a checkbox to apply(checked); initializes checked state.
     * @param {string} id @param {boolean} initial @param {(checked: boolean) => void} apply
     */
    function wireToggle(id, initial, apply) {
        const el = /** @type {HTMLInputElement | null} */ (getEl(id));
        if (!el) return;
        el.checked = initial;
        el.addEventListener('change', () => apply(el.checked));
    }

    /** @param {string} id @param {boolean} value */
    function syncToggle(id, value) {
        const el = /** @type {HTMLInputElement | null} */ (getEl(id));
        if (el) el.checked = value;
    }

    return {
        getEl,
        setValueText,
        formatSeconds,
        syncSingleSelect,
        wireSingleSelect,
        wireSteppers,
        syncStepperDisabled,
        stepValue,
        stepDisabled,
        wireToggle,
        syncToggle
    };
})();

window.PracticeControls = PracticeControls;
