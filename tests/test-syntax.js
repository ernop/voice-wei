// @ts-check
// Fast syntax check for every checked-in JavaScript file.

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
    report.check('staff notation renders phrase pitches as quarter notes', usesQuarterNotes);
    if (!usesQuarterNotes) {
        report.errors.push('staff-view.js should use quarter-note glyphs for the phrase staff');
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
