// @ts-check
//-----------------------------------------------------------------------
// DIAG LOG
// The collapsible in-page log surface, ported from the Music page: a
// timestamped line list with Show / Select All / Copy All / Clear, so
// the user can watch what a live pipeline is doing and paste the lines
// back verbatim. One instance per page; pages call add(label, text).
// Uses the shared .log-* styles in style.css.
//-----------------------------------------------------------------------

const DiagLog = (function () {
    'use strict';

    const MAX_LINES = 800;

    /**
     * @param {{ hostId: string, title?: string }} options
     */
    function create(options) {
        const host = document.getElementById(options.hostId);
        if (!host) return { add: () => {} };

        host.classList.add('log-container', 'collapsed');
        host.innerHTML = `
            <div class="log-header">
                <span class="log-label">${options.title || 'Log'}</span>
                <button class="panel-action-btn" data-log-toggle>Show</button>
                <button class="panel-action-btn" data-log-select style="display: none;">Select All</button>
                <button class="panel-action-btn" data-log-copy style="display: none;">Copy All</button>
                <button class="panel-action-btn danger" data-log-clear style="display: none;">Clear</button>
            </div>
            <div class="log-content" style="display: none;"></div>
        `;

        const content = /** @type {HTMLElement} */ (host.querySelector('.log-content'));
        const toggleBtn = /** @type {HTMLElement} */ (host.querySelector('[data-log-toggle]'));
        const actionButtons = /** @type {HTMLElement[]} */ ([...host.querySelectorAll('[data-log-select], [data-log-copy], [data-log-clear]')]);
        let open = false;

        function setOpen(value) {
            open = value;
            content.style.display = open ? 'block' : 'none';
            host.classList.toggle('collapsed', !open);
            toggleBtn.textContent = open ? 'Hide' : 'Show';
            actionButtons.forEach(btn => { btn.style.display = open ? '' : 'none'; });
            if (open) content.scrollTop = content.scrollHeight;
        }

        toggleBtn.addEventListener('click', event => {
            event.stopPropagation();
            setOpen(!open);
        });
        host.querySelector('.log-header')?.addEventListener('click', () => setOpen(!open));
        host.querySelector('[data-log-select]')?.addEventListener('click', event => {
            event.stopPropagation();
            const range = document.createRange();
            range.selectNodeContents(content);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });
        host.querySelector('[data-log-copy]')?.addEventListener('click', event => {
            event.stopPropagation();
            void navigator.clipboard?.writeText(content.innerText);
        });
        host.querySelector('[data-log-clear]')?.addEventListener('click', event => {
            event.stopPropagation();
            content.textContent = '';
        });

        /**
         * @param {string} label
         * @param {string} text
         */
        function add(label, text) {
            const timestamp = new Date().toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const line = document.createElement('div');
            line.className = 'log-line log-claude';
            line.textContent = `[${timestamp}] ${label}: ${text}`;
            content.appendChild(line);
            while (content.childElementCount > MAX_LINES) {
                content.firstElementChild?.remove();
            }
            if (open) content.scrollTop = content.scrollHeight;
        }

        return { add };
    }

    return { create };
})();

window.DiagLog = DiagLog;
