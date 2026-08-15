// @ts-check
// Runs every browser suite in parallel against a local static server.
// Usage:
//   npm test                                  # the whole gate
//   node tests/run-all.js --suite <file>      # one suite
// Requires: npm install and a Chromium (CHROME_PATH or Playwright's).

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = process.env.TEST_PORT || '8000';
const ROOT = path.join(__dirname, '..');

// test-player-startup.js measures wall-clock readiness, so it runs alone
// before the parallel pack to keep CPU contention out of its numbers.
const ISOLATED_SUITES = ['test-player-startup.js'];
// Ordered longest-first so the worker pool drains evenly.
const PARALLEL_SUITES = [
    'test-books.js',
    'test-phrases.js',
    'test-controls.js',
    'test-playback-engine.js',
    'test-intervals-pitch.js',
    'test-staff-page.js',
    'test-staff-view.js',
    'test-player-live.js',
    'test-pages-load.js',
    'test-player-playlist.js',
    'test-scales-trace.js',
    'test-player-search.js',
    'test-player-report.js',
    'test-player-lifecycle.js',
    'test-proxy.js',
    'test-coolness.js',
    'test-articles.js',
    'test-syntax.js',
    'test-css-ownership.js'
];

// Enough workers to hide per-suite waits without starving the CPUs that
// real-time playback checks depend on.
const WORKERS = Number(process.env.TEST_WORKERS || 6);

function suitesForArgs(args) {
    const suiteIndex = args.indexOf('--suite');
    if (suiteIndex !== -1) {
        const suite = args[suiteIndex + 1];
        if (!suite) throw new Error('--suite requires a file name');
        return { isolated: [], parallel: [suite] };
    }
    return { isolated: ISOLATED_SUITES, parallel: PARALLEL_SUITES };
}

/**
 * Run suites through a fixed-size worker pool, longest-first so the pool
 * drains evenly.
 * @param {string[]} suites
 * @returns {Promise<Array<{ suite: string, status: number, seconds: number }>>}
 */
async function runPool(suites) {
    const queue = [...suites];
    const results = [];
    await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, async () => {
        while (queue.length > 0) {
            const suite = queue.shift();
            if (!suite) break;
            results.push(await runSuite(suite));
        }
    }));
    return results;
}

function serverUp() {
    return new Promise(resolve => {
        http.get(`http://localhost:${PORT}/index.html`, res => resolve(res.statusCode === 200))
            .on('error', () => resolve(false));
    });
}

async function main() {
    const startedAt = Date.now();
    const { isolated, parallel } = suitesForArgs(process.argv.slice(2));
    let server = null;
    if (!(await serverUp())) {
        server = spawn('python3', ['-m', 'http.server', PORT], { cwd: ROOT, stdio: 'ignore' });
        for (let i = 0; i < 20 && !(await serverUp()); i++) {
            await new Promise(r => setTimeout(r, 250));
        }
    }

    console.log(`Running ${isolated.length + parallel.length} suites (${Math.min(WORKERS, parallel.length)} workers)`);
    /** @type {Array<{ suite: string, status: number, seconds: number }>} */
    const results = [];
    for (const suite of isolated) {
        results.push(await runSuite(suite));
    }
    results.push(...await runPool(parallel));

    if (server) server.kill();
    const failures = results.filter(result => result.status !== 0);
    const slowest = [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 3)
        .map(result => `${result.suite} ${result.seconds.toFixed(1)}s`)
        .join(', ');
    console.log(`\nWall time ${((Date.now() - startedAt) / 1000).toFixed(1)}s; slowest: ${slowest}`);
    console.log(failures.length
        ? `${failures.length} suite(s) FAILED: ${failures.map(result => result.suite).join(', ')}`
        : 'All suites passed');
    process.exit(failures.length ? 1 : 0);
}

/** @param {string} suite @returns {Promise<{ suite: string, status: number, seconds: number }>} */
function runSuite(suite) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const chunks = [];
        const child = spawn('node', [path.join(__dirname, suite)], {
            env: { ...process.env, TEST_BASE_URL: `http://localhost:${PORT}` }
        });
        child.stdout.on('data', chunk => chunks.push(chunk));
        child.stderr.on('data', chunk => chunks.push(chunk));
        const finish = (status) => {
            const seconds = (Date.now() - startedAt) / 1000;
            console.log(`\n========== ${suite} (${seconds.toFixed(1)}s) ==========`);
            process.stdout.write(Buffer.concat(chunks));
            resolve({ suite, status, seconds });
        };
        child.on('close', code => finish(code || 0));
        child.on('error', () => finish(1));
    });
}

main();
