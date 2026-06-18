// @ts-check
//-----------------------------------------------------------------------
// SETTINGS STORE
// Versioned localStorage persistence for all user-facing state.
//
// Envelope: { v: "<app version>", data: { ... } }
//
// Load policy:
// - Missing key: defaults only.
// - Legacy flat JSON (no envelope): merge, then re-save in envelope form.
// - Older version envelope: best-effort typed merge; log if merge is partial.
// - Same version envelope with parse/structure failure: serious visible error
//   (same-version corruption implies a bug, not stale data).
//
// Every page persists settings through load/save/loadJson/saveJson here.
// Do not call localStorage directly for user state.
//-----------------------------------------------------------------------

const SettingsStore = (function () {
    'use strict';

    /** @type {HTMLElement | null} */
    let seriousBanner = null;

    function appVersion() {
        return (typeof AppVersion !== 'undefined' && AppVersion.current) ? AppVersion.current : '0';
    }

    /** @param {string} message */
    function logPersistence(message) {
        console.warn(`[voice-wei persistence] ${message}`);
    }

    /** @param {string} storageKey @param {string} detail */
    function showSeriousError(storageKey, detail) {
        logPersistence(`SERIOUS: ${storageKey} — ${detail}`);
        if (!seriousBanner) {
            seriousBanner = document.createElement('div');
            seriousBanner.className = 'persistence-serious-error';
            seriousBanner.setAttribute('role', 'alert');
            document.body.prepend(seriousBanner);
        }
        seriousBanner.textContent =
            `Saved data for this page could not be loaded (version ${appVersion()}). `
            + `Your settings may reset. This likely needs a developer fix. (${storageKey})`;
        seriousBanner.hidden = false;
    }

    /**
     * @param {unknown} raw
     * @returns {{ version: string | null, data: Record<string, any> | any[] | null, legacy: boolean }}
     */
    function parseEnvelope(raw) {
        if (raw === null || raw === undefined) {
            return { version: null, data: null, legacy: false };
        }
        let parsed;
        try {
            parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (err) {
            throw err;
        }
        if (Array.isArray(parsed)) {
            return { version: null, data: parsed, legacy: true };
        }
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('stored value is not an object or array');
        }
        if ('v' in parsed && 'data' in parsed) {
            return { version: String(parsed.v), data: parsed.data, legacy: false };
        }
        return { version: null, data: /** @type {Record<string, any>} */ (parsed), legacy: true };
    }

    /** @param {string} storageKey */
    function readRaw(storageKey) {
        const raw = localStorage.getItem(storageKey);
        if (raw !== null) return raw;
        const legacyKey = LegacyStorageKeys[storageKey];
        if (!legacyKey) return null;
        return localStorage.getItem(legacyKey);
    }

    /**
     * @param {string} storageKey
     * @param {Record<string, any>} state
     * @param {string[]} keys
     */
    function mergeIntoState(storageKey, state, keys, data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        let merged = 0;
        keys.forEach(key => {
            if (!(key in data)) return;
            if (typeof data[key] === typeof state[key]) {
                state[key] = data[key];
                merged++;
            } else {
                logPersistence(`${storageKey}: skipped key "${key}" (type mismatch)`);
            }
        });
        return merged;
    }

    /**
     * @param {string} storageKey
     * @param {Record<string, any>} state
     * @param {string[]} keys
     */
    function load(storageKey, state, keys) {
        const raw = readRaw(storageKey);
        if (raw === null) return;

        try {
            const envelope = parseEnvelope(raw);
            if (envelope.data === null) return;

            if (envelope.legacy || envelope.version === null) {
                mergeIntoState(storageKey, state, keys, envelope.data);
                save(storageKey, state, keys);
                return;
            }

            if (envelope.version !== appVersion()) {
                mergeIntoState(storageKey, state, keys, envelope.data);
                if (Array.isArray(keys)) {
                    const missing = keys.filter(key => !(key in envelope.data));
                    if (missing.length) {
                        logPersistence(`${storageKey}: older version ${envelope.version}; missing keys: ${missing.join(', ')}`);
                    }
                }
                return;
            }

            mergeIntoState(storageKey, state, keys, envelope.data);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logPersistence(`load failed for ${storageKey}: ${message}`);
            try {
                const envelope = parseEnvelope(raw);
                if (!envelope.legacy && envelope.version === appVersion()) {
                    showSeriousError(storageKey, message);
                }
            } catch (_ignored) {
                showSeriousError(storageKey, message);
            }
        }
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
        localStorage.setItem(storageKey, JSON.stringify({ v: appVersion(), data: snapshot }));
    }

    /**
     * @template T
     * @param {string} storageKey
     * @param {T} defaultValue
     * @param {(value: unknown) => value is T} [validate]
     * @returns {T}
     */
    function loadJson(storageKey, defaultValue, validate) {
        const raw = readRaw(storageKey);
        if (raw === null) return defaultValue;

        try {
            const envelope = parseEnvelope(raw);
            const data = envelope.data;
            if (validate ? validate(data) : data !== null && data !== undefined) {
                if (envelope.legacy || envelope.version === null) {
                    saveJson(storageKey, data);
                    return /** @type {T} */ (data);
                }
                if (envelope.version !== appVersion()) {
                    logPersistence(`${storageKey}: loaded older version ${envelope.version}`);
                    return /** @type {T} */ (data);
                }
                return /** @type {T} */ (data);
            }
            logPersistence(`${storageKey}: validation failed`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logPersistence(`loadJson failed for ${storageKey}: ${message}`);
            try {
                const envelope = parseEnvelope(raw);
                if (!envelope.legacy && envelope.version === appVersion()) {
                    showSeriousError(storageKey, message);
                }
            } catch (_ignored) {
                showSeriousError(storageKey, message);
            }
        }
        return defaultValue;
    }

    /** @param {string} storageKey @param {unknown} data */
    function saveJson(storageKey, data) {
        localStorage.setItem(storageKey, JSON.stringify({ v: appVersion(), data }));
    }

    /**
     * Read the data payload for tests and diagnostics.
     * @param {string} storageKey
     */
    function peekData(storageKey) {
        const raw = readRaw(storageKey);
        if (raw === null) return null;
        try {
            const envelope = parseEnvelope(raw);
            return envelope.data;
        } catch (_err) {
            return null;
        }
    }

    return { load, save, loadJson, saveJson, peekData, logPersistence };
})();

window.SettingsStore = SettingsStore;
