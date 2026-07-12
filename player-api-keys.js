// @ts-check
//-----------------------------------------------------------------------
// PLAYER API KEYS
// Thin wrapper around ApiKeysStore for the music player page.
// VoiceMusicController.loadConfig and API key UI use this module;
// tests may still seed legacy claudeApiKey — ApiKeysStore migrates on read.
//-----------------------------------------------------------------------

/** @typedef {'claude' | 'openai' | 'youtube'} ApiProvider */

const PlayerApiKeys = (function () {
    'use strict';

    /** @param {ApiProvider} provider */
    function get(provider) {
        return ApiKeysStore.get(provider);
    }

    /** @param {ApiProvider} provider @param {string} apiKey */
    function set(provider, apiKey) {
        ApiKeysStore.set(provider, apiKey);
    }

    /** @param {ApiProvider} provider */
    function remove(provider) {
        ApiKeysStore.remove(provider);
    }

    /** @param {ApiProvider} provider */
    function has(provider) {
        return ApiKeysStore.has(provider);
    }

    /** @returns {AppConfig} */
    function loadConfig() {
        /** @type {AppConfig} */
        const config = {};
        const claudeKey = get('claude');
        const openaiKey = get('openai');
        const youtubeKey = get('youtube');
        if (claudeKey.length > 10) {
            config.claudeApiKey = claudeKey;
        }
        if (openaiKey.length > 10) {
            config.openaiApiKey = openaiKey;
        }
        if (youtubeKey.length > 10) {
            config.youtubeApiKey = youtubeKey;
        }
        return config;
    }

    /** @param {ApiProvider} provider */
    function preview(provider) {
        const key = get(provider);
        if (!key) return '';
        return key.substring(0, 10) + '...' + key.substring(key.length - 4);
    }

    return { get, set, remove, has, loadConfig, preview };
})();

window.PlayerApiKeys = PlayerApiKeys;
