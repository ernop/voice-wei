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

    // Per-note correctness is owned by PitchScore (one definition
    // everywhere). Takes are scored as a SEQUENCE: the sung held notes
    // aligned in order to the targets (PitchScore.scoreSequence), so
    // holding a note longer than its slot or breathing between notes
    // never shifts later notes onto the wrong target.
    // A target the singer has not reached stays pending until the take
    // clock is past its slot.
    const SCORE_GRACE_MS = 60;
    // A note still sounding is not scored yet: the final segment stays
    // open until the mic has been quiet this long (wall time - the voice
    // clock freezes in silence and cannot tell holding from stopping).
    const SEGMENT_CLOSE_IDLE_MS = 600;

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
        // Drawing is NEVER throttled: a scrolling chart stepped at
        // uneven intervals reads as twitching, so the canvas redraws
        // every animation frame (the draw itself is cheap and bounded).
        // Throttles apply only to analysis (scoring) and text readouts.
        const scoreGate = new RateGate(100);
        const readoutGate = new RateGate(50);
        const logGate = new RateGate(2000);
        const panelDiff = new ValueDiff();

        /** Page diagnostics log (optional): what the mic path is doing. @param {string} text */
        function log(text) {
            if (config.logLine) config.logLine(text);
        }

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

        const session = PitchDetectCore.createTraceSession({
            pauseOnSilence: () => options.pauseOnSilence,
            onAccepted: sample => {
                updateReadout(sample.note, sample.cents, sample.freq);
                setStatus('Listening and drawing');
            },
            onSilence: () => clearReadout(),
            onFrame: () => {
                if (scoreGate.ready()) refreshScores();
                if (config.logLine && logGate.ready()) logMicSummary();
                drawIfChanged();
            },
            frameCallbackIntervalMs: 0
        });

        /** A 2s mic summary, logged only when something needs explaining. */
        function logMicSummary() {
            const d = session.diagnostics();
            const issues = d.noPitch + d.belowBand + d.aboveBand + d.guardFlips + d.held;
            if (!d.frames || issues === 0) return;
            const parts = [`${d.voiced} voiced`, `${d.quiet} quiet`];
            if (d.noPitch) parts.push(`${d.noPitch} signal-but-no-pitch`);
            if (d.belowBand) parts.push(`${d.belowBand} below-band(<D2)`);
            if (d.aboveBand) parts.push(`${d.aboveBand} above-band(>Bb4)`);
            if (d.guardFlips) parts.push(`${d.guardFlips} octave-guard-flips`);
            if (d.held) parts.push(`${d.held} scrape-held`);
            log(`mic ${d.frames} frames: ${parts.join(', ')}`);
        }

        // Repaint only when the picture would differ: a new sample, the
        // clock moving (scroll), or fresh verdicts. During a breath with
        // the voice clock frozen every frame is identical - skipping the
        // raster there is free smoothness on machines without GPU raster.
        let lastDrawKey = '';

        function drawIfChanged() {
            const key = `${session.history.length}|${session.clockMs() | 0}|${scoreVersion}`;
            if (key === lastDrawKey) return;
            lastDrawKey = key;
            view.draw();
        }

        function windowMs() {
            if (options.fixedWindow) return FIXED_WINDOW_MS;
            return Math.max(4000, config.contentDurationMs() + 700, session.clockMs() + 250);
        }

        /** @type {TargetSpan[]} */
        let scoredTargets = [];
        // One progress entry per take: set once every active target has
        // its verdict, cleared by Restart.
        let takeRecorded = false;

        // Incremental segmentation: every accepted sample is segmented
        // exactly once (pulled from session.history as it grows); the
        // 50ms scoring tick only aligns the few dozen resulting held
        // notes. A shrunken history means the session was reset - start
        // a fresh segmenter.
        let segmenter = PitchScore.createSegmenter();
        let segmentedCount = 0;
        let loggedSegments = 0;

        function currentSegments() {
            const history = session.history;
            if (segmentedCount > history.length) {
                segmenter = PitchScore.createSegmenter();
                segmentedCount = 0;
                loggedSegments = 0;
            }
            while (segmentedCount < history.length) {
                segmenter.push(history[segmentedCount++]);
            }
            return segmenter.segments();
        }

        /**
         * Log each held note once it can no longer change (a later note
         * exists, or the voice went idle).
         * @param {ReturnType<typeof segmenter.segments>} segments
         * @param {boolean} voiceIdle
         */
        function logClosedSegments(segments, voiceIdle) {
            if (!config.logLine) return;
            const closedCount = voiceIdle ? segments.length : Math.max(0, segments.length - 1);
            for (; loggedSegments < closedCount; loggedSegments++) {
                const segment = segments[loggedSegments];
                const first = segment.samples[0];
                const last = segment.samples[segment.samples.length - 1];
                log(`sung: ${midiToNoteName(segment.midi).full} ${midiToFreq(segment.midi).toFixed(1)}Hz, `
                    + `${Math.round(last.time - first.time)}ms, ${segment.samples.length} samples`);
            }
        }

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
         * Annotate each active target with a verdict: 'good' / 'ok' /
         * 'missed', or null while pending. The sung history is aligned
         * to the target sequence by PitchScore.scoreSequence, which only
         * ever scores the PREFIX the singer has reached: a note inside
         * that prefix verdicts the moment the singer moves on (matched,
         * or skipped over = missed), and every target beyond it stays
         * pending - the future never changes color while singing
         * continues. An unreached target resolves to missed only once
         * the singer has gone quiet AND the take clock is past its slot.
         * @returns {TargetSpan[]}
         */
        function scoreTargets() {
            const clock = session.clockMs();
            const voiceIdle = session.msSinceLastAccepted() >= SEGMENT_CLOSE_IDLE_MS;
            const all = config.targets();
            const activeTargets = all.filter(target => target.active);
            const segments = currentSegments();
            logClosedSegments(segments, voiceIdle);
            const results = PitchScore.alignSegments(segments, activeTargets, {
                finalSegmentOpen: !voiceIdle
            });
            let resultIndex = 0;
            return all.map(target => {
                if (!target.active) return target;
                const score = results[resultIndex++];
                if (!score.reached && !(voiceIdle && clock > target.endMs + SCORE_GRACE_MS)) {
                    return { ...target, result: null };
                }
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
            log(`take recorded: ${hit.length}/${active.length} on pitch`);
            updateProgressLine();
        }

        let scoreVersion = 0;
        let lastScoreSignature = '';

        function refreshScores() {
            const previous = scoredTargets;
            scoredTargets = scoreTargets();
            const signature = scoredTargets.map(target => target.result || '.').join('');
            if (signature !== lastScoreSignature) {
                lastScoreSignature = signature;
                scoreVersion++;
                if (config.logLine) {
                    scoredTargets.forEach((target, index) => {
                        if (!target.active || !target.result) return;
                        const before = previous[index];
                        if (before && before.result === target.result) return;
                        const bias = Number.isFinite(target.biasCents)
                            ? ` (${formatCents(/** @type {number} */(target.biasCents))}c)` : '';
                        log(`note "${target.label}": ${target.result}${bias}`);
                    });
                }
            }
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
                    <span><i class="legend-scored"></i> scored: green &le;${PitchScore.GOOD_CENTS}c, yellow &le;${PitchScore.OK_CENTS}c, red missed</span>
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
            const centsText = `${formatCents(cents)} cents`;
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
            log('take started (trace cleared)');
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
            /** Recorded samples (test seam) - the same list the trace draws. */
            get history() { return session.history; },
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
