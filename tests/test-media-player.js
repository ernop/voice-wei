// @ts-check
// The shared media player (docs/architecture.md, "The shared media player"):
// the copy at the root is the library's files, unedited (media-player.sha256),
// and no page hands the Media Session to both the player and
// media-session-core.js. No browser and no network.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createReporter } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const FILES = ['media-player.js', 'media-player.css'];
const CHECKSUMS = 'media-player.sha256';

/** @param {string} relative */
function read(relative) {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

(() => {
    const report = createReporter('shared media player');

    //-------COPY-------
    // Deploys ship only top-level files, so the copy lives at the root.
    const present = FILES.filter(file => fs.existsSync(path.join(ROOT, file)));
    report.check('media-player.js and media-player.css are at the root', present.length === FILES.length);
    /** @type {Map<string, string>} */
    const checksums = new Map();
    if (fs.existsSync(path.join(ROOT, CHECKSUMS))) {
        for (const line of read(CHECKSUMS).split(/\r?\n/).filter(Boolean)) {
            const [digest, name] = line.split(/\s+\*?/);
            checksums.set(name, digest);
        }
    }
    report.check(`${CHECKSUMS} lists both files`, checksums.size === FILES.length && FILES.every(file => checksums.has(file)));
    for (const file of present) {
        // Git may check text files out with CRLF line endings on Windows.
        const data = Buffer.from(fs.readFileSync(path.join(ROOT, file)).toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
        const same = crypto.createHash('sha256').update(data).digest('hex') === checksums.get(file);
        report.check(`${file} is the library's file, unedited`, same);
        if (!same) {
            report.errors.push(`${file} differs from ${CHECKSUMS}: change the media-player library, then run its copy-into.sh here (it rewrites the checksums), npm test and ./bump-version.sh`);
        }
    }

    //-------PAGES-------
    const pages = fs.readdirSync(ROOT).filter(name => name.endsWith('.html'));
    const users = pages.filter(page => /src="media-player\.js[?"]/.test(read(page)));
    report.check(`Books loads the player (pages: ${users.join(', ') || 'none'})`, users.includes('ebook.html'));
    const unstyled = users.filter(page => !/href="media-player\.css[?"]/.test(read(page)));
    report.check('every page with the player loads its stylesheet', unstyled.length === 0);
    unstyled.forEach(page => report.errors.push(`${page} loads media-player.js without media-player.css`));
    const both = users.filter(page => /src="media-session-core\.js[?"]/.test(read(page)));
    report.check('no page loads both the player and media-session-core.js (one Media Session owner)', both.length === 0);
    both.forEach(page => report.errors.push(`${page} loads both media-player.js and media-session-core.js`));

    report.finish();
})();
