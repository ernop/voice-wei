// @ts-check
// Runs the whole suite against a local static server.
// Usage: npm test  (or: node tests/run-all.js)
// Requires: Chrome installed (or CHROME_PATH env), npm install done.

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = process.env.TEST_PORT || '8000';
const ROOT = path.join(__dirname, '..');

const SUITES = [
    'test-css-ownership.js',
    'test-pages-load.js',
    'test-playback-engine.js',
    'test-controls.js',
    'test-functions.js'
];

function serverUp() {
    return new Promise(resolve => {
        http.get(`http://localhost:${PORT}/index.html`, res => resolve(res.statusCode === 200))
            .on('error', () => resolve(false));
    });
}

async function main() {
    let server = null;
    if (!(await serverUp())) {
        server = spawn('python3', ['-m', 'http.server', PORT], { cwd: ROOT, stdio: 'ignore' });
        for (let i = 0; i < 20 && !(await serverUp()); i++) {
            await new Promise(r => setTimeout(r, 250));
        }
    }

    let failures = 0;
    for (const suite of SUITES) {
        console.log(`\n========== ${suite} ==========`);
        const result = spawnSync('node', [path.join(__dirname, suite)], {
            stdio: 'inherit',
            env: { ...process.env, TEST_BASE_URL: `http://localhost:${PORT}` }
        });
        if (result.status !== 0) failures++;
    }

    if (server) server.kill();
    console.log(failures ? `\n${failures} suite(s) FAILED` : '\nAll suites passed');
    process.exit(failures ? 1 : 0);
}

main();
