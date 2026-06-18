// @ts-check
//-----------------------------------------------------------------------
// DEV ERROR MONITOR
// Early, dependency-free frontend error surfacing for manual local work
// and browser tests. Load before app scripts.
//-----------------------------------------------------------------------

(function () {
    'use strict';

    /** @type {Array<{ type: string, message: string, source?: string }>} */
    const errors = [];
    window.__voiceWeiErrors = errors;

    /** @param {{ type: string, message: string, source?: string }} entry */
    function record(entry) {
        errors.push(entry);
        renderBanner();
        sendToDevServer(entry);
    }

    /** @param {{ type: string, message: string, source?: string }} entry */
    function sendToDevServer(entry) {
        const payload = JSON.stringify({
            ...entry,
            userAgent: navigator.userAgent
        });
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            if (navigator.sendBeacon('/__voice-wei-errors', blob)) return;
        }
        fetch('/__voice-wei-errors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        }).catch(() => {
            // The plain static server cannot accept reports; the banner and
            // window.__voiceWeiErrors still make the failure visible.
        });
    }

    function renderBanner() {
        const id = 'voiceWeiErrorBanner';
        let banner = document.getElementById(id);
        if (!banner) {
            banner = document.createElement('div');
            banner.id = id;
            banner.setAttribute('role', 'alert');
            banner.style.cssText = [
                'position:fixed',
                'z-index:2147483647',
                'top:8px',
                'right:8px',
                'max-width:min(520px,calc(100vw - 16px))',
                'padding:10px 12px',
                'border:1px solid rgba(248,113,113,.9)',
                'border-radius:10px',
                'background:rgba(127,29,29,.96)',
                'color:#fee2e2',
                'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
                'box-shadow:0 12px 30px rgba(0,0,0,.35)',
                'white-space:pre-wrap'
            ].join(';');
            document.documentElement.appendChild(banner);
        }
        const latest = errors[errors.length - 1];
        banner.textContent = `Voice-Wei frontend error (${errors.length})\n${latest.type}: ${latest.message}`;
        if (latest.source) banner.textContent += `\n${latest.source}`;
    }

    /** @param {EventTarget | null} target */
    function describeResource(target) {
        if (!(target instanceof HTMLElement)) return 'unknown resource';
        const label = target.tagName.toLowerCase();
        const url = target.getAttribute('src') || target.getAttribute('href') || '';
        return `${label}${url ? ` ${url}` : ''}`;
    }

    window.addEventListener('error', event => {
        if (event.target && event.target !== window) {
            record({
                type: 'resource',
                message: `Failed to load ${describeResource(event.target)}`,
                source: location.href
            });
            return;
        }
        record({
            type: 'error',
            message: event.message || 'Unknown error',
            source: `${event.filename || location.href}:${event.lineno || 0}:${event.colno || 0}`
        });
    }, true);

    window.addEventListener('unhandledrejection', event => {
        const reason = event.reason;
        const message = reason && reason.stack
            ? reason.stack
            : String(reason && reason.message ? reason.message : reason);
        record({
            type: 'unhandledrejection',
            message,
            source: location.href
        });
    });
})();
