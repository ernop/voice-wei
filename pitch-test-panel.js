// @ts-check
//-----------------------------------------------------------------------
// PITCH TEST PANEL
// The embeddable "listen" component: a page provides the key, rails and
// targets (typed contract: PitchTestPanelConfig in types/music.d.ts),
// and this panel renders the markup, owns the mic session, the trace
// canvas, the guide playback, and the panel options. The guide is
// sequenced by the panel from the active targets, so guide and notation
// cannot disagree about key, notes, or timing.
// Options persist per page through settings-store.
// Requires piano-core.js, pitch-detect-core.js, pitch-trace-view.js,
// practice-controls.js, settings-store.js.
//-----------------------------------------------------------------------

const PitchTestPanel = (function () {
    'use strict';

    const FIXED_WINDOW_MS = 20000;
    const OPTION_KEYS = ['showTargets', 'pauseOnSilence', 'fixedWindow', 'expandRange'];

    // The data the panel cannot function without. create() refuses to
    // build a panel missing any of these - a wrong consumer fails at
    // page load (and tsc flags the call site before that), never at
    // singing time in front of the user.
    const REQUIRED_CONFIG = ['hostId', 'idPrefix', 'title', 'subtitle', 'storageKey',
        'key', 'rails', 'targets', 'contentDurationMs', 'playNote'];

    // Per-note correctness is owned by PitchScore (one definition everywhere).
    // A window counts as scoreable shortly after its end.
    const SCORE_GRACE_MS = 60;

    /** @param {PitchTestPanelConfig} config */
    function create(config) {
        const missing = REQUIRED_CONFIG.filter(field => !config || config[field] === undefined);
        if (missing.length) {
            throw new Error(`PitchTestPanel.create: missing required config: ${missing.join(', ')}`);
        }

        const prefix = config.idPrefix;
        const options = {
            showTargets: true,
            pauseOnSilence: true,
            fixedWindow: false,
            expandRange: false
        };
        SettingsStore.load(config.storageKey, options, OPTION_KEYS);

        let panelOpen = false;
        const renderGate = new RateGate(50);
        const readoutGate = new RateGate(50);
        const panelDiff = new ValueDiff();

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
            onFrame: () => {
                if (!renderGate.ready()) return;
                refreshScores();
                view.draw();
            }
        });

        function windowMs() {
            if (options.fixedWindow) return FIXED_WINDOW_MS;
            return Math.max(4000, config.contentDurationMs() + 700, session.clockMs() + 250);
        }

        /** @type {TargetSpan[]} */
        let scoredTargets = [];
        // One progress entry per take: set once every active target has
        // its verdict, cleared by Restart.
        let takeRecorded = false;

        // The guide is sequenced here, from the same TargetSpans that are
        // drawn: identical notes, key, and timing by construction.
        let guideToken = 0;

        async function playGuide() {
            const token = ++guideToken;
            const spans = config.targets().filter(t => t.active);
            if (!spans.length) return;
            await PianoCore.ensureStarted();
            for (let i = 0; i < spans.length; i++) {
                if (token !== guideToken) return;
                const span = spans[i];
                config.playNote(span.midi, Math.max(0.05, (span.endMs - span.startMs) / 1000));
                const next = spans[i + 1];
                const waitMs = next ? next.startMs - span.startMs : span.endMs - span.startMs;
                await PianoCore.sleep(Math.max(20, waitMs));
            }
        }

        function cancelGuide() {
            guideToken++;
        }

        /**
         * Annotate each active target with a verdict once the clock has
         * passed its window: 'good' / 'ok' / 'missed', or null while pending.
         * @returns {TargetSpan[]}
         */
        function scoreTargets() {
            const history = session.history;
            const clock = session.clockMs();
            return config.targets().map(target => {
                if (!target.active) return target;
                if (clock < target.endMs + SCORE_GRACE_MS) return { ...target, result: null };

                const samples = history.filter(s => s.time >= target.startMs && s.time <= target.endMs);
                const score = PitchScore.scoreWindow(samples, target.midi);
                return { ...target, result: score.verdict, avgCents: score.avgCents, biasCents: score.biasCents };
            });
        }

        function updateScoreReadout() {
            const el = getEl('Score');
            if (!el) return;
            const scored = scoredTargets.filter(t => t.active && t.result);
            if (!scored.length) {
                panelDiff.text('score', el, '');
                return;
            }
            const hit = scored.filter(t => t.result === 'good' || t.result === 'ok');
            const total = scoredTargets.filter(t => t.active).length;
            let text = `Score: ${hit.length}/${total} on pitch`;
            if (hit.length) {
                const avg = hit.reduce((sum, t) => sum + t.avgCents, 0) / hit.length;
                text += ` (avg ${avg.toFixed(0)}c)`;
            }
            panelDiff.text('score', el, text);
        }

        function updateProgressLine() {
            if (!config.progressTool) return;
            const el = getEl('Progress');
            if (el) el.textContent = ProgressStore.trendLine(config.progressTool);
            const weakEl = getEl('WeakSpots');
            if (weakEl) weakEl.textContent = ProgressStore.weakSpotLine(config.progressTool);
        }

        /** The key on screen is always the key of rails, targets, and guide. */
        function updateKeyReadout() {
            const el = getEl('Key');
            if (!el) return;
            const key = config.key();
            el.textContent = `Key: ${key.rootLabel} ${key.scaleType.replace(/_/g, ' ')}`;
        }

        // A take is complete when every active target has a verdict and
        // something was actually sung.
        function maybeRecordTake() {
            if (takeRecorded || !config.progressTool) return;
            const active = scoredTargets.filter(t => t.active);
            if (active.length < 2) return;
            if (!active.every(t => t.result)) return;
            if (session.history.length < PitchScore.MIN_VOICED) return;

            const hit = active.filter(t => t.result === 'good' || t.result === 'ok');
            const key = config.key();
            ProgressStore.record({
                tool: config.progressTool,
                context: `${key.rootLabel} ${key.scaleType}`,
                total: active.length,
                hit: hit.length,
                avgCents: hit.length
                    ? hit.reduce((sum, t) => sum + (t.avgCents || 0), 0) / hit.length
                    : null,
                // Per-note outcomes make degree-level weak spots
                // aggregatable (the original training goal: find and
                // drill the degrees you miss or sing sharp/flat).
                notes: active.map(t => ({
                    label: t.label,
                    midi: t.midi,
                    result: /** @type {'good' | 'ok' | 'missed'} */ (t.result),
                    avgCents: t.avgCents ?? null,
                    biasCents: t.biasCents ?? null
                }))
            });
            takeRecorded = true;
            updateProgressLine();
        }

        function refreshScores() {
            scoredTargets = scoreTargets();
            updateScoreReadout();
            maybeRecordTake();
        }

        const view = PitchTraceView.create({
            canvasId: prefix + 'Canvas',
            defaultHeightPx: config.defaultHeightPx || 380,
            isVisible: () => panelOpen,
            emptyMessage: config.emptyMessage,
            rails: railLines,
            targets: () => (options.showTargets ? scoredTargets : []),
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

            // Actions come FIRST so Restart/Guide/Close sit at the very
            // top of the panel - reachable without scrolling. The test
            // never auto-plays anything: Guide is an explicit button.
            host.innerHTML = `
                <div class="pitch-test-actions">
                    <button id="${prefix}RestartBtn" class="pitch-test-btn" type="button">Restart</button>
                    <button id="${prefix}GuideBtn" class="pitch-test-btn" type="button">Play Guide</button>
                    <button id="${prefix}ListenBtn" class="pitch-test-btn" type="button" aria-pressed="false">Listening Off</button>
                    <button id="${prefix}TargetsBtn" class="pitch-test-btn" type="button" aria-pressed="true">Targets On</button>
                    <button id="${prefix}CloseBtn" class="pitch-test-btn" type="button">Close</button>
                </div>
                <div class="pitch-test-header">
                    <div class="pitch-test-titles">
                        <h2>${config.title}</h2>
                        <p>${config.subtitle}</p>
                    </div>
                </div>
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
                    <span id="${prefix}Key" class="pitch-test-key"></span>
                    <span id="${prefix}Pitch">Pitch: --</span>
                    <span id="${prefix}Cents">-- cents</span>
                    <span id="${prefix}Status">Sing to start time</span>
                    <span id="${prefix}Score" class="pitch-test-score"></span>
                </div>
                <div class="progress-summary" id="${prefix}Progress"></div>
                <div class="progress-summary" id="${prefix}WeakSpots"></div>
                <div class="pitch-test-canvas-wrap">
                    <canvas id="${prefix}Canvas" class="pitch-test-canvas"></canvas>
                </div>
                <div class="pitch-test-legend">
                    <span><i class="legend-target"></i> ${config.legendTargetLabel || 'targets'}</span>
                    <span><i class="legend-sung"></i> sung pitch</span>
                    <span><i class="legend-scale"></i> scale degree rails</span>
                    <span><i class="legend-scored"></i> scored: green &le;10c, yellow &le;25c, red missed</span>
                </div>
            `;
        }

        /** @param {string} message */
        function setStatus(message) {
            panelDiff.text('status', getEl('Status'), message);
        }

        /**
         * @param {string} note
         * @param {number} cents
         * @param {number} freq
         */
        function updateReadout(note, cents, freq) {
            if (!readoutGate.ready()) return;
            const pitchText = `Pitch: ${note} ${freq.toFixed(1)} Hz`;
            const centsText = `${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cents`;
            panelDiff.text('pitch', getEl('Pitch'), pitchText);
            panelDiff.text('cents', getEl('Cents'), centsText);
        }

        function clearReadout() {
            panelDiff.text('pitch', getEl('Pitch'), 'Pitch: --');
            panelDiff.text('cents', getEl('Cents'), '-- cents');
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

            PracticeControls.syncToggle(prefix + 'PauseToggle', options.pauseOnSilence);
            PracticeControls.syncToggle(prefix + 'WindowToggle', options.fixedWindow);
            PracticeControls.syncToggle(prefix + 'RangeToggle', options.expandRange);
        }

        function resetSession() {
            session.reset();
            takeRecorded = false;
            clearReadout();
            setStatus('Sing to start time');
            refreshScores();
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
            if (config.onOpenChange) config.onOpenChange(true);
            updateProgressLine();
            updateKeyReadout();
            view.resize();
            resetSession();
            await startListening();
        }

        function close() {
            if (!panelOpen && !session.listening) return;
            cancelGuide();
            stopListening();
            panelOpen = false;
            syncControls();
            if (config.onOpenChange) config.onOpenChange(false);
            clearReadout();
            setStatus('Ready');
        }

        function wire() {
            getEl('RestartBtn')?.addEventListener('click', open);
            getEl('GuideBtn')?.addEventListener('click', () => { void playGuide(); });
            getEl('ListenBtn')?.addEventListener('click', toggleListening);
            getEl('CloseBtn')?.addEventListener('click', close);
            getEl('TargetsBtn')?.addEventListener('click', () => {
                options.showTargets = !options.showTargets;
                saveOptions();
                syncControls();
                view.draw();
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
            cancelGuide,
            draw: () => {
                refreshScores();
                updateKeyReadout();
                view.draw();
            },
            resize: () => view.resize(),
            /**
             * Explicit sample ingestion (test seam): sing a pitch into
             * the session by name - midi and take-time, nothing implied.
             * Routed through the same glitch filter as the microphone.
             * @param {number} midi @param {number} timeMs
             */
            recordSample(midi, timeMs) {
                session.record({
                    time: timeMs,
                    midi,
                    freq: 0,
                    cents: 0,
                    note: ''
                });
                refreshScores();
                view.draw();
            }
        };
    }

    return { create };
})();

window.PitchTestPanel = PitchTestPanel;
