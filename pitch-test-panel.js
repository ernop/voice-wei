// @ts-check
//-----------------------------------------------------------------------
// PITCH TEST PANEL
// The embeddable "listen" component: a page provides rails and targets
// (the pre-seed), and this panel renders the markup, owns the mic
// session, the trace canvas, and the panel options (targets on/off,
// play guide on restart, pause on silence, 20s window, expand range).
// Options persist per page through settings-store.
// Requires pitch-detect-core.js, pitch-trace-view.js, practice-controls.js,
// settings-store.js.
//-----------------------------------------------------------------------

const PitchTestPanel = (function () {
    'use strict';

    const FIXED_WINDOW_MS = 20000;
    const OPTION_KEYS = ['showTargets', 'playOnRestart', 'pauseOnSilence', 'fixedWindow', 'expandRange'];

    /**
     * @param {{
     *   hostId: string,
     *   idPrefix: string,
     *   title: string,
     *   subtitle: string,
     *   storageKey: string,
     *   defaultHeightPx?: number,
     *   legendTargetLabel?: string,
     *   guideToggleLabel?: string,
     *   emptyMessage?: () => string | null,
     *   rails: (panelOptions: { expandRange: boolean }) => Array<{ midi: number, label: string, emphasized: boolean }>,
     *   targets: () => Array<{ midi: number, startMs: number, endMs: number, label: string, active: boolean }>,
     *   contentDurationMs: () => number,
     *   playGuide?: () => Promise<void>
     * }} config
     */
    function create(config) {
        const prefix = config.idPrefix;
        const options = {
            showTargets: true,
            playOnRestart: false,
            pauseOnSilence: true,
            fixedWindow: false,
            expandRange: false
        };
        SettingsStore.load(config.storageKey, options, OPTION_KEYS);

        let panelOpen = false;

        /** @returns {HTMLElement | null} */
        function getEl(suffix) {
            return document.getElementById(prefix + suffix);
        }

        function saveOptions() {
            SettingsStore.save(config.storageKey, options, OPTION_KEYS);
        }

        function railLines() {
            return config.rails({ expandRange: options.expandRange });
        }

        // Pitches far outside the charted rails are detector artifacts,
        // not notes; discard them before they reach the trace.
        /** @param {number} midi */
        function isOutlier(midi) {
            const rails = railLines();
            if (!rails.length) return false;
            const min = Math.min(...rails.map(rail => rail.midi));
            const max = Math.max(...rails.map(rail => rail.midi));
            return midi < min || midi > max;
        }

        const session = PitchDetectCore.createTraceSession({
            pauseOnSilence: () => options.pauseOnSilence,
            isOutlier,
            onAccepted: sample => {
                updateReadout(sample.note, sample.cents, sample.freq);
                setStatus('Listening and drawing');
            },
            onSilence: () => clearReadout(),
            onFrame: () => view.draw()
        });

        function windowMs() {
            if (options.fixedWindow) return FIXED_WINDOW_MS;
            return Math.max(4000, config.contentDurationMs() + 700, session.clockMs() + 250);
        }

        const view = PitchTraceView.create({
            canvasId: prefix + 'Canvas',
            defaultHeightPx: config.defaultHeightPx || 380,
            isVisible: () => panelOpen,
            emptyMessage: config.emptyMessage,
            rails: railLines,
            targets: () => (options.showTargets ? config.targets() : []),
            history: () => session.history,
            clockMs: () => session.clockMs(),
            windowMs,
            fixedWindow: () => options.fixedWindow,
            showPlayhead: () => session.startedAt > 0
        });

        function render() {
            const host = document.getElementById(config.hostId);
            if (!host) return;
            host.classList.add('pitch-test-panel');
            host.hidden = true;

            const guideToggleHtml = config.playGuide
                ? `<label class="display-toggle pitch-test-play-toggle">
                       <input type="checkbox" id="${prefix}PlayToggle">
                       <span>${config.guideToggleLabel || 'Play guide on restart'}</span>
                   </label>`
                : '';

            host.innerHTML = `
                <div class="pitch-test-header">
                    <div>
                        <h2>${config.title}</h2>
                        <p>${config.subtitle}</p>
                    </div>
                    <div class="pitch-test-actions">
                        <button id="${prefix}RestartBtn" class="pitch-test-btn" type="button">Restart</button>
                        <button id="${prefix}ListenBtn" class="pitch-test-btn" type="button" aria-pressed="false">Listening Off</button>
                        <button id="${prefix}TargetsBtn" class="pitch-test-btn" type="button" aria-pressed="true">Targets On</button>
                        <button id="${prefix}CloseBtn" class="pitch-test-btn" type="button">Close</button>
                    </div>
                </div>
                ${guideToggleHtml}
                <div class="pitch-test-options">
                    <label class="display-toggle">
                        <input type="checkbox" id="${prefix}PauseToggle">
                        <span>Pause on silence</span>
                    </label>
                    <label class="display-toggle">
                        <input type="checkbox" id="${prefix}WindowToggle">
                        <span>20s window</span>
                    </label>
                    <label class="display-toggle">
                        <input type="checkbox" id="${prefix}RangeToggle">
                        <span>Expand range</span>
                    </label>
                </div>
                <div class="pitch-test-readout" aria-live="polite">
                    <span id="${prefix}Pitch">Pitch: --</span>
                    <span id="${prefix}Cents">-- cents</span>
                    <span id="${prefix}Status">Sing to start time</span>
                </div>
                <div class="pitch-test-canvas-wrap">
                    <canvas id="${prefix}Canvas" class="pitch-test-canvas"></canvas>
                </div>
                <div class="pitch-test-legend">
                    <span><i class="legend-target"></i> ${config.legendTargetLabel || 'targets'}</span>
                    <span><i class="legend-sung"></i> sung pitch</span>
                    <span><i class="legend-scale"></i> scale degree rails</span>
                </div>
            `;
        }

        /** @param {string} message */
        function setStatus(message) {
            const el = getEl('Status');
            if (el) el.textContent = message;
        }

        /**
         * @param {string} note
         * @param {number} cents
         * @param {number} freq
         */
        function updateReadout(note, cents, freq) {
            const pitchEl = getEl('Pitch');
            const centsEl = getEl('Cents');
            if (pitchEl) pitchEl.textContent = `Pitch: ${note} ${freq.toFixed(1)} Hz`;
            if (centsEl) centsEl.textContent = `${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cents`;
        }

        function clearReadout() {
            const pitchEl = getEl('Pitch');
            const centsEl = getEl('Cents');
            if (pitchEl) pitchEl.textContent = 'Pitch: --';
            if (centsEl) centsEl.textContent = '-- cents';
        }

        function syncControls() {
            const host = document.getElementById(config.hostId);
            if (host) host.hidden = !panelOpen;

            const listenBtn = getEl('ListenBtn');
            if (listenBtn) {
                listenBtn.classList.toggle('listening', session.listening);
                listenBtn.setAttribute('aria-pressed', String(session.listening));
                listenBtn.textContent = session.listening ? 'Listening On' : 'Listening Off';
            }

            const targetsBtn = getEl('TargetsBtn');
            if (targetsBtn) {
                targetsBtn.classList.toggle('selected', options.showTargets);
                targetsBtn.setAttribute('aria-pressed', String(options.showTargets));
                targetsBtn.textContent = options.showTargets ? 'Targets On' : 'Targets Off';
            }

            PracticeControls.syncToggle(prefix + 'PlayToggle', options.playOnRestart);
            PracticeControls.syncToggle(prefix + 'PauseToggle', options.pauseOnSilence);
            PracticeControls.syncToggle(prefix + 'WindowToggle', options.fixedWindow);
            PracticeControls.syncToggle(prefix + 'RangeToggle', options.expandRange);
        }

        function resetSession() {
            session.reset();
            clearReadout();
            setStatus('Sing to start time');
            view.draw();
        }

        async function startListening() {
            if (session.listening) return;
            const ok = await session.start();
            if (!ok) {
                syncControls();
                setStatus('Microphone unavailable or access denied.');
                return;
            }
            syncControls();
            setStatus('Sing to start time');
        }

        function stopListening() {
            session.stop();
            syncControls();
            setStatus('Listening off');
            view.draw();
        }

        async function toggleListening() {
            if (session.listening) {
                stopListening();
                return;
            }
            if (!session.startedAt) resetSession();
            await startListening();
        }

        // Open (or re-open) the panel: reset the trace, start listening,
        // and optionally play the guide.
        async function open() {
            panelOpen = true;
            syncControls();
            view.resize();
            resetSession();
            await startListening();
            if (options.playOnRestart && config.playGuide) await config.playGuide();
        }

        function close() {
            if (!panelOpen && !session.listening) return;
            stopListening();
            panelOpen = false;
            syncControls();
            clearReadout();
            setStatus('Ready');
        }

        function wire() {
            getEl('RestartBtn')?.addEventListener('click', open);
            getEl('ListenBtn')?.addEventListener('click', toggleListening);
            getEl('CloseBtn')?.addEventListener('click', close);
            getEl('TargetsBtn')?.addEventListener('click', () => {
                options.showTargets = !options.showTargets;
                saveOptions();
                syncControls();
                view.draw();
            });
            PracticeControls.wireToggle(prefix + 'PlayToggle', options.playOnRestart, checked => {
                options.playOnRestart = checked;
                saveOptions();
            });
            PracticeControls.wireToggle(prefix + 'PauseToggle', options.pauseOnSilence, checked => {
                options.pauseOnSilence = checked;
                saveOptions();
                resetSession();
            });
            PracticeControls.wireToggle(prefix + 'WindowToggle', options.fixedWindow, checked => {
                options.fixedWindow = checked;
                saveOptions();
                view.draw();
            });
            PracticeControls.wireToggle(prefix + 'RangeToggle', options.expandRange, checked => {
                options.expandRange = checked;
                saveOptions();
                view.draw();
            });
            window.addEventListener('resize', () => view.resize());
        }

        render();
        wire();
        syncControls();

        return {
            get isOpen() { return panelOpen; },
            open,
            close,
            draw: () => view.draw(),
            resize: () => view.resize()
        };
    }

    return { create };
})();

window.PitchTestPanel = PitchTestPanel;
