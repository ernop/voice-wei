// @ts-check
//-----------------------------------------------------------------------
// SETTINGS STORE
// Per-page settings persistence. Each page persists the listed keys of
// its state object under one namespaced localStorage key, so reloading
// a tab restores the previous setup.
//-----------------------------------------------------------------------

const SettingsStore = (function () {
    'use strict';

    /**
     * Merge persisted values into state. Only the listed keys are
     * restored, and only when the stored type matches the default type,
     * so stale entries from older versions cannot corrupt state.
     * @param {string} storageKey
     * @param {Record<string, any>} state
     * @param {string[]} keys
     */
    function load(storageKey, state, keys) {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            return;
        }
        if (!parsed || typeof parsed !== 'object') return;
        keys.forEach(key => {
            if (key in parsed && typeof parsed[key] === typeof state[key]) {
                state[key] = parsed[key];
            }
        });
    }

    /**
     * @param {string} storageKey
     * @param {Record<string, any>} state
     * @param {string[]} keys
     */
    function save(storageKey, state, keys) {
        /** @type {Record<string, any>} */
        const snapshot = {};
        keys.forEach(key => { snapshot[key] = state[key]; });
        localStorage.setItem(storageKey, JSON.stringify(snapshot));
    }

    return { load, save };
})();

window.SettingsStore = SettingsStore;
