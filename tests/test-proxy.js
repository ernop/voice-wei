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

/**
 * Call one proxy.php function on fixture input with no network: the script
 * includes proxy.php (defining its functions, then answering a parameterless
 * request whose output is discarded) and prints the call's JSON result.
 * @param {string} fn
 * @param {unknown[]} args
 * @param {{ backtrackLimit?: number }} [options]
 */
function callProxyFunction(fn, args, options = {}) {
    const script = [
        "$_SERVER['REQUEST_METHOD'] = 'GET';",
        'ob_start(); include $argv[1]; ob_end_clean();',
        '$job = json_decode(stream_get_contents(STDIN), true);',
        "if (isset($job['backtrackLimit'])) ini_set('pcre.backtrack_limit', (string) $job['backtrackLimit']);",
        "echo json_encode(call_user_func_array($job['fn'], $job['args']));"
    ].join(' ');
    const result = spawnSync('php', ['-r', script, PROXY_PATH], {
        cwd: ROOT,
        encoding: 'utf8',
        input: JSON.stringify({ fn, args, ...options }),
        maxBuffer: 64 * 1024 * 1024
    });
    return {
        value: result.status === 0 && result.stdout ? JSON.parse(result.stdout) : null,
        failure: result.status === 0 && !result.stderr ? '' : `${fn} exited ${result.status}: ${result.stderr}`
    };
}

/**
 * The readUrl answer ([status, body]) for a fetched fixture page.
 * @param {string} body
 * @param {{ contentType?: string, backtrackLimit?: number }} [options]
 */
