// @ts-check
// Owner display rules, declared half: no stylesheet sets a gray or
// translucent text color or dims text with partial opacity. Every served
// sheet is checked, so a new one is covered without being listed. What
// pages render is checked by installGrayTextScan (helpers.js) in each
// page's suite.

const fs = require('fs');
const path = require('path');
const { createReporter, grayTextDeclarations } = require('./helpers');

const root = path.join(__dirname, '..');
const sheets = fs.readdirSync(root).filter(name => name.endsWith('.css')).sort();

const report = createReporter('display rules');
report.check(`the site has stylesheets to check (${sheets.length})`, sheets.length >= 10);
for (const sheet of sheets) {
    const gray = grayTextDeclarations(fs.readFileSync(path.join(root, sheet), 'utf8'));
    report.check(`${sheet} declares no gray, translucent, or dimmed text (${gray.join(', ') || 'none'})`, gray.length === 0);
}
report.finish();
