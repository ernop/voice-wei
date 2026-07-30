// @ts-check
// Focused proxy routing, validation, and fixed-provider security contracts.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createReporter } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PROXY_PATH = path.join(ROOT, 'proxy.php');

/** @param {string} query @param {string} [method] */
function invokeProxy(query, method = 'GET') {
    const script = `$_SERVER['REQUEST_METHOD']=$argv[1]; parse_str($argv[2], $_GET); include $argv[3];`;
    const result = spawnSync('php', ['-r', script, method, query, PROXY_PATH], {
        cwd: ROOT,
        encoding: 'utf8'
    });
    return {
        status: result.status,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
    };
}

(async () => {
    const report = createReporter('same-origin proxy');
    const syntax = spawnSync('php', ['-l', PROXY_PATH], { cwd: ROOT, encoding: 'utf8' });
    report.check('proxy PHP parses', syntax.status === 0);
    if (syntax.status !== 0) report.errors.push(syntax.stderr || syntax.stdout);

    const missingTrack = invokeProxy('lyrics=search&artist_name=Only+Artist');
    const unknownOperation = invokeProxy('lyrics=download&track_name=Song');
    const arrayIdentity = invokeProxy('lyrics=search&track_name[]=Song');
    const oversizedIdentity = invokeProxy(`lyrics=search&track_name=${'x'.repeat(301)}`);
    const post = invokeProxy('lyrics=search&track_name=Song', 'POST');
    report.check('lyrics proxy rejects malformed identity requests before outbound work',
        JSON.parse(missingTrack.stdout).error === 'Lyrics search requires track_name'
        && JSON.parse(unknownOperation.stdout).error === 'Unknown lyrics operation'
        && JSON.parse(arrayIdentity.stdout).error === 'Lyrics search identity must be text'
        && JSON.parse(oversizedIdentity.stdout).error === 'Lyrics search identity is too long');
    report.check('proxy remains GET-only',
        JSON.parse(post.stdout).error === 'Only GET requests are accepted');
    for (const result of [missingTrack, unknownOperation, arrayIdentity, oversizedIdentity, post]) {
        if (result.status !== 0 || result.stderr) {
            report.errors.push(result.stderr || `proxy invocation exited ${result.status}`);
        }
    }

    const source = fs.readFileSync(PROXY_PATH, 'utf8');
    const lyricsStart = source.indexOf('// Fixed-provider lyrics search:');
    const lyricsEnd = source.indexOf('// Test mode:', lyricsStart);
    const lyricsBlock = source.slice(lyricsStart, lyricsEnd);
    report.check('lyrics proxy pins LRCLIB and accepts identity fields rather than an outbound URL',
        lyricsBlock.includes("'https://lrclib.net/api/search?'")
        && lyricsBlock.includes("$_GET['track_name']")
        && lyricsBlock.includes("$_GET['artist_name']")
        && !lyricsBlock.includes("$_GET['url']")
        && !lyricsBlock.includes("$_GET['readUrl']"));
    report.check('lyrics proxy preserves the 12-second, bounded-JSON provider contract',
        lyricsBlock.includes("requestPublicUrl($url, 'application/json', 2000000, 12)")
        && lyricsBlock.includes('json_decode($body, true)')
        && lyricsBlock.includes("http_response_code($timedOut ? 504 : 502)"));

    report.finish();
})();
