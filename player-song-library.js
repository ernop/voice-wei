// @ts-check
// Local imported song library for MIDI and MusicXML source files.

const PlayerSongLibrary = (function () {
    'use strict';

    const SUPPORTED_EXTENSIONS = ['.mid', '.midi', '.musicxml', '.xml'];
    const DEFAULT_TEMPO_BPM = 120;

    /** @param {VoiceMusicController} controller */
    function install(controller) {
        let libraryPiano = null;
        let playbackToken = 0;

        Object.assign(controller, /** @type {ThisType<VoiceMusicController>} */ ({
            setupSongLibraryUI() {
                const importInput = /** @type {HTMLInputElement | null} */ (document.getElementById('songLibraryImportInput'));
                const importBtn = document.getElementById('songLibraryImportBtn');
                const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById('songLibrarySearch'));
                const stopBtn = document.getElementById('songLibraryStopBtn');
                const toggleBtn = document.getElementById('songLibraryToggleBtn');

                if (toggleBtn) {
                    toggleBtn.addEventListener('click', () => this.toggleSongLibraryPanel());
                }

                if (importBtn && importInput) {
                    importBtn.addEventListener('click', () => importInput.click());
                    importInput.addEventListener('change', () => {
                        if (importInput.files && importInput.files.length) {
                            void this.importSongLibraryFiles(importInput.files);
                            importInput.value = '';
                        }
                    });
                }

                if (searchInput) {
                    searchInput.addEventListener('input', () => this.renderSongLibrary());
                }

                if (stopBtn) {
                    stopBtn.addEventListener('click', () => this.stopLibrarySong());
                }

                this.renderSongLibrary();
            },

            toggleSongLibraryPanel() {
                const panel = document.getElementById('songLibraryPanel');
                if (!panel) return;
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            },

            /** @param {FileList | File[]} files */
            async importSongLibraryFiles(files) {
                const imported = [];
                for (const file of Array.from(files)) {
                    try {
                        const song = await importSongFile(file);
                        this.songLibrary.songs.unshift(song);
                        imported.push(song);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        this.addMessage('error', 'Song Import', `${file.name}: ${message}`);
                    }
                }

                if (imported.length) {
                    PlayerStorage.saveSongLibrary(this.songLibrary);
                    this.renderSongLibrary();
                    this.updateStatus(`Imported ${imported.length} song${imported.length === 1 ? '' : 's'} to local library`);
                }
            },

            renderSongLibrary() {
                const list = document.getElementById('songLibraryList');
                const count = document.getElementById('songLibraryCount');
                const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById('songLibrarySearch'));
                if (!list) return;

                const query = normalizeSearch(searchInput ? searchInput.value : '');
                const songs = this.songLibrary.songs.filter(song => matchesSongQuery(song, query));
                if (count) count.textContent = `${this.songLibrary.songs.length} saved`;

                if (!this.songLibrary.songs.length) {
                    list.innerHTML = '<div class="song-library-empty">No imported songs yet. Load a MIDI or MusicXML file to save it here.</div>';
                    return;
                }

                if (!songs.length) {
                    list.innerHTML = '<div class="song-library-empty">No songs match that search.</div>';
                    return;
                }

                list.innerHTML = songs.map(song => `
                    <article class="song-library-card" data-song-id="${this.escapeHtml(song.id)}">
                        <button class="song-library-fav ${song.favorite ? 'favorited' : ''}" type="button" data-song-action="favorite" aria-label="Favorite ${this.escapeHtml(song.title)}">${song.favorite ? 'Fav' : 'Add Fav'}</button>
                        <div class="song-library-main">
                            <div class="song-library-title">${this.escapeHtml(song.title)}</div>
                            <div class="song-library-meta">
                                ${song.sourceType.toUpperCase()} - ${song.noteCount} notes - ${formatMs(song.durationMs)} - ${Math.round(song.tempoBpm)} bpm
                            </div>
                            <div class="song-library-source">${this.escapeHtml(song.sourceName)}</div>
                            ${song.lyricsText ? `<div class="song-library-lyrics">${this.escapeHtml(firstWords(song.lyricsText, 18))}</div>` : ''}
                        </div>
                        <button class="song-library-play" type="button" data-song-action="play">Play</button>
                    </article>
                `).join('');

                list.querySelectorAll('[data-song-action]').forEach(button => {
                    button.addEventListener('click', event => {
                        const target = /** @type {HTMLElement} */ (event.currentTarget);
                        const card = target.closest('[data-song-id]');
                        const songId = card ? card.getAttribute('data-song-id') : '';
                        if (!songId) return;
                        const action = target.getAttribute('data-song-action');
                        if (action === 'favorite') this.toggleLibrarySongFavorite(songId);
                        if (action === 'play') void this.playLibrarySong(songId);
                    });
                });
            },

            /** @param {string} songId */
            async playLibrarySong(songId) {
                const song = this.songLibrary.songs.find(entry => entry.id === songId);
                if (!song || !song.notes.length) return;

                const token = ++playbackToken;
                await PianoCore.ensureStarted();
                if (!libraryPiano) {
                    libraryPiano = await PianoCore.createPiano();
                }

                this.updateStatus(`Playing ${song.title}`);
                const orderedNotes = [...song.notes].sort((a, b) => a.startMs - b.startMs);
                let cursorMs = 0;
                for (const note of orderedNotes) {
                    if (token !== playbackToken) return;
                    const waitMs = Math.max(0, note.startMs - cursorMs);
                    if (waitMs > 0) await PianoCore.sleep(waitMs);
                    if (token !== playbackToken) return;
                    libraryPiano.playMidi(note.midi, Math.max(0.05, (note.endMs - note.startMs) / 1000));
                    cursorMs = note.startMs;
                }
            },

            stopLibrarySong() {
                playbackToken++;
                if (libraryPiano) libraryPiano.stopAll();
                this.updateStatus('Song library playback stopped');
            },

            /** @param {string} songId */
            toggleLibrarySongFavorite(songId) {
                const song = this.songLibrary.songs.find(entry => entry.id === songId);
                if (!song) return;
                song.favorite = !song.favorite;
                PlayerStorage.saveSongLibrary(this.songLibrary);
                this.renderSongLibrary();
            }
        }));
    }

    /** @param {File} file @returns {Promise<SongLibrarySong>} */
    async function importSongFile(file) {
        const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
        if (!SUPPORTED_EXTENSIONS.includes(extension)) {
            throw new Error('Supported formats are MIDI and MusicXML');
        }
        if (extension === '.mid' || extension === '.midi') {
            return importMidi(file);
        }
        return importMusicXml(file);
    }

    /** @param {File} file @returns {Promise<SongLibrarySong>} */
    async function importMidi(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = parseMidi(bytes);
        return makeSongRecord({
            title: parsed.title || stripExtension(file.name),
            sourceType: 'midi',
            sourceName: file.name,
            tempoBpm: parsed.tempoBpm,
            notes: parsed.notes,
            lyricLines: parsed.lyricLines
        });
    }

    /** @param {File} file @returns {Promise<SongLibrarySong>} */
    async function importMusicXml(file) {
        const text = await file.text();
        const parsed = parseMusicXml(text, stripExtension(file.name));
        return makeSongRecord({
            title: parsed.title,
            sourceType: 'musicxml',
            sourceName: file.name,
            tempoBpm: parsed.tempoBpm,
            notes: parsed.notes,
            lyricLines: parsed.lyricLines
        });
    }

    /**
     * @param {{ title: string, sourceType: 'midi' | 'musicxml', sourceName: string, tempoBpm: number, notes: SongLibraryNote[], lyricLines: SongLibraryLyricLine[] }} data
     * @returns {SongLibrarySong}
     */
    function makeSongRecord(data) {
        const notes = data.notes
            .filter(note => Number.isFinite(note.midi) && note.endMs > note.startMs)
            .sort((a, b) => a.startMs - b.startMs);
        if (!notes.length) throw new Error('No pitched notes found');

        const lyricLines = data.lyricLines.filter(line => line.text.trim());
        return {
            id: `song_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            title: data.title || data.sourceName,
            sourceType: data.sourceType,
            sourceName: data.sourceName,
            importedAt: Date.now(),
            favorite: false,
            tempoBpm: data.tempoBpm || DEFAULT_TEMPO_BPM,
            durationMs: Math.max(...notes.map(note => note.endMs)),
            noteCount: notes.length,
            lyricsText: lyricLines.map(line => line.text).join(' ').trim(),
            lyricLines,
            notes
        };
    }

    /** @param {Uint8Array} bytes */
    function parseMidi(bytes) {
        const reader = makeByteReader(bytes);
        if (reader.readAscii(4) !== 'MThd') throw new Error('Not a MIDI file');
        const headerLength = reader.readU32();
        const format = reader.readU16();
        const trackCount = reader.readU16();
        const division = reader.readU16();
        reader.skip(headerLength - 6);
        if (format > 2) throw new Error(`Unsupported MIDI format ${format}`);
        if (division & 0x8000) throw new Error('SMPTE-timed MIDI is not supported yet');

        /** @type {SongLibraryNote[]} */
        const rawNotes = [];
        /** @type {Array<{ tick: number, microsecondsPerQuarter: number }>} */
        const tempoEvents = [{ tick: 0, microsecondsPerQuarter: 500000 }];
        /** @type {SongLibraryLyricLine[]} */
        const rawLyrics = [];
        let title = '';

        for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
            if (reader.readAscii(4) !== 'MTrk') throw new Error('Bad MIDI track header');
            const trackLength = reader.readU32();
            const trackEnd = reader.offset + trackLength;
            const parsedTrack = parseMidiTrack(bytes, reader.offset, trackEnd, trackIndex);
            reader.offset = trackEnd;
            rawNotes.push(...parsedTrack.notes);
            tempoEvents.push(...parsedTrack.tempoEvents);
            rawLyrics.push(...parsedTrack.lyrics);
            if (!title && parsedTrack.title) title = parsedTrack.title;
        }

        const selectedNotes = selectMidiTrack(rawNotes);
        const tempoMap = buildTempoMap(tempoEvents);
        const notes = selectedNotes.map(note => ({
            ...note,
            startMs: Math.round(ticksToMs(note.startMs, tempoMap, division)),
            endMs: Math.round(ticksToMs(note.endMs, tempoMap, division))
        }));
        const lyricLines = rawLyrics.map(line => ({
            timeMs: Math.round(ticksToMs(line.timeMs, tempoMap, division)),
            text: line.text
        }));

        return {
            title,
            tempoBpm: Math.round(60000000 / tempoMap[0].microsecondsPerQuarter),
            notes,
            lyricLines
        };
    }

    /**
     * @param {Uint8Array} bytes
     * @param {number} start
     * @param {number} end
     * @param {number} sourceTrack
     */
    function parseMidiTrack(bytes, start, end, sourceTrack) {
        const reader = makeByteReader(bytes, start);
        /** @type {Map<string, number[]>} */
        const active = new Map();
        /** @type {SongLibraryNote[]} */
        const notes = [];
        /** @type {Array<{ tick: number, microsecondsPerQuarter: number }>} */
        const tempoEvents = [];
        /** @type {SongLibraryLyricLine[]} */
        const lyrics = [];
        let title = '';
        let tick = 0;
        let runningStatus = 0;

        while (reader.offset < end) {
            tick += reader.readVarLen();
            let status = reader.readU8();
            if (status < 0x80) {
                if (!runningStatus) throw new Error('Bad MIDI running status');
                reader.offset--;
                status = runningStatus;
            } else if (status < 0xF0) {
                runningStatus = status;
            }

            if (status === 0xFF) {
                const type = reader.readU8();
                const length = reader.readVarLen();
                const dataStart = reader.offset;
                const data = bytes.slice(dataStart, dataStart + length);
                reader.skip(length);
                if (type === 0x2F) break;
                if (type === 0x03) title = decodeBytes(data).trim();
                if (type === 0x05) {
                    const text = decodeBytes(data).trim();
                    if (text) lyrics.push({ timeMs: tick, text });
                }
                if (type === 0x51 && length === 3) {
                    tempoEvents.push({
                        tick,
                        microsecondsPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2]
                    });
                }
                continue;
            }

            if (status === 0xF0 || status === 0xF7) {
                reader.skip(reader.readVarLen());
                continue;
            }

            const eventType = status & 0xF0;
            const channel = status & 0x0F;
            const note = reader.readU8();
            const hasSecondDataByte = eventType !== 0xC0 && eventType !== 0xD0;
            const value = hasSecondDataByte ? reader.readU8() : 0;
            if (eventType !== 0x80 && eventType !== 0x90) continue;

            const key = `${channel}:${note}`;
            if (eventType === 0x90 && value > 0) {
                const starts = active.get(key) || [];
                starts.push(tick);
                active.set(key, starts);
            } else {
                const starts = active.get(key);
                const startedAt = starts ? starts.shift() : null;
                if (starts && !starts.length) active.delete(key);
                if (startedAt !== null && startedAt !== undefined && tick > startedAt) {
                    notes.push({
                        midi: note,
                        startMs: startedAt,
                        endMs: tick,
                        sourceTrack,
                        sourceChannel: channel
                    });
                }
            }
        }

        return { notes, tempoEvents, lyrics, title };
    }

    /** @param {SongLibraryNote[]} notes */
    function selectMidiTrack(notes) {
        const nonDrum = notes.filter(note => note.sourceChannel !== 9);
        const candidates = nonDrum.length ? nonDrum : notes;
        const firstTrack = candidates.reduce((min, note) => Math.min(min, note.sourceTrack ?? 0), Infinity);
        return candidates.filter(note => note.sourceTrack === firstTrack);
    }

    /** @param {Array<{ tick: number, microsecondsPerQuarter: number }>} tempoEvents */
    function buildTempoMap(tempoEvents) {
        const map = tempoEvents
            .filter(event => event.microsecondsPerQuarter > 0)
            .sort((a, b) => a.tick - b.tick);
        if (!map.length || map[0].tick !== 0) map.unshift({ tick: 0, microsecondsPerQuarter: 500000 });
        return map;
    }

    /**
     * @param {number} tick
     * @param {Array<{ tick: number, microsecondsPerQuarter: number }>} tempoMap
     * @param {number} division
     */
    function ticksToMs(tick, tempoMap, division) {
        let ms = 0;
        for (let i = 0; i < tempoMap.length; i++) {
            const current = tempoMap[i];
            const nextTick = tempoMap[i + 1] ? tempoMap[i + 1].tick : tick;
            const segmentEnd = Math.min(tick, nextTick);
            if (segmentEnd > current.tick) {
                ms += ((segmentEnd - current.tick) * current.microsecondsPerQuarter) / division / 1000;
            }
            if (tick < nextTick) break;
        }
        return ms;
    }

    /** @param {string} text @param {string} fallbackTitle */
    function parseMusicXml(text, fallbackTitle) {
        const documentXml = new DOMParser().parseFromString(text, 'application/xml');
        if (documentXml.querySelector('parsererror')) throw new Error('MusicXML could not be parsed');
        const title = textContent(documentXml.querySelector('movement-title'))
            || textContent(documentXml.querySelector('work-title'))
            || fallbackTitle;
        const tempoBpm = readMusicXmlTempo(documentXml);
        const parts = Array.from(documentXml.querySelectorAll('part'));
        if (!parts.length) throw new Error('MusicXML has no parts');

        const parsedParts = parts.map(part => parseMusicXmlPart(part, tempoBpm));
        const selected = parsedParts.sort((a, b) => b.notes.length - a.notes.length)[0];
        return {
            title,
            tempoBpm,
            notes: selected.notes,
            lyricLines: selected.lyricLines
        };
    }

    /** @param {Document} documentXml */
    function readMusicXmlTempo(documentXml) {
        const sound = documentXml.querySelector('sound[tempo]');
        if (sound) {
            const tempo = Number(sound.getAttribute('tempo'));
            if (tempo > 0) return tempo;
        }
        const perMinute = textContent(documentXml.querySelector('metronome per-minute'));
        const tempo = Number(perMinute);
        return tempo > 0 ? tempo : DEFAULT_TEMPO_BPM;
    }

    /** @param {Element} part @param {number} tempoBpm */
    function parseMusicXmlPart(part, tempoBpm) {
        /** @type {SongLibraryNote[]} */
        const notes = [];
        /** @type {SongLibraryLyricLine[]} */
        const lyricLines = [];
        let divisions = 1;
        let cursorDivs = 0;
        let measureNumber = 0;

        Array.from(part.children).forEach(measure => {
            if (measure.tagName !== 'measure') return;
            measureNumber = Number(measure.getAttribute('number')) || measureNumber + 1;

            Array.from(measure.children).forEach(child => {
                if (child.tagName === 'attributes') {
                    const nextDivisions = Number(textContent(child.querySelector('divisions')));
                    if (nextDivisions > 0) divisions = nextDivisions;
                    return;
                }
                if (child.tagName === 'backup') {
                    cursorDivs -= Number(textContent(child.querySelector('duration'))) || 0;
                    return;
                }
                if (child.tagName === 'forward') {
                    cursorDivs += Number(textContent(child.querySelector('duration'))) || 0;
                    return;
                }
                if (child.tagName !== 'note') return;

                const durationDivs = Number(textContent(child.querySelector('duration'))) || 0;
                const isChord = !!child.querySelector('chord');
                const startDivs = isChord ? cursorDivs - durationDivs : cursorDivs;
                const pitch = child.querySelector('pitch');
                if (pitch && !child.querySelector('rest')) {
                    const midi = musicXmlPitchToMidi(pitch);
                    const startMs = divsToMs(startDivs, divisions, tempoBpm);
                    const endMs = divsToMs(startDivs + durationDivs, divisions, tempoBpm);
                    const lyric = textContent(child.querySelector('lyric text'));
                    notes.push({
                        midi,
                        startMs: Math.round(startMs),
                        endMs: Math.round(endMs),
                        lyric: lyric || undefined,
                        measure: measureNumber
                    });
                    if (lyric) lyricLines.push({ timeMs: Math.round(startMs), text: lyric });
                }
                if (!isChord) cursorDivs += durationDivs;
            });
        });

        return { notes, lyricLines };
    }

    /** @param {Element} pitch */
    function musicXmlPitchToMidi(pitch) {
        const step = textContent(pitch.querySelector('step'));
        const alter = Number(textContent(pitch.querySelector('alter'))) || 0;
        const octave = Number(textContent(pitch.querySelector('octave')));
        const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step];
        if (base === undefined || !Number.isFinite(octave)) throw new Error('Bad MusicXML pitch');
        return (octave + 1) * 12 + base + alter;
    }

    /** @param {number} divs @param {number} divisions @param {number} tempoBpm */
    function divsToMs(divs, divisions, tempoBpm) {
        const quarterMs = 60000 / tempoBpm;
        return (divs / divisions) * quarterMs;
    }

    /** @param {Uint8Array} bytes @param {number} [offset] */
    function makeByteReader(bytes, offset = 0) {
        return {
            offset,
            readU8() {
                if (this.offset >= bytes.length) throw new Error('Unexpected end of file');
                return bytes[this.offset++];
            },
            readU16() {
                return (this.readU8() << 8) | this.readU8();
            },
            readU32() {
                return (this.readU8() * 0x1000000) + (this.readU8() << 16) + (this.readU8() << 8) + this.readU8();
            },
            readAscii(length) {
                const value = decodeBytes(bytes.slice(this.offset, this.offset + length));
                this.offset += length;
                return value;
            },
            readVarLen() {
                let value = 0;
                for (let i = 0; i < 4; i++) {
                    const byte = this.readU8();
                    value = (value << 7) | (byte & 0x7F);
                    if ((byte & 0x80) === 0) return value;
                }
                throw new Error('Bad MIDI variable length value');
            },
            skip(length) {
                this.offset += Math.max(0, length);
                if (this.offset > bytes.length) throw new Error('Unexpected end of file');
            }
        };
    }

    /** @param {Uint8Array} bytes */
    function decodeBytes(bytes) {
        return new TextDecoder('utf-8').decode(bytes);
    }

    /** @param {Element | null} el */
    function textContent(el) {
        return el && el.textContent ? el.textContent.trim() : '';
    }

    /** @param {string} fileName */
    function stripExtension(fileName) {
        return fileName.replace(/\.[^.]+$/, '');
    }

    /** @param {string} value */
    function normalizeSearch(value) {
        return value.trim().toLowerCase();
    }

    /** @param {SongLibrarySong} song @param {string} query */
    function matchesSongQuery(song, query) {
        if (!query) return true;
        return [
            song.title,
            song.sourceName,
            song.sourceType,
            song.lyricsText
        ].join(' ').toLowerCase().includes(query);
    }

    /** @param {string} value @param {number} count */
    function firstWords(value, count) {
        const words = value.split(/\s+/).filter(Boolean);
        return words.length > count ? `${words.slice(0, count).join(' ')}...` : value;
    }

    /** @param {number} ms */
    function formatMs(ms) {
        const seconds = Math.max(0, Math.round(ms / 1000));
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${String(secs).padStart(2, '0')}`;
    }

    return { install };
})();

window.PlayerSongLibrary = PlayerSongLibrary;
