// @ts-check
//-----------------------------------------------------------------------
// HISTORY LIST
// Shared capped newest-first history list: owns the entries, the empty
// placeholder, full re-render, and the clear button. Pages provide
// renderItem(entry, index) to build each row.
//-----------------------------------------------------------------------

const HistoryList = (function () {
    'use strict';

    /**
     * @param {{
     *   listId: string,
     *   clearBtnId?: string,
     *   emptyText: string,
     *   max?: number,
     *   renderItem: (entry: any, index: number) => HTMLElement
     * }} config
     */
    function create(config) {
        const max = config.max ?? 50;
        /** @type {any[]} */
        let entries = [];

        function render() {
            const list = document.getElementById(config.listId);
            if (!list) return;
            list.textContent = '';
            if (!entries.length) {
                const empty = document.createElement('p');
                empty.className = 'history-empty';
                empty.textContent = config.emptyText;
                list.appendChild(empty);
                return;
            }
            entries.forEach((entry, index) => list.appendChild(config.renderItem(entry, index)));
        }

        function clear() {
            entries = [];
            render();
        }

        if (config.clearBtnId) {
            document.getElementById(config.clearBtnId)?.addEventListener('click', clear);
        }

        render();

        return {
            /** Newest first. Treat as read-only; mutate through add/clear. */
            get entries() { return entries; },
            /** @param {any} entry */
            add(entry) {
                entries.unshift(entry);
                if (entries.length > max) entries.pop();
                render();
            },
            clear,
            render
        };
    }

    return { create };
})();

window.HistoryList = HistoryList;
