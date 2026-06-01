// @ts-check
//-----------------------------------------------------------------------
// PHRASES
// Dedicated phrase memory and reproduction practice.
//-----------------------------------------------------------------------

(function () {
    'use strict';

    const state = {
        root: 'C',
        octave: 4,
        scaleType: 'major',
        startAtOne: true,
        allowOutOfOctave: false,
        minLength: 5,
        maxLength: 10,
        returnToInitial: false,
        returnToRoot: false,
        outputMode: 'sing_numbers',
        noteLengthMs: 900,
        gapMs: 100,
        showNoteNames: true
    };

    /** @type {InstanceType<typeof Tone.Sampler> | null} */
    let synth = null;
    /** @type {InstanceType<typeof Tone.Gain> | null} */
    let gainNode = null;
    /** @type {any | null} */
    let currentPhrase = null;
    /** @type {any[]} */
    const phraseHistory = [];
    let playToken = 0;

    function getEl(id) {
        return document.getElementById(id);
    }

    function setStatus(text) {
        const el = getEl('phraseStatus');
        if (el) el.textContent = text;
    }

    function setMeta(text) {
        const el = getEl('phraseMeta');
        if (el) el.textContent = text;
    }

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
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }
    }

    function stopPlayback() {
        playToken++;
        if (synth) synth.releaseAll();
        if (gainNode) gainNode.gain.setValueAtTime(0, Tone.now());
        if (typeof VoiceOutput !== 'undefined') VoiceOutput.stop();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        setStatus('Stopped');
    }

    /** @param {number} ms */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** @param {number} midi */
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

    function updatePhraseDisplay() {
        const degreesEl = getEl('phraseDegrees');
        const notesEl = getEl('phraseNotes');
        if (!degreesEl || !notesEl) return;

        if (!currentPhrase) {
            degreesEl.textContent = '--';
            notesEl.textContent = '';
            return;
        }

        degreesEl.textContent = currentPhrase.displayDegrees.join('-');
        notesEl.textContent = state.showNoteNames ? currentPhrase.noteNames.join(' ') : '';

        const rangeText = state.allowOutOfOctave ? 'out of octave' : 'within octave';
        const startText = state.startAtOne ? 'start 1' : 'random start';
        setMeta(`${state.root} ${state.scaleType.replace(/_/g, ' ')} | ${startText} | ${rangeText}`);
    }

    function generatePhrase() {
        currentPhrase = buildPhrase();
        if (!currentPhrase) {
            setStatus('Could not generate phrase');
            return null;
        }
        phraseHistory.unshift(currentPhrase);
        if (phraseHistory.length > 50) phraseHistory.pop();
        updatePhraseDisplay();
        renderHistory();
        return currentPhrase;
    }

    /** @param {any} phrase */
    async function playPhrase(phrase) {
        await ensureAudioStarted();
        const token = ++playToken;
        updatePhraseDisplay();
        setStatus(`Playing ${phrase.displayDegrees.join('-')}`);

        if (state.outputMode === 'display') {
            setStatus('Displayed');
            return;
        }

        if (state.outputMode === 'speak') {
            await VoiceOutput.speak(phrase.spokenDegrees.join(', '));
            setStatus('Ready');
            return;
        }

        if (state.outputMode === 'speak_tones') {
            await VoiceOutput.speak(phrase.spokenDegrees.join(', '));
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

    /** @param {any} phrase @param {number} token */
    async function playToneSequence(phrase, token) {
        for (let i = 0; i < phrase.midiNotes.length; i++) {
            if (token !== playToken) return;
            const midi = phrase.midiNotes[i];
            setStatus(`${phrase.displayDegrees[i]} | ${midiToPitchString(midi)}`);
            playMidi(midi);
            await sleep(state.noteLengthMs + state.gapMs);
        }
        setStatus('Ready');
    }

    /**
     * @param {string} text
     * @param {number} midi
     * @param {number} durationMs
     */
    function speakNumberAtPitch(text, midi, durationMs) {
        return new Promise(resolve => {
            if (!('speechSynthesis' in window)) {
                resolve(undefined);
                return;
            }

            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.pitch = PatternPracticeCore.midiToSpeechPitch(midi);
            utterance.rate = state.noteLengthMs >= 1000 ? 0.85 : 1.0;
            utterance.volume = 1.0;

            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve(undefined);
            };
            utterance.onend = finish;
            utterance.onerror = finish;
            window.speechSynthesis.speak(utterance);
            setTimeout(finish, Math.max(250, durationMs + 250));
        });
    }

    /** @param {any} phrase @param {number} token */
    async function playSingNumberSequence(phrase, token) {
        for (let i = 0; i < phrase.midiNotes.length; i++) {
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
        setStatus('Ready');
    }

    async function playCurrentOrNew() {
        const phrase = currentPhrase || generatePhrase();
        if (phrase) await playPhrase(phrase);
    }

    async function playNext() {
        const phrase = generatePhrase();
        if (phrase) await playPhrase(phrase);
    }

    async function repeatCurrent() {
        if (!currentPhrase) {
            await playCurrentOrNew();
            return;
        }
        await playPhrase(currentPhrase);
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
                updatePhraseDisplay();
                await playPhrase(phrase);
            });

            const text = document.createElement('div');
            text.className = 'history-text';

            const degrees = document.createElement('div');
            degrees.className = 'phrase-history-degrees';
            degrees.textContent = phrase.displayDegrees.join('-');

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

    /** @param {string} attr @param {string} stateKey @param {(value: string) => any} parse */
    function wireSingleSelect(attr, stateKey, parse) {
        document.querySelectorAll(`[${attr}]`).forEach(el => {
            const btn = /** @type {HTMLElement} */ (el);
            const raw = btn.getAttribute(attr) || '';
            if (String(parse(raw)) === String(state[stateKey])) btn.classList.add('selected');

            btn.addEventListener('click', () => {
                document.querySelectorAll(`[${attr}]`).forEach(other => other.classList.remove('selected'));
                btn.classList.add('selected');
                state[stateKey] = parse(raw);
                if (state.minLength > state.maxLength) state.maxLength = state.minLength;
                currentPhrase = null;
                updatePhraseDisplay();
            });
        });
    }

    function wireToggle(id, stateKey) {
        const el = /** @type {HTMLInputElement | null} */ (getEl(id));
        if (!el) return;
        el.checked = Boolean(state[stateKey]);
        el.addEventListener('change', () => {
            state[stateKey] = el.checked;
            currentPhrase = null;
            updatePhraseDisplay();
        });
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
        getEl('repeatBtn')?.addEventListener('click', repeatCurrent);
        getEl('nextBtn')?.addEventListener('click', playNext);
        getEl('stopBtn')?.addEventListener('click', stopPlayback);
        getEl('clearHistoryBtn')?.addEventListener('click', () => {
            phraseHistory.length = 0;
            renderHistory();
        });

        updatePhraseDisplay();
        renderHistory();
    }

    async function boot() {
        setStatus('Loading piano');
        await initAudio();
        initUI();
        setStatus('Ready');
    }

    boot();
})();
