// @ts-check
//-----------------------------------------------------------------------
// PROGRESS STORE
// Persistent record of scored practice takes, shared by every tool that
// judges singing (the pitch test panel, the pitch meter). One localStorage
// list; each entry: when, which tool, what was practiced, how it went.
//-----------------------------------------------------------------------

const ProgressStore = (function () {
    'use strict';

    const STORAGE_KEY = 'practice-progress';
    const MAX_ENTRIES = 1000;

    /**
     * @typedef {{ at: string, tool: string, context: string, total: number,
     *             hit: number, avgCents: number | null,
     *             notes?: ProgressNoteResult[] }} ProgressEntry
     * Entries recorded before per-note tracking have no `notes` field;
     * every reader must treat that explicitly as "no note data".
     */

    /** @returns {ProgressEntry[]} */
    function load() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            return [];
        }
        return Array.isArray(parsed) ? parsed : [];
    }

    /**
     * @param {{ tool: string, context: string, total: number, hit: number,
     *           avgCents?: number | null, notes?: ProgressNoteResult[] }} entry
     */
    function record(entry) {
        const entries = load();
        entries.push({
            at: new Date().toISOString(),
            tool: entry.tool,
            context: entry.context,
            total: entry.total,
            hit: entry.hit,
            avgCents: entry.avgCents ?? null,
            notes: entry.notes ?? []
        });
        while (entries.length > MAX_ENTRIES) entries.shift();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }

    /**
     * @param {string} tool
     * @param {number} [limit]
     * @returns {ProgressEntry[]} newest first
     */
    function list(tool, limit = 50) {
        return load()
            .filter(entry => entry.tool === tool)
            .slice(-limit)
            .reverse();
    }

    /** @param {string} iso */
    function localDay(iso) {
        const d = new Date(iso);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /**
     * Per-local-day aggregates for a tool, newest day first.
     * @param {string} tool
     * @param {number} [days] - max number of days with data to return
     * @returns {Array<{ day: string, takes: number, hitRate: number, avgCents: number | null }>}
     */
    function dailySummary(tool, days = 7) {
        /** @type {Map<string, { takes: number, hit: number, total: number, centsSum: number, centsCount: number }>} */
        const byDay = new Map();
        for (const entry of load()) {
            if (entry.tool !== tool) continue;
            const day = localDay(entry.at);
            const agg = byDay.get(day) || { takes: 0, hit: 0, total: 0, centsSum: 0, centsCount: 0 };
            agg.takes++;
            agg.hit += entry.hit;
            agg.total += entry.total;
            if (entry.avgCents !== null) {
                agg.centsSum += entry.avgCents;
                agg.centsCount++;
            }
            byDay.set(day, agg);
        }
        return Array.from(byDay.entries())
            .sort((a, b) => (a[0] < b[0] ? 1 : -1))
            .slice(0, days)
            .map(([day, agg]) => ({
                day,
                takes: agg.takes,
                hitRate: agg.total ? agg.hit / agg.total : 0,
                avgCents: agg.centsCount ? agg.centsSum / agg.centsCount : null
            }));
    }

    /**
     * One-line trend for display: "Today 62% (5 takes) - Jun 9 48% (3)".
     * Empty string when there is no data yet.
     * @param {string} tool
     * @param {number} [days]
     */
    function trendLine(tool, days = 4) {
        const today = localDay(new Date().toISOString());
        const parts = dailySummary(tool, days).map(summary => {
            const label = summary.day === today
                ? 'Today'
                : new Date(summary.day + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const cents = summary.avgCents !== null ? `, ${summary.avgCents.toFixed(0)}c` : '';
            return `${label} ${(summary.hitRate * 100).toFixed(0)}%${cents} (${summary.takes} take${summary.takes === 1 ? '' : 's'})`;
        });
        return parts.length ? `Progress: ${parts.join(' \u00b7 ')}` : '';
    }

    /**
     * Aggregate per-note outcomes by label over recent takes: how often
     * each target was missed and which way the singing leaned. This is
     * the degree-level view the training goal needs ("control in the
     * lower range - overshoot around 6-7-8").
     * @param {string} tool
     * @param {number} [takes] - how many recent takes to aggregate
     * @returns {Array<{ label: string, attempts: number, missRate: number,
     *                   biasCents: number | null }>} worst first
     */
    function weakSpots(tool, takes = 20) {
        /** @type {Map<string, { attempts: number, missed: number, biasSum: number, biasCount: number }>} */
        const byLabel = new Map();
        for (const entry of list(tool, takes)) {
            for (const note of entry.notes || []) {
                const agg = byLabel.get(note.label)
                    || { attempts: 0, missed: 0, biasSum: 0, biasCount: 0 };
                agg.attempts++;
                if (note.result === 'missed') agg.missed++;
                if (note.biasCents !== null && note.biasCents !== undefined) {
                    agg.biasSum += note.biasCents;
                    agg.biasCount++;
                }
                byLabel.set(note.label, agg);
            }
        }
        return Array.from(byLabel.entries())
            .map(([label, agg]) => ({
                label,
                attempts: agg.attempts,
                missRate: agg.missed / agg.attempts,
                biasCents: agg.biasCount ? agg.biasSum / agg.biasCount : null
            }))
            .sort((a, b) => {
                const badness = (/** @type {{ missRate: number, biasCents: number | null }} */ spot) =>
                    spot.missRate + Math.abs(spot.biasCents || 0) / 100;
                return badness(b) - badness(a);
            });
    }

    /**
     * One-line weak-spot readout: worst labels with miss rate and lean.
     * Only labels with enough attempts and a real problem are shown.
     * @param {string} tool
     * @param {number} [maxSpots]
     */
    function weakSpotLine(tool, maxSpots = 3) {
        const spots = weakSpots(tool)
            .filter(spot => spot.attempts >= 3
                && (spot.missRate >= 0.3 || Math.abs(spot.biasCents || 0) >= 15))
            .slice(0, maxSpots);
        if (!spots.length) return '';
        const parts = spots.map(spot => {
            const pieces = [];
            if (spot.missRate >= 0.3) pieces.push(`missed ${(spot.missRate * 100).toFixed(0)}%`);
            if (spot.biasCents !== null && Math.abs(spot.biasCents) >= 15) {
                pieces.push(`${Math.abs(spot.biasCents).toFixed(0)}c ${spot.biasCents > 0 ? 'sharp' : 'flat'}`);
            }
            return `${spot.label}: ${pieces.join(', ')}`;
        });
        return `Weak spots: ${parts.join(' \u00b7 ')}`;
    }

    return { record, list, dailySummary, trendLine, weakSpots, weakSpotLine };
})();

window.ProgressStore = ProgressStore;
