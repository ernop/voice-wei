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

    report.finish();
})();
