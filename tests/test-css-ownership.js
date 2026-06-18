// @ts-check
// Page stylesheets must not redefine the look of classes owned by
// practice-controls.css (or the shared voice-shell classes in style.css).
// Pages may add layout on top of shared classes in two ways only:
//   - scoping under page context: `.pitch-controls .listen-button { flex: 1 }`
//   - page modifier classes:      `.vf-row.vf-row-reset { margin-top: 8px }`
// What they may NOT do is restate the bare class: `.next-button { ... }`.
// That is exactly how the ears/practice-controls drift happened.

const fs = require('fs');
const path = require('path');
const { createReporter } = require('./helpers');

const ROOT = path.join(__dirname, '..');

// Shared classes defined in style.css that pages also must not redefine
const STYLE_CSS_SHARED = ['listen-button', 'submit-button-large', 'button-text', 'button-icon'];

const PAGE_SHEETS = ['scales.css', 'intervals.css', 'phrases.css', 'trace.css', 'pitch-meter.css'];

/** Strip comments, then return every selector list in the sheet (media blocks included). */
function extractSelectors(css) {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [];
    // Walk brace-delimited blocks; selector text is whatever precedes a "{"
    // that is not an at-rule header.
    const re = /([^{}]+)\{/g;
    let m;
    while ((m = re.exec(noComments)) !== null) {
        const text = m[1].trim();
        if (!text || text.startsWith('@')) continue;
        for (const part of text.split(',')) {
            const sel = part.trim();
            if (sel) selectors.push(sel);
        }
    }
    return selectors;
}

/** Classes that practice-controls.css defines (first class of each compound subject). */
function ownedClasses() {
    const css = fs.readFileSync(path.join(ROOT, 'practice-controls.css'), 'utf8');
    const owned = new Set(STYLE_CSS_SHARED);
    for (const sel of extractSelectors(css)) {
        const first = sel.split(/[\s>+~]/)[0];
        const cls = first.match(/^\.([a-zA-Z0-9_-]+)/);
        if (cls) owned.add(cls[1]);
    }
    return owned;
}

/**
 * A selector violates ownership when its first compound is exactly one
 * owned class (plus optional pseudo-classes/elements) with no page
 * modifier class and no preceding context.
 */
function violates(selector, owned) {
    const firstCompound = selector.split(/[\s>+~]/)[0];
    const classes = [...firstCompound.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map(m => m[1]);
    if (classes.length !== 1) return false; // modifier combo or no class
    if (!owned.has(classes[0])) return false;
    // Bare owned class (e.g. ".next-button", ".vf-btn:hover") as the
    // subject: redefinition. Scoped descendants were split off above only
    // if the owned class came first, which is still page-wide restyling
    // unless a page class precedes it - so flag those too.
    return firstCompound.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '') === '.' + classes[0];
}

(async () => {
    const report = createReporter('css ownership');
    const owned = ownedClasses();
    report.check(`practice-controls.css exports a vocabulary (${owned.size} classes)`, owned.size > 20);

    for (const sheet of PAGE_SHEETS) {
        const css = fs.readFileSync(path.join(ROOT, sheet), 'utf8');
        const bad = extractSelectors(css).filter(sel => violates(sel, owned));
        report.check(`${sheet} does not redefine shared controls${bad.length ? ' (' + bad.join(' | ') + ')' : ''}`,
            bad.length === 0);
    }

    report.finish();
})();
