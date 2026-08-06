// @ts-check
//-----------------------------------------------------------------------
// WORD COMBINER - browser mirror
// Exact port of the core of coolness-combine.py: clean two word sets,
// optionally expand each with related words (keyless Datamuse API:
// embeddings + thesaurus + co-occurrence), build the exhaustive cross
// product (spaced phrases and fused blends), and score through the
// coolness engine. tests/test-coolness.js keeps the cross product in
// lockstep with the Python combiner.
//
// This module also OWNS the browser session log: the IndexedDB database
// `voice-wei-coolness` (store `batches`, autoincrement). Batches are only
// ever added, never rewritten - the browser counterpart of the repo's
// append-only coolness-log.jsonl - and can be exported as .jsonl.
//-----------------------------------------------------------------------

const CoolnessCombine = (function () {
    'use strict';

    const DATAMUSE_URL = 'https://api.datamuse.com/words';
    const DB_NAME = 'voice-wei-coolness';
    const DB_VERSION = 1;
    const STORE = 'batches';
    const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

    // ---- set handling (ports of coolness-combine.py) --------------------

    /** @param {string} raw @returns {string[]} */
    function cleanWordList(raw) {
        /** @type {string[]} */
        const words = [];
        for (const part of String(raw).replace(/,/g, ' ').split(/\s+/)) {
            const cleaned = part.toLowerCase().replace(/[^a-z]/g, '');
            if (cleaned && !words.includes(cleaned)) words.push(cleaned);
        }
        return words;
    }

    /** (start, end) of the first vowel-letter run, or null. */
    function firstVowelRun(letters) {
        let start = -1;
        for (let i = 0; i < letters.length; i++) {
            if (VOWELS.has(letters[i])) {
                if (start === -1) start = i;
            } else if (start !== -1) {
                return [start, i];
            }
        }
        return start === -1 ? null : [start, letters.length];
    }

    /**
     * Classic blend: A's onset + B from its first vowel run (br+unch).
     * Vowel-initial A contributes through the end of its first vowel run.
     * @param {string} a @param {string} b @returns {string | null}
     */
    function blendWords(a, b) {
        const runA = firstVowelRun(a);
        const runB = firstVowelRun(b);
        if (runA === null || runB === null) return null;
        const prefix = runA[0] > 0 ? a.slice(0, runA[0]) : a.slice(0, runA[1]);
        const blended = prefix + b.slice(runB[0]);
        if (blended.length < 3 || blended === a || blended === b) return null;
        return blended;
    }

    /**
     * Exhaustive cross product, same iteration and sort order as the
     * Python combiner: every A x B pair as phrase and/or blend.
     * @param {string[]} wordsA
     * @param {string[]} wordsB
     * @param {'phrase' | 'blend' | 'both'} mode
     * @param {(word: string) => { total: number }} scoreWord
     * @param {(value: number, places: number) => number} roundPlaces
     */
    function crossProduct(wordsA, wordsB, mode, scoreWord, roundPlaces) {
        /** @type {Array<{ text: string, form: string, source: string, score: number }>} */
        const results = [];
        const seen = new Set();
        const push = (row) => {
            if (row && !seen.has(row.text)) {
                seen.add(row.text);
                results.push(row);
            }
        };
        for (const wordA of wordsA) {
            for (const wordB of wordsB) {
                if (mode === 'phrase' || mode === 'both') {
                    const scoreA = scoreWord(wordA).total;
                    const scoreB = scoreWord(wordB).total;
                    push({
                        text: `${wordA} ${wordB}`,
                        form: 'phrase',
                        source: `${wordA} + ${wordB}`,
                        score: roundPlaces((scoreA + scoreB) / 2, 1)
                    });
                }
                if (mode === 'blend' || mode === 'both') {
                    const blended = blendWords(wordA, wordB);
                    if (blended !== null) {
                        push({
                            text: blended,
                            form: 'blend',
                            source: `${wordA} + ${wordB}`,
                            score: scoreWord(blended).total
                        });
                    }
                }
            }
        }
        results.sort((a, b) => (b.score - a.score)
            || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
        return results;
    }

    // ---- expansion (keyless Datamuse) ------------------------------------

    /** @param {string} word @param {number} limit @returns {Promise<string[]>} */
    async function datamuseRelated(word, limit) {
        const url = `${DATAMUSE_URL}?ml=${encodeURIComponent(word)}&max=${limit}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Datamuse expansion failed for "${word}": HTTP ${response.status}`);
        }
        /** @type {Array<{ word?: string }>} */
        const rows = await response.json();
        return rows
            .map(row => row.word || '')
            .filter(w => w.length >= 3 && /^[a-z]+$/.test(w));
    }

    /**
     * Add up to n related words, merged round-robin across the seeds so
     * every seed contributes its strongest neighbors first (same merge
     * as the Python combiner).
     * @param {string[]} words @param {number} n @returns {Promise<string[]>}
     */
    async function expandSet(words, n) {
        if (n <= 0) return [];
        const perSeed = await Promise.all(
            words.map(word => datamuseRelated(word, Math.max(10, n))));
        /** @type {string[]} */
        const added = [];
        const have = new Set(words);
        let rank = 0;
        while (added.length < n && perSeed.some(seed => rank < seed.length)) {
            for (const seed of perSeed) {
                if (rank < seed.length) {
                    const candidate = seed[rank];
                    if (!have.has(candidate)) {
                        have.add(candidate);
                        added.push(candidate);
                        if (added.length >= n) break;
                    }
                }
            }
            rank += 1;
        }
        return added;
    }

    // ---- append-only browser log (IndexedDB owner) --------------------------

    /** @returns {Promise<IDBDatabase>} */
    function openDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE)) {
                    request.result.createObjectStore(STORE, { autoIncrement: true });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Append one batch entry. Add-only: nothing in this module deletes or
     * rewrites entries.
     * @param {Record<string, any>} entry
     */
    async function logBatch(entry) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).add(entry);
            tx.oncomplete = () => { db.close(); resolve(undefined); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    }

    /** @returns {Promise<Record<string, any>[]>} */
    async function allBatches() {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const request = db.transaction(STORE, 'readonly')
                .objectStore(STORE).getAll();
            request.onsuccess = () => { db.close(); resolve(request.result); };
            request.onerror = () => { db.close(); reject(request.error); };
        });
    }

    /** @returns {Promise<number>} */
    async function batchCount() {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const request = db.transaction(STORE, 'readonly')
                .objectStore(STORE).count();
            request.onsuccess = () => { db.close(); resolve(request.result); };
            request.onerror = () => { db.close(); reject(request.error); };
        });
    }

    /** The device log as .jsonl text, one batch per line, append order. */
    async function exportJsonl() {
        const batches = await allBatches();
        return batches.map(batch => JSON.stringify(batch)).join('\n') + '\n';
    }

    return {
        cleanWordList,
        blendWords,
        crossProduct,
        expandSet,
        logBatch,
        allBatches,
        batchCount,
        exportJsonl
    };
})();

window.CoolnessCombine = CoolnessCombine;
