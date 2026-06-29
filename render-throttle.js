// @ts-check
//-----------------------------------------------------------------------
// RENDER THROTTLE
// One owner for realtime render throttling. Two primitives the pitch/trace
// surfaces and the player progress loop all share instead of hand-rolling
// their own bookkeeping:
//
//   RateGate(ms)  - "run at most once per ms". gate.ready() returns true at
//                   most that often; used to cap chart redraws and readout
//                   updates to a sustainable rate.
//   ValueDiff     - "write the DOM only when the value changed". Keyed by a
//                   caller-chosen string so several fields (text + style)
//                   can share one differ. Avoids redundant textContent/style
//                   writes every animation frame.
//-----------------------------------------------------------------------

class RateGate {
    /** @param {number} intervalMs */
    constructor(intervalMs) {
        this.intervalMs = intervalMs;
        this.last = -Infinity;
    }

    /**
     * @param {number} [now] Defaults to performance.now().
     * @returns {boolean} true (and records the tick) when intervalMs has passed.
     */
    ready(now) {
        const t = now === undefined ? performance.now() : now;
        if (t - this.last < this.intervalMs) return false;
        this.last = t;
        return true;
    }

    /**
     * Record a tick without gating (for forced runs that should still reset
     * the interval so the next throttled run waits the full interval).
     * @param {number} [now]
     */
    stamp(now) {
        this.last = now === undefined ? performance.now() : now;
    }

    reset() {
        this.last = -Infinity;
    }
}

class ValueDiff {
    constructor() {
        /** @type {Map<string, string>} */
        this.cache = new Map();
    }

    /**
     * @param {string} key @param {string} value
     * @returns {boolean} true if the value changed since last seen (records it).
     */
    changed(key, value) {
        if (this.cache.get(key) === value) return false;
        this.cache.set(key, value);
        return true;
    }

    /**
     * Set el.textContent only when changed.
     * @param {string} key @param {Element | null} el @param {string} value
     * @returns {boolean} written
     */
    text(key, el, value) {
        if (el && this.changed(key, value)) {
            el.textContent = value;
            return true;
        }
        return false;
    }

    /**
     * Set a CSS property only when changed.
     * @param {string} key @param {HTMLElement | null} el
     * @param {string} prop CSS property name @param {string} value
     * @returns {boolean} written
     */
    style(key, el, prop, value) {
        if (el && this.changed(key, value)) {
            el.style.setProperty(prop, value);
            return true;
        }
        return false;
    }

    /** Drop a cached key so its next write always applies. @param {string} key */
    forget(key) {
        this.cache.delete(key);
    }

    reset() {
        this.cache.clear();
    }
}

window.RateGate = RateGate;
window.ValueDiff = ValueDiff;
