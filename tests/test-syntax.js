// @ts-check
// Syntax check for JavaScript files the typecheck gate cannot see, plus
// source invariants that no browser suite asserts.
//
// tsconfig.json includes only root-level `*.js` (allowJs+checkJs), so
// `npm run typecheck` already parses every root file; re-parsing them
// here was pure redundancy. Subdirectory JS (tests/, .github/scripts/)
// is outside that include list, so `node --check` still owns it.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createReporter } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** @param {string} dir @param {string[]} out */
function collectJsFiles(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) collectJsFiles(path.join(dir, entry.name), out);
            continue;
        }
        // Root-level *.js is parsed by tsc (tsconfig include: "*.js").
        if (dir === ROOT) continue;
        if (entry.isFile() && entry.name.endsWith('.js')) out.push(path.join(dir, entry.name));
    }
}

(async () => {
    const report = createReporter('javascript syntax');
    const files = [];
    collectJsFiles(ROOT, files);
    files.sort();

    for (const file of files) {
        const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        const relative = path.relative(ROOT, file);
        report.check(`${relative} parses`, result.status === 0);
        if (result.status !== 0) {
            report.errors.push(result.stderr || result.stdout || `${relative} failed node --check`);
        }
    }

    const staffView = fs.readFileSync(path.join(ROOT, 'staff-view.js'), 'utf8');
    const manualAccidental = /addAccidental|new\s+VF\.Accidental/.test(staffView);
    report.check('staff notation lets VexFlow own accidental glyph layout', !manualAccidental);
    if (manualAccidental) {
        report.errors.push('staff-view.js must not manually attach accidental glyphs; spell keys and use applyAccidentals once');
    }
    const usesQuarterNotes = /duration:\s*'q'/.test(staffView);
    report.check('staff notation renders phrase pitches as plain quarter notes', usesQuarterNotes);
    if (!usesQuarterNotes) {
        report.errors.push('staff-view.js should use plain quarter-note glyphs (no flags/beams) for the phrase staff');
    }

    // Every tab defaults to the same output level: numeric volume literals
    // live only in audio-volume.js. The media-session keep-alive is exempt
    // because its element plays digital silence, not audible output.
    const VOLUME_OWNERS = new Set(['audio-volume.js', 'media-session-core.js']);
    const volumeLiteral = /\bvolume\s*[:=]\s*-?\d|setVolume\(\s*\d/;
    const rootJs = fs.readdirSync(ROOT).filter(name => name.endsWith('.js')).sort();
    for (const name of rootJs) {
        if (VOLUME_OWNERS.has(name)) continue;
        const source = fs.readFileSync(path.join(ROOT, name), 'utf8');
        const hardcodes = volumeLiteral.test(source);
        report.check(`${name} takes its output level from audio-volume.js`, !hardcodes);
        if (hardcodes) {
            report.errors.push(`${name} hardcodes a volume literal; use AudioVolume constants instead`);
        }
    }

    // Each audio page must load audio-volume.js before any script that
    // reads it at parse or setup time.
    const AUDIO_PAGES = ['scales.html', 'intervals.html', 'phrases.html', 'trace.html',
        'pitch-meter.html', 'staff.html', 'player.html', 'ebook.html'];
    const consumerScript = /<script src="(piano-core|voice-output|ebook|player-playlist)\.js/;
    for (const page of AUDIO_PAGES) {
        const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
        const ownerAt = html.search(/<script src="audio-volume\.js/);
        const consumerAt = html.search(consumerScript);
        const ordered = ownerAt !== -1 && consumerAt !== -1 && ownerAt < consumerAt;
        report.check(`${page} loads audio-volume.js before its audio scripts`, ordered);
        if (!ordered) {
            report.errors.push(`${page} must include audio-volume.js before piano-core/voice-output/page audio scripts`);
        }
    }

    const phrases = fs.readFileSync(path.join(ROOT, 'phrases.js'), 'utf8');
    const directPhrasePianoCalls = [...phrases.matchAll(/piano\.playMidi/g)].length;
    const phraseAudioBoundaryCalls = [...phrases.matchAll(/phraseAudio\.(playPhraseMidi|playGuideMidi)/g)].length;
    report.check('phrases routes piano sound through its audio boundary',
        directPhrasePianoCalls === 2 && phraseAudioBoundaryCalls >= 2);
    if (directPhrasePianoCalls !== 2) {
        report.errors.push('phrases.js must not call piano.playMidi outside the private phraseAudio boundary');
    }

    report.finish();
})();
