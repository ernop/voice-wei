// @ts-check
// Runs browser suites against a local static server.
// Usage:
//   npm test                 # fast default: syntax + smoke + CSS ownership
//   npm run test:full        # slower audio/mic/playback end-to-end coverage
//   node tests/run-all.js --suite test-controls.js
// Requires: npm install and npx playwright install chromium.

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = process.env.TEST_PORT || '8000';
const ROOT = path.join(__dirname, '..');

const FAST_SUITES = [
    'test-syntax.js',
    'test-css-ownership.js',
    'test-pages-load.js',
    'test-books.js'
];

const FULL_SUITES = [
    ...FAST_SUITES,
    'test-playback-engine.js',
    'test-controls.js',
    'test-functions.js'
];

function suitesForArgs(args) {
    const suiteIndex = args.indexOf('--suite');
    if (suiteIndex !== -1) {
        const suite = args[suiteIndex + 1];
        if (!suite) throw new Error('--suite requires a file name');
        return { profile: 'custom', suites: [suite] };
    }
    if (args.includes('--full')) return { profile: 'full', suites: FULL_SUITES };
    return { profile: 'fast', suites: FAST_SUITES };
}

function serverUp() {
    return new Promise(resolve => {
        http.get(`http://localhost:${PORT}/index.html`, res => resolve(res.statusCode === 200))
            .on('error', () => resolve(false));
    });
}

async function main() {
    const { profile, suites } = suitesForArgs(process.argv.slice(2));
    let server = null;
    if (!(await serverUp())) {
        server = spawn('python3', ['-m', 'http.server', PORT], { cwd: ROOT, stdio: 'ignore' });
        for (let i = 0; i < 20 && !(await serverUp()); i++) {
            await new Promise(r => setTimeout(r, 250));
        }
    }

    let failures = 0;
    console.log(`Running ${profile} test profile (${suites.join(', ')})`);
    if (profile === 'fast') {
        const results = await Promise.all(suites.map(suite => runSuite(suite, profile)));
        failures = results.filter(status => status !== 0).length;
    } else {
        for (const suite of suites) {
            const status = spawnSuite(suite, profile);
            if (status !== 0) failures++;
        }
    }

    if (server) server.kill();
    console.log(failures ? `\n${failures} suite(s) FAILED` : '\nAll suites passed');
    process.exit(failures ? 1 : 0);
}

function spawnSuite(suite, profile) {
    console.log(`\n========== ${suite} ==========`);
    const result = spawnSync('node', [path.join(__dirname, suite)], {
        stdio: 'inherit',
        env: { ...process.env, TEST_BASE_URL: `http://localhost:${PORT}`, TEST_PROFILE: profile }
    });
    return result.status || 0;
}

function runSuite(suite, profile) {
    return new Promise(resolve => {
        console.log(`\n========== ${suite} ==========`);
        const child = spawn('node', [path.join(__dirname, suite)], {
            stdio: 'inherit',
            env: { ...process.env, TEST_BASE_URL: `http://localhost:${PORT}`, TEST_PROFILE: profile }
        });
        child.on('close', code => resolve(code || 0));
        child.on('error', () => resolve(1));
    });
}

main();
