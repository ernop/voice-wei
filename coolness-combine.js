// @ts-check
//-----------------------------------------------------------------------
// WORD COMBINER - browser mirror. NEW words only, compound-first.
// Exact port of the core of coolness-combine.py: clean two word sets,
// grow them with inflected forms (run -> running) and optionally with
// related words (keyless Datamuse API: embeddings + thesaurus +
// co-occurrence), join every cross pair compound-first (straight joins
// plus lightly trimmed ones), drop anything that already exists in
// English (the coolness-wordlist.json filter) or in the input sets, and
// score through the coolness engine. tests/test-coolness.js keeps the
// cross product in lockstep with the Python combiner.
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
     * All combination strategies for a pair, compound-first, in the same
     * deterministic order as coolness-combine.py combine_parts():
     * compound (glow+code -> glowcode), seam (vibe+code -> vibcode,
     * stack+kernel -> stackernel), clip (drift+code -> dricode).
     * @param {string} a @param {string} b
     * @returns {Array<[string, string]>}
     */
    function combineParts(a, b) {
        /** @type {Array<[string, string]>} */
        const parts = [['compound', a + b]];
        if (a[a.length - 1] === b[0]) {
            parts.push(['seam', a + b.slice(1)]);
        } else if (a[a.length - 1] === 'e') {
            parts.push(['seam', a.slice(0, -1) + b]);
        }
        const runA = firstVowelRun(a);
        if (runA !== null && runA[1] < a.length) {
            parts.push(['clip', a.slice(0, runA[1]) + b]);
        }
        return parts;
    }

    /**
     * Rough English suffixing, same rules as coolness-combine.py inflect():
     * code+ing -> coding (silent-e drop), run+ing -> running (short-word
     * final-consonant doubling), glow+ing -> glowing.
     * @param {string} word @param {string} suffix
     */
    function inflect(word, suffix) {
        if (word.length < 2) return word + suffix;
        const last = word[word.length - 1];
        const prev = word[word.length - 2];
        let base = word;
        if (last === 'e' && !VOWELS.has(prev)) {
            base = word.slice(0, -1);
        } else if (word.length <= 4
            && !VOWELS.has(last) && !'wxy'.includes(last)
            && VOWELS.has(prev)
            && !VOWELS.has(word[word.length - 3])) {
            base = word + last;
        }
        return base + suffix;
    }

    /**
     * Inflected forms of a seed list under the config suffixes, deduped
     * against the seeds (mirrors Session._make_set in the Python combiner).
     * @param {string[]} seeds @param {string[]} suffixes
     * @returns {string[]}
     */
    function inflectSet(seeds, suffixes) {
        /** @type {string[]} */
        const inflected = [];
        for (const word of seeds) {
            for (const suffix of suffixes) {
                const form = inflect(word, suffix);
                if (!seeds.includes(form) && !inflected.includes(form)) {
                    inflected.push(form);
                }
            }
        }
        return inflected;
    }

    /**
     * Exhaustive cross product of NEW words, same iteration, filtering,
     * and sort order as the Python combiner: every A x B pair joined
     * compound-first; anything that already exists (real-English wordlist
     * or either input set) is dropped before rating.
     * @param {string[]} wordsA
     * @param {string[]} wordsB
     * @param {Set<string>} realWords
     * @param {(word: string) => { total: number }} scoreWord
     */
    function crossProduct(wordsA, wordsB, realWords, scoreWord) {
        /** @type {Array<{ text: string, strategy: string, source: string, score: number }>} */
        const results = [];
        const seen = new Set();
        const inputs = new Set([...wordsA, ...wordsB]);
        let droppedReal = 0;
        for (const wordA of wordsA) {
            for (const wordB of wordsB) {
                for (const [strategy, text] of combineParts(wordA, wordB)) {
                    if (seen.has(text)) continue;
                    // Length floor of 4 mirrors the Python combiner: shorter
                    // joins are fragments or rare real words the list misses.
                    if (text.length < 4 || inputs.has(text) || realWords.has(text)) {
                        droppedReal += realWords.has(text) ? 1 : 0;
                        continue;
                    }
                    seen.add(text);
                    results.push({
                        text,
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
        combineParts,
        inflect,
        inflectSet,
        crossProduct,
        expandSet,
        logBatch,
        allBatches,
        batchCount,
        exportJsonl
    };
})();

window.CoolnessCombine = CoolnessCombine;