function readFixturePage(body, options = {}) {
    const { contentType = 'text/html; charset=utf-8', ...callOptions } = options;
    const url = 'https://example.test/page';
    const result = callProxyFunction('readablePageAnswer', [url, url, contentType, body], callOptions);
    const [status, answer] = result.value || [0, {}];
    return { status, answer, failure: result.failure };
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

    const selfTest = invokeProxy('test=1');
    const smokeScript = fs.readFileSync(path.join(ROOT, 'deploy', 'smoke-live.sh'), 'utf8');
    const smokeSignature = (smokeScript.match(/\*"([^"*]+)"\*\) smoke_failed "this app's proxy\.php answers at the host root"/) || [])[1] || '';
    report.check(`the deploy smoke check still recognizes this proxy by its self-test text ("${smokeSignature}")`,
        smokeSignature !== ''
        && String(JSON.parse(selfTest.stdout).status).includes(smokeSignature)
        && JSON.parse(selfTest.stdout).curl_available === true);
    if (selfTest.status !== 0 || selfTest.stderr) {
        report.errors.push(selfTest.stderr || `proxy self-test exited ${selfTest.status}`);
    }

    // ============ PAGE IMPORT: the text Books and linked-page music read ============
    const readBlockStart = source.indexOf('// Page-read mode:');
    const readBlock = source.slice(readBlockStart, source.indexOf('// Asset passthrough:', readBlockStart));
    report.check('readUrl answers through the tested readablePageAnswer boundary',
        readBlock.includes("readablePageAnswer($url, $requestedUrl, $result['contentType'], $body)"));

    // Shaped like a large Wikipedia album article: site chrome first, then a
    // content container over a megabyte long. A lazy capture of that
    // container exhausted PCRE's backtrack limit and imported the chrome.
    const filler = '<p>The sessions ran long, and the band recorded through the night.</p>'.repeat(17000);
    const wikipediaShaped = [
        '<html><head><title>Rumours (album) - Wikipedia</title></head><body>',
        '<nav>Contents Toggle the table of contents 64 languages Afrikaans Deutsch</nav>',
        '<main><div id="mw-content-text" class="mw-body-content">',
        '<p>Rumours is the eleventh studio album by\nFleetwood Mac.</p>',
        '<table class="tracklist"><caption>Side one</caption><tbody>',
        '<tr><th>No.</th><th>Title</th><th>Writer(s)</th><th>Length</th></tr>',
        '<tr><td>1.</td><td>"Second Hand News"</td><td>Lindsey Buckingham</td><td>2:43</td></tr>',
        '<tr><td>2.</td><td>"Dreams"</td><td>Stevie Nicks</td><td>4:14</td></tr>',
        '</tbody></table>',
        filler,
        '</div><div class="printfooter">Retrieved from Wikipedia</div></main></body></html>'
    ].join('');
    const wikipedia = readFixturePage(wikipediaShaped);
    const wikipediaText = String(wikipedia.answer.text || '');
    report.check(`large Wikipedia-shaped page narrows to its article (${wikipediaShaped.length} bytes)`,
        wikipediaShaped.length > 1100000
        && wikipedia.status === 200
        && wikipediaText.startsWith('Rumours is the eleventh studio album by Fleetwood Mac.')
        && !wikipediaText.includes('Afrikaans')
        && !wikipediaText.includes('table of contents')
        && !wikipediaText.includes('Retrieved from')
        && wikipedia.answer.title === 'Rumours (album) - Wikipedia');
    report.check('tracklist rows arrive as lines with tab-separated cells',
        wikipediaText.includes([
            'Side one',
            '',
            'No.\tTitle\tWriter(s)\tLength',
            '1.\t"Second Hand News"\tLindsey Buckingham\t2:43',
            '2.\t"Dreams"\tStevie Nicks\t4:14'
        ].join('\n')));
    report.check('readable text over the cap is truncated at a character boundary',
        wikipedia.answer.truncated === true
        && wikipedia.answer.charCount <= 800000
        && wikipedia.answer.originalCharCount > 800000);

    const listPage = readFixturePage([
        '<html><body><header>Site menu</header><article>',
        '<h2>Songs of the week</h2>',
        '<ol><li>Hey Jude &ndash; The Beatles<li>Dreams &ndash; Fleetwood Mac</ol>',
        '<p>First line\n   continues here</p><p>1. Song One<br>2. Song Two</p>',
        '<script>var hidden = "Not A Song";</script><style>.x { color: red; }</style>',
        '<!-- Commented Song --><p>Visible&nbsp;Song</p>',
        '</article></body></html>'
    ].join(''));
    report.check('list items, line breaks, and paragraphs keep their lines; source newlines do not',
        listPage.status === 200
        && listPage.answer.text === [
            'Songs of the week',
            '',
            'Hey Jude \u2013 The Beatles',
            'Dreams \u2013 Fleetwood Mac',
            '',
            'First line continues here',
            '',
            '1. Song One',
            '2. Song Two',
            '',
            'Visible Song'
        ].join('\n'));

    const plainText = readFixturePage(
        'Setlist\r\n\r\n1. Airbag\r\n2. Paranoid  Android\n\n\n\nEncore:\n3. Lucky\n',
        { contentType: 'text/plain; charset=utf-8' }
    );
    report.check('plain-text pages keep their own lines and paragraphs',
        plainText.status === 200
        && plainText.answer.text === 'Setlist\n\n1. Airbag\n2. Paranoid Android\n\nEncore:\n3. Lucky'
        && plainText.answer.title === ''
        && plainText.answer.links.length === 0
        && plainText.answer.structuredData.length === 0);

    const albumJsonLd = {
        '@context': 'http://schema.org',
        '@type': 'MusicAlbum',
        name: 'Rumours',
        byArtist: [{ '@type': 'MusicGroup', name: 'Fleetwood Mac' }],
        tracks: [
            { '@type': 'MusicRecording', name: 'Second Hand News' },
            { '@type': 'MusicRecording', name: 'Dreams' }
        ]
    };
    const structured = readFixturePage([
        '<html><head>',
        `<script type="application/ld+json">${JSON.stringify(albumJsonLd)}</script>`,
        '<script type="application/ld+json">{ not json </script>',
        '</head><body><main><p>Rumours by Fleetwood Mac</p></main></body></html>'
    ].join(''));
    report.check('JSON-LD blocks pass through parsed; invalid blocks carry no data',
        structured.status === 200
        && structured.answer.structuredData.length === 1
        && structured.answer.structuredData[0]['@type'] === 'MusicAlbum'
        && structured.answer.structuredData[0].tracks[1].name === 'Dreams'
        && structured.answer.text === 'Rumours by Fleetwood Mac');

    const emptyPage = readFixturePage('<html><body><main><script>app()</script></main></body></html>');
    report.check('a page with no readable text still answers 422',
        emptyPage.status === 422
        && emptyPage.answer.error === 'No readable text found on linked page');

    const exhausted = readFixturePage(
        `<html><body><main><script>${'x'.repeat(10000)}</script><p>Text</p></main></body></html>`,
        { backtrackLimit: 100 }
    );
    report.check('a regex engine failure is a loud 500 naming the page, never silently degraded text',
        exhausted.status === 500
        && String(exhausted.answer.error).startsWith('Could not extract readable text from https://example.test/page: Backtrack limit exhausted'));

    const prefixes = [3, 5].map(maxBytes => callProxyFunction('utf8Prefix', ['ab\u2013cd', maxBytes]));
    report.check('utf8Prefix never splits a multibyte character',
        prefixes[0].value === 'ab' && prefixes[1].value === 'ab\u2013');

    for (const result of [wikipedia, listPage, plainText, structured, emptyPage, exhausted, ...prefixes]) {
        if (result.failure) report.errors.push(result.failure);
    }

    report.finish();
})();
