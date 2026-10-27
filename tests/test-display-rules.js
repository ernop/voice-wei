// @ts-check
// Owner display rules, declared half: these stylesheets set no gray or
// translucent text color. What pages render is checked by
// installGrayTextScan (helpers.js) in each page's suite. A sheet joins
// CLEAN_SHEETS once it is clean, and the list only grows.

const fs = require('fs');
const path = require('path');
const { createReporter, grayTextDeclarations } = require('./helpers');

const CLEAN_SHEETS = [
    'games.css',
    'media-player.css',
    'piano-keyboard.css',
    'player.css',
    'practice-controls.css',
    'scales.css',
    'wording.css'
];

const report = createReporter('display rules');
for (const sheet of CLEAN_SHEETS) {
    const gray = grayTextDeclarations(fs.readFileSync(path.join(__dirname, '..', sheet), 'utf8'));
    report.check(`${sheet} declares no gray or translucent text colors (${gray.join(', ') || 'none'})`, gray.length === 0);
}
report.finish();
