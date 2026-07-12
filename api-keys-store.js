// @ts-check
//-----------------------------------------------------------------------
// API KEYS STORE
// Single read/write/remove path for provider API keys in localStorage.
//-----------------------------------------------------------------------

const ApiKeysStore = (function () {
    'use strict';

    /** @typedef {'claude' | 'openai' | 'youtube'} ApiProvider */

    const PROVIDER_STORAGE_KEYS = Object.freeze({
        claude: StorageKeys.API_CLAUDE,
        openai: StorageKeys.API_OPENAI,
        youtube: StorageKeys.API_YOUTUBE
    });

    /** @param {ApiProvider} provider */
    function storageKey(provider) {
        return PROVIDER_STORAGE_KEYS[provider];
    }

    /** @param {ApiProvider} provider */
    function get(provider) {
        const legacy = LegacyStorageKeys[storageKey(provider)];
        const raw = localStorage.getItem(storageKey(provider))
            ?? (legacy ? localStorage.getItem(legacy) : null);
        if (!raw) return '';
        // Keys are stored as plain strings (not version envelopes).
        return raw;
    }

    /** @param {ApiProvider} provider @param {string} apiKey */
    function set(provider, apiKey) {
        const key = storageKey(provider);
        localStorage.setItem(key, apiKey);
        const legacy = LegacyStorageKeys[key];
        if (legacy) localStorage.removeItem(legacy);
    }

    /** @param {ApiProvider} provider */
    function remove(provider) {
        const key = storageKey(provider);
        localStorage.removeItem(key);
        const legacy = LegacyStorageKeys[key];
        if (legacy) localStorage.removeItem(legacy);
    }

    /** @param {ApiProvider} provider */
    function has(provider) {
        return get(provider).length > 0;
    }

    return { get, set, remove, has };
})();

window.ApiKeysStore = ApiKeysStore;
