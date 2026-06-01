// @ts-check
//-----------------------------------------------------------------------
// PHRASES
// Dedicated phrase memory and reproduction practice.
//-----------------------------------------------------------------------

(function () {
    'use strict';

    const state = {
        root: 'D#',
        octave: 3,
        scaleType: 'major',
        startAtOne: true,
        allowOutOfOctave: false,
        minLength: 5,
        maxLength: 10,
        returnToInitial: true,
        returnToRoot: false,
        outputMode: 'tones',
        noteLengthMs: 300,
        gapMs: 0,
        showNoteNames: true,
        reflected: false,
        loopCurrent: false
    };

    const STRUCTURE_KEYS = new Set([
        'startAtOne', 'allowOutOfOctave', 'minLength', 'maxLength',
        'returnToInitial', 'returnToRoot'
    ]);
    const PROJECT_KEYS = new Set(['root', 'octave', 'scaleType']);
    const PLAYBACK_KEYS = new Set(['outputMode', 'noteLengthMs', 'gapMs', 'showNoteNames']);

    /** @type {InstanceType<typeof Tone.Sampler> | null} */
    let synth = null;
    /** @type {InstanceType<typeof Tone.Gain> | null} */
    let gainNode = null;
    /** @type {any | null} */
    let currentPhrase = null;
    /** @type {boolean[] } */
    let activeMask = [];
    /** @type {any[]} */
    const phraseHistory = [];
    let playToken = 0;
    let isPointerToggling = false;
    let pointerToggleValue = true;

    function getEl(id) { return document.getElementById(id); }
    function setStatus(text) { const el = getEl('phraseStatus'); if (el) el.textContent = text; }
    function setMeta(text) { const el = getEl('phraseMeta'); if (el) el.textContent = text; }

    async function initAudio() {
        gainNode = new Tone.Gain(1).toDestination();
        return new Promise((resolve, reject) => {
            synth = new Tone.Sampler({
                urls: {
                    'A0': 'A0.mp3', 'C1': 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
                    'A1': 'A1.mp3', 'C2': 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
                    'A2': 'A2.mp3', 'C3': 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
                    'A3': 'A3.mp3', 'C4': 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
                    'A4': 'A4.mp3', 'C5': 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
                    'A5': 'A5.mp3', 'C6': 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
                    'A6': 'A6.mp3', 'C7': 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
                    'A7': 'A7.mp3', 'C8': 'C8.mp3',
                },
                baseUrl: 'https://tonejs.github.io/audio/salamander/',
                onload: () => resolve(undefined),
                onerror: reject
            }).connect(gainNode);
            synth.volume.value = -3;
        });
    }

    async function ensureAudioStarted() {
        if (Tone.context.state !== 'running') await Tone.start();
    }

    function cancelCurrentSound() {
        if (synth) synth.releaseAll();
        if (gainNode) gainNode.gain.setValueAtTime(0, Tone.now());
        if (typeof VoiceOutput !== 'undefined') VoiceOutput.stop();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    function stopPlayback(status = 'Stopped') {
        playToken++;
        state.loopCurrent = false;
        syncRepeatButton();
        cancelCurrentSound();
        setStatus(status);
    }

    function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    function playMidi(midi) {
        if (!synth || !gainNode) return;
        gainNode.gain.setValueAtTime(1, Tone.now());
        synth.triggerAttackRelease(midiToPitchString(midi), state.noteLengthMs / 1000);
    }

    function buildPhrase() {
        return PatternPracticeCore.generatePhrase({
            root: state.root,
            octave: state.octave,
            scaleType: state.scaleType,
            startAtOne: state.startAtOne,
            allowOutOfOctave: state.allowOutOfOctave,
            minLength: state.minLength,
            maxLength: state.maxLength,
            returnToInitial: state.returnToInitial,
            returnToRoot: state.returnToRoot
        });
    }

    function rootMidi() { return noteNameToMidi(state.root, state.octave); }

    function deriveDisplayPhrase() {
        if (!currentPhrase) return null;
        const root = rootMidi();
        if (root === null) return currentPhrase;

        const offsets = state.reflected
            ? PatternPracticeCore.reflectOffsets(currentPhrase.offsets, state.scaleType)
            : currentPhrase.offsets;
        const dp = PatternPracticeCore.degreesPerOctave(state.scaleType);
        const midiNotes = offsets.map(offset => PatternPracticeCore.scaleOffsetToMidi(root, state.scaleType, offset));

        return {
            ...currentPhrase,
            root: state.root,
            scaleType: state.scaleType,
            octave: state.octave,
            offsets,
            midiNotes,
            displayDegrees: offsets.map(offset => PatternPracticeCore.offsetToDegree(offset, dp)),
            spokenDegrees: offsets.map(offset => PatternPracticeCore.offsetToSpoken(offset, dp)),
            noteNames: midiNotes.map(midi => midiToPitchString(midi))
        };
    }


    function phraseGridTemplate(phrase) {
        return `repeat(${phrase.displayDegrees.length}, 2.8rem)`;
    }

    function renderDegreeRow(phrase) {
        const degreesEl = getEl('phraseDegrees');
        if (!degreesEl) return;
        degreesEl.textContent = '';
        degreesEl.style.gridTemplateColumns = phraseGridTemplate(phrase);
        phrase.displayDegrees.forEach((degree, index) => {
            const token = document.createElement('span');
            token.className = 'phrase-degree-token';
            token.dataset.index = String(index);
            token.textContent = degree;
            token.classList.toggle('inactive', activeMask[index] === false);
            degreesEl.appendChild(token);
        });
    }

    function activeIndexes(phrase) {
        const indexes = [];
        for (let i = 0; i < phrase.midiNotes.length; i++) {
            if (activeMask[i] !== false) indexes.push(i);
        }
        if (indexes.length) return indexes;
        return phrase.midiNotes.map((_, i) => i);
    }

    function updatePhraseDisplay() {
        const degreesEl = getEl('phraseDegrees');
        const notesEl = getEl('phraseNotes');
        if (!degreesEl || !notesEl) return;
        const phrase = deriveDisplayPhrase();
        if (!phrase) {
            degreesEl.textContent = '--';
            notesEl.textContent = '';
            renderNoteToggles(null);
            return;
        }
        renderDegreeRow(phrase);
        notesEl.textContent = state.showNoteNames ? phrase.noteNames.join(' ') : '';
        const rangeText = state.allowOutOfOctave ? 'out of octave' : 'within octave';
        const startText = state.startAtOne ? 'start 1' : 'random start';
        const reflectedText = state.reflected ? ' | reflected' : '';
        setMeta(`${state.root} ${state.scaleType.replace(/_/g, ' ')} | ${startText} | ${rangeText}${reflectedText}`);
        renderNoteToggles(phrase);
    }

    function generatePhrase() {
        currentPhrase = buildPhrase();
        if (!currentPhrase) { setStatus('Could not generate phrase'); return null; }
        activeMask = currentPhrase.midiNotes.map(() => true);
        phraseHistory.unshift(currentPhrase);
        if (phraseHistory.length > 50) phraseHistory.pop();
        updatePhraseDisplay();
        renderHistory();
        return currentPhrase;
    }

    function phraseForPlayback() { return deriveDisplayPhrase(); }

    async function playPhraseOnce(phrase, token) {
        updatePhraseDisplay();
        setStatus(`Playing ${phrase.displayDegrees.join(' ')}`);
        if (state.outputMode === 'display') { setStatus('Displayed'); return; }
        if (state.outputMode === 'speak') {
            await VoiceOutput.speak(activeIndexes(phrase).map(i => phrase.spokenDegrees[i]).join(', '));
            if (token === playToken) setStatus('Ready');
            return;
        }
        if (state.outputMode === 'speak_tones') {
            await VoiceOutput.speak(activeIndexes(phrase).map(i => phrase.spokenDegrees[i]).join(', '));
            if (token !== playToken) return;
            await playToneSequence(phrase, token);
            return;
        }
        if (state.outputMode === 'sing_numbers') {
            await playSingNumberSequence(phrase, token);
            return;
        }
        await playToneSequence(phrase, token);
    }

    async function playPhrase(phrase) {
        await ensureAudioStarted();
        cancelCurrentSound();
        const token = ++playToken;
        do {
            await playPhraseOnce(phrase, token);
            if (token !== playToken || !state.loopCurrent) break;
            setStatus('Repeating');
            await sleep(650);
        } while (token === playToken && state.loopCurrent);
    }

    async function playToneSequence(phrase, token) {
        for (const i of activeIndexes(phrase)) {
            if (token !== playToken) return;
            const midi = phrase.midiNotes[i];
            setStatus(`${phrase.displayDegrees[i]} | ${midiToPitchString(midi)}`);
            playMidi(midi);
            await sleep(state.noteLengthMs + state.gapMs);
        }
        if (token === playToken && !state.loopCurrent) setStatus('Ready');
    }

    function speakNumberAtPitch(text, midi, durationMs) {
        return new Promise(resolve => {
            if (!('speechSynthesis' in window)) { resolve(undefined); return; }
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.pitch = PatternPracticeCore.midiToSpeechPitch(midi);
            utterance.rate = state.noteLengthMs >= 1000 ? 0.85 : 1.0;
            utterance.volume = 1.0;
            let settled = false;
            const finish = () => { if (settled) return; settled = true; resolve(undefined); };
            utterance.onend = finish;
            utterance.onerror = finish;
            window.speechSynthesis.speak(utterance);
            setTimeout(finish, Math.max(250, durationMs + 250));
        });
    }

    async function playSingNumberSequence(phrase, token) {
        for (const i of activeIndexes(phrase)) {
            if (token !== playToken) return;
            const midi = phrase.midiNotes[i];
            const degree = phrase.displayDegrees[i];
            setStatus(`${degree} | ${midiToPitchString(midi)}`);
            playMidi(midi);
            await Promise.all([
                speakNumberAtPitch(phrase.spokenDegrees[i], midi, state.noteLengthMs),
                sleep(state.noteLengthMs)
            ]);
            if (state.gapMs > 0) await sleep(state.gapMs);
        }
        if (token === playToken && !state.loopCurrent) setStatus('Ready');
    }

    async function playCurrentOrNew() {
        if (!currentPhrase) generatePhrase();
        const phrase = phraseForPlayback();
        if (phrase) await playPhrase(phrase);
    }

    async function playNext() {
        state.loopCurrent = false;
        syncRepeatButton();
        generatePhrase();
        const phrase = phraseForPlayback();
        if (phrase) await playPhrase(phrase);
    }

    async function toggleRepeatLoop() {
        if (!currentPhrase) generatePhrase();
        state.loopCurrent = !state.loopCurrent;
        syncRepeatButton();
        if (state.loopCurrent) {
            const phrase = phraseForPlayback();
            if (phrase) await playPhrase(phrase);
        } else {
            stopPlayback('Repeat off');
        }
    }

    function syncRepeatButton() {
        const btn = getEl('repeatBtn');
        if (!btn) return;
        btn.classList.toggle('selected', state.loopCurrent);
        btn.setAttribute('aria-pressed', String(state.loopCurrent));
        const text = btn.querySelector('.button-text');
        if (text) text.textContent = state.loopCurrent ? 'Repeat On' : 'Repeat Off';
    }

    function renderNoteToggles(phrase) {
        const container = getEl('phraseNoteToggles');
        if (!container) return;
        container.textContent = '';
        if (!phrase) return;
        container.style.gridTemplateColumns = phraseGridTemplate(phrase);
        phrase.displayDegrees.forEach((degree, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'phrase-note-toggle';
            btn.textContent = activeMask[index] === false ? 'off' : 'on';
            btn.title = `${degree} ${phrase.noteNames[index]}`;
            btn.dataset.index = String(index);
            btn.classList.toggle('inactive', activeMask[index] === false);
            btn.addEventListener('pointerdown', event => {
                event.preventDefault();
                isPointerToggling = true;
                pointerToggleValue = activeMask[index] === false;
                setNoteActive(index, pointerToggleValue);
            });
            btn.addEventListener('pointerenter', () => {
                if (isPointerToggling) setNoteActive(index, pointerToggleValue);
            });
            container.appendChild(btn);
        });
    }

    function setNoteActive(index, active) {
        activeMask[index] = active;
        const btn = document.querySelector(`.phrase-note-toggle[data-index="${index}"]`);
        if (btn) {
            btn.classList.toggle('inactive', !active);
            btn.textContent = active ? 'on' : 'off';
        }
        const token = document.querySelector(`.phrase-degree-token[data-index="${index}"]`);
        if (token) token.classList.toggle('inactive', !active);
    }

    function endPointerToggle() { isPointerToggling = false; }

    function setAllNotes(active) {
        if (!currentPhrase) return;
        activeMask = currentPhrase.midiNotes.map(() => active);
        renderNoteToggles(deriveDisplayPhrase());
    }

    function renderHistory() {
        const list = getEl('historyList');
        if (!list) return;
        list.textContent = '';
        if (!phraseHistory.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = 'No phrases yet';
            list.appendChild(empty);
            return;
        }
        phraseHistory.forEach((phrase, index) => {
            const item = document.createElement('div');
            item.className = 'history-item';
            const playBtn = document.createElement('button');
            playBtn.className = 'history-play-btn';
            playBtn.type = 'button';
            playBtn.title = 'Play phrase';
            playBtn.textContent = '>';
            playBtn.addEventListener('click', async () => {
                currentPhrase = phrase;
                activeMask = phrase.midiNotes.map(() => true);
                updatePhraseDisplay();
                const playbackPhrase = phraseForPlayback();
                if (playbackPhrase) await playPhrase(playbackPhrase);
            });
            const text = document.createElement('div');
            text.className = 'history-text';
            const degrees = document.createElement('div');
            degrees.className = 'phrase-history-degrees';
            degrees.textContent = phrase.displayDegrees.join(' ');
            const notes = document.createElement('div');
            notes.className = 'history-transcript';
            notes.textContent = phrase.noteNames.join(' ');
            const time = document.createElement('span');
            time.className = 'history-time';
            time.textContent = index === 0 ? 'new' : '';
            text.appendChild(degrees);
            text.appendChild(notes);
            item.appendChild(playBtn);
            item.appendChild(text);
            item.appendChild(time);
            list.appendChild(item);
        });
    }


    function syncSingleSelect(attr, expectedValue) {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            btn.classList.toggle('selected', btn.getAttribute(attr) === String(expectedValue));
        });
    }

    function syncLengthButtons() {
        syncSingleSelect('data-min-length', state.minLength);
        syncSingleSelect('data-max-length', state.maxLength);
    }

    function onSettingChanged(key) {
        if (STRUCTURE_KEYS.has(key)) {
            if (currentPhrase) {
                stopPlayback('Regenerated');
                generatePhrase();
            }
            return;
        }
        if (PROJECT_KEYS.has(key) || PLAYBACK_KEYS.has(key)) {
            updatePhraseDisplay();
            if (currentPhrase) playCurrentOrNew();
        }
    }

    function wireSingleSelect(attr, stateKey, parse) {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            const raw = btn.getAttribute(attr) || '';
            if (String(parse(raw)) === String(state[stateKey])) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                document.querySelectorAll(`[${attr}]`).forEach(other => other.classList.remove('selected'));
                btn.classList.add('selected');
                state[stateKey] = parse(raw);
                if (state.minLength > state.maxLength) {
                    if (stateKey === 'maxLength') state.minLength = state.maxLength;
                    else state.maxLength = state.minLength;
                    syncLengthButtons();
                }
                onSettingChanged(stateKey);
            });
        });
    }

    function wireToggle(id, stateKey) {
        const el = /** @type {HTMLInputElement | null} */ (getEl(id));
        if (!el) return;
        el.checked = Boolean(state[stateKey]);
        el.addEventListener('change', () => {
            state[stateKey] = el.checked;
            onSettingChanged(stateKey);
        });
    }

    function toggleReflect() {
        state.reflected = !state.reflected;
        const btn = getEl('reflectBtn');
        if (btn) {
            btn.classList.toggle('selected', state.reflected);
            btn.setAttribute('aria-pressed', String(state.reflected));
            btn.textContent = state.reflected ? 'Reflect On' : 'Reflect Off';
        }
        updatePhraseDisplay();
        if (currentPhrase) playCurrentOrNew();
    }

    function initUI() {
        wireSingleSelect('data-root', 'root', String);
        wireSingleSelect('data-octave', 'octave', Number);
        wireSingleSelect('data-scale', 'scaleType', String);
        wireSingleSelect('data-start', 'startAtOne', value => value === 'one');
        wireSingleSelect('data-range', 'allowOutOfOctave', value => value === 'expanded');
        wireSingleSelect('data-min-length', 'minLength', Number);
        wireSingleSelect('data-max-length', 'maxLength', Number);
        wireSingleSelect('data-output', 'outputMode', String);
        wireSingleSelect('data-length', 'noteLengthMs', Number);
        wireSingleSelect('data-gap', 'gapMs', Number);
        wireToggle('returnInitialToggle', 'returnToInitial');
        wireToggle('returnRootToggle', 'returnToRoot');
        wireToggle('showNamesToggle', 'showNoteNames');
        getEl('playBtn')?.addEventListener('click', playCurrentOrNew);
        getEl('repeatBtn')?.addEventListener('click', toggleRepeatLoop);
        getEl('nextBtn')?.addEventListener('click', playNext);
        getEl('stopBtn')?.addEventListener('click', () => stopPlayback());
        getEl('reflectBtn')?.addEventListener('click', toggleReflect);
        getEl('allNotesBtn')?.addEventListener('click', () => setAllNotes(true));
        getEl('clearHistoryBtn')?.addEventListener('click', () => { phraseHistory.length = 0; renderHistory(); });
        window.addEventListener('pointerup', endPointerToggle);
        window.addEventListener('pointercancel', endPointerToggle);
        updatePhraseDisplay();
        renderHistory();
        syncRepeatButton();
    }

    async function boot() {
        setStatus('Loading piano');
        await initAudio();
        initUI();
        setStatus('Ready');
    }

    boot();
})();
