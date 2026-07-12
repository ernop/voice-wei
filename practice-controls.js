// @ts-check
//-----------------------------------------------------------------------
// PRACTICE CONTROLS
// Shared wiring for the practice-page control language: single-select
// button groups ([data-*] + .selected), discrete +/- steppers
// ([data-step-key]/[data-step-delta]), and checkbox toggles.
//-----------------------------------------------------------------------

const PracticeControls = (function () {
    'use strict';

    // Canonical preset values for the shared step pickers. Every root,
    // note-length, and gap stepper on every page uses these same lists
    // (see docs/parameters.md "Shared step presets").
    const ROOT_PITCH_MIN_MIDI = 36; // C2
    const ROOT_PITCH_MAX_MIDI = 83; // B5
    // One shared ladder for every seconds-valued stepper (note length,
    // gap, section pause, guide interval): pure tenths 0..2s, quarters
    // to 4s, halves to 5s, wholes to 10s. Every time control walks the
    // same numbers, so 0.1s means the same step everywhere.
    const TIME_VALUES_MS = Object.freeze([
        0, 100, 200, 300, 400, 500, 600, 700, 800, 900,
        1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900,
        2000, 2250, 2500, 2750, 3000, 3250, 3500, 3750, 4000, 4500,
        5000, 6000, 7000, 8000, 9000, 10000
    ]);
    // A zero-length note is silence, so note length starts at 0.1s.
    const NOTE_LENGTH_VALUES = Object.freeze(TIME_VALUES_MS.filter(ms => ms >= 100));
    // Negative gap values are overlap ratios of the note length
    // (-0.5 starts the next note halfway through the current one).
    const GAP_VALUES = Object.freeze([-0.5, -0.1, -0.05, ...TIME_VALUES_MS]);

    function getEl(id) { return document.getElementById(id); }

    /**
     * Resolve a gap preset to milliseconds for the given note length.
     * @param {number} gapValue @param {number} noteLengthMs
     */
    function effectiveGapMs(gapValue, noteLengthMs) {
        if (gapValue < 0 && gapValue > -1) return Math.round(noteLengthMs * gapValue);
        return gapValue;
    }

    /** Overlap ratios display as percentages, plain gaps as seconds.
     * @param {number} gapValue */
    function formatGapLabel(gapValue) {
        if (gapValue < 0) return `${Math.round(gapValue * 100)}%`;
        return formatSeconds(gapValue);
    }

    /** @param {number} midi */
    function clampRootMidi(midi) {
        return Math.max(ROOT_PITCH_MIN_MIDI, Math.min(ROOT_PITCH_MAX_MIDI, midi));
    }

    /** Step a root pitch by semitones inside the shared range.
     * @param {number} midi @param {number} delta */
    function stepRootMidi(midi, delta) {
        return clampRootMidi(midi + delta);
    }

    /** Disabled-state companion to stepRootMidi.
     * @param {number | null} midi @param {number} delta */
    function rootStepDisabled(midi, delta) {
        return midi === null
            || (delta < 0 ? midi <= ROOT_PITCH_MIN_MIDI : midi >= ROOT_PITCH_MAX_MIDI);
    }

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
     * Wire a multi-select chip group. Scoped by CSS selector because pages
     * may reuse the data attribute elsewhere (e.g. ears answer buttons).
     * @param {string} selector @param {string} attr @param {(value: string) => void} toggle
     */
    function wireMultiSelect(selector, attr, toggle) {
        document.querySelectorAll(selector).forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.addEventListener('click', () => toggle(btn.getAttribute(attr) || ''));
        });
    }

    /**
     * Reflect multi-select membership via .selected.
     * @param {string} selector @param {string} attr @param {(value: string) => boolean} isSelected
     */
    function syncMultiSelect(selector, attr, isSelected) {
        document.querySelectorAll(selector).forEach(el => {
            el.classList.toggle('selected', isSelected(el.getAttribute(attr) || ''));
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
        ROOT_PITCH_MIN_MIDI,
        ROOT_PITCH_MAX_MIDI,
        TIME_VALUES_MS,
        NOTE_LENGTH_VALUES,
        GAP_VALUES,
        getEl,
        setValueText,
        formatSeconds,
        formatGapLabel,
        effectiveGapMs,
        clampRootMidi,
        stepRootMidi,
        rootStepDisabled,
        syncSingleSelect,
        wireSingleSelect,
        wireMultiSelect,
        syncMultiSelect,
        wireSteppers,
        syncStepperDisabled,
        stepValue,
        stepDisabled,
        wireToggle,
        syncToggle
    };
})();

window.PracticeControls = PracticeControls;
