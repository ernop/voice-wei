// @ts-check
//-----------------------------------------------------------------------
// WORD COMBINER - browser mirror. NEW words only.
// Exact port of the core of coolness-combine.py: clean two word sets,
// optionally expand each with related words (keyless Datamuse API:
// embeddings + thesaurus + co-occurrence), blend every cross pair three
// ways, drop anything that already exists in English (the
// coolness-wordlist.json filter) or in the input sets, and score through
// the coolness engine. tests/test-coolness.js keeps the cross product in
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

    /** (start, end) of the last vowel-letter run, or null. */
    function lastVowelRun(letters) {
        /** @type {[number, number] | null} */
        let run = null;
        let start = -1;
        for (let i = 0; i < letters.length; i++) {
            if (VOWELS.has(letters[i])) {
                if (start === -1) start = i;
            } else if (start !== -1) {
                run = [start, i];
                start = -1;
            }
        }
        if (start !== -1) run = [start, letters.length];
        return run;
    }

    /**
     * All blend strategies for a pair, in the same deterministic order as
     * coolness-combine.py blend_parts(): onset-rime (zen+kernel->zernel),
     * head-rime (vibe+script->vipt), head-tail (drift+pixel->drixel).
     * @param {string} a @param {string} b
     * @returns {Array<[string, string]>}
     */
    function blendParts(a, b) {
        const runA = firstVowelRun(a);
        const runB = firstVowelRun(b);
        if (runA === null || runB === null) return [];
        const onset = runA[0] > 0 ? a.slice(0, runA[0]) : a.slice(0, runA[1]);
        const head = a.slice(0, runA[1]);
        /** @type {Array<[string, string]>} */
        const parts = [
            ['onset-rime', onset + b.slice(runB[0])],
            ['head-rime', head + b.slice(runB[1])]
        ];
        const tailRun = lastVowelRun(b);
        if (tailRun !== null) {
            let k = tailRun[0];
            while (k > 0 && !VOWELS.has(b[k - 1])) k -= 1;
            // k === 0 would just append the whole of B - not a blend.
            if (k > 0) parts.push(['head-tail', head + b.slice(k)]);
        }
        return parts;
    }

    /**
     * Exhaustive cross product of NEW words, same iteration, filtering,
     * and sort order as the Python combiner: every A x B pair blended
     * three ways; anything that already exists (real-English wordlist or
     * either input set) is dropped before rating.
     * @param {string[]} wordsA
     * @param {string[]} wordsB
     * @param {Set<string>} realWords
     * @param {(word: string) => { total: number }} scoreWord
     */
    function crossProduct(wordsA, wordsB, realWords, scoreWord) {
        /** @type {Array<{ text: string, form: string, strategy: string, source: string, score: number }>} */
        const results = [];
        const seen = new Set();
        const inputs = new Set([...wordsA, ...wordsB]);
        let droppedReal = 0;
        for (const wordA of wordsA) {
            for (const wordB of wordsB) {
                for (const [strategy, text] of blendParts(wordA, wordB)) {
                    if (seen.has(text)) continue;
                    // Length floor of 4 mirrors the Python combiner: shorter
                    // blends are fragments or rare real words the list misses.
                    if (text.length < 4 || inputs.has(text) || realWords.has(text)) {
                        droppedReal += realWords.has(text) ? 1 : 0;
                        continue;
                    }
                    seen.add(text);
                    results.push({
                        text,
                        form: 'blend',
                        strategy,
                        source: `${wordA} + ${wordB}`,
                        score: scoreWord(text).total
                    });
                }
            }
        }
        results.sort((a, b) => (b.score - a.score)
            || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
        return { results, droppedReal };
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
        blendParts,
        crossProduct,
        expandSet,
        logBatch,
        allBatches,
        batchCount,
        exportJsonl
    };
})();

window.CoolnessCombine = CoolnessCombine;
