// @ts-check
// Focused proxy routing, validation, and fixed-provider security contracts.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createReporter } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PROXY_PATH = path.join(ROOT, 'proxy.php');
const YOUTUBE_FIXTURES = path.join(__dirname, 'fixtures', 'youtube');

/**
 * A real YouTube web-API answer (captured 2026-10-20), trimmed: every path
 * the parsers read is kept, item lists are cut to three entries, and tokens
 * a parser must never follow are replaced by DECOY_* markers.
 * @param {string} name
 */
function youtubeFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(YOUTUBE_FIXTURES, name), 'utf8'));
}

/**
 * @param {string} query
 * @param {string} [method]
 * @param {string} [tempDir] system temp directory for the run (where the
 *   YouTube listing cache and budget live)
 */
function invokeProxy(query, method = 'GET', tempDir = os.tmpdir()) {
    const script = `$_SERVER['REQUEST_METHOD']=$argv[1]; parse_str($argv[2], $_GET); include $argv[3];`;
    const result = spawnSync('php', ['-r', script, method, query, PROXY_PATH], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, TMPDIR: tempDir }
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
 * With `thrown`, a YouTubeListingError the call throws becomes the value
 * ({ thrown: message, status }) instead of failing the run.
 * @param {string} fn
 * @param {unknown[]} args
 * @param {{ backtrackLimit?: number, tempDir?: string, thrown?: boolean }} [options]
 */
function callProxyFunction(fn, args, options = {}) {
    const { tempDir = os.tmpdir(), ...jobOptions } = options;
    const script = [
        "$_SERVER['REQUEST_METHOD'] = 'GET';",
        'ob_start(); include $argv[1]; ob_end_clean();',
        '$job = json_decode(stream_get_contents(STDIN), true);',
        "if (isset($job['backtrackLimit'])) ini_set('pcre.backtrack_limit', (string) $job['backtrackLimit']);",
        "try { echo json_encode(call_user_func_array($job['fn'], $job['args'])); }",
        "catch (YouTubeListingError $e) { if (empty($job['thrown'])) throw $e; echo json_encode(['thrown' => $e->getMessage(), 'status' => $e->status]); }"
    ].join(' ');
    const result = spawnSync('php', ['-r', script, PROXY_PATH], {
        cwd: ROOT,
        encoding: 'utf8',
        input: JSON.stringify({ fn, args, ...jobOptions }),
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, TMPDIR: tempDir }
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

    // ============ YOUTUBE LISTING: channels, releases, playlists, next pages ============
    // Every check here runs without network: validation answers before any
    // outbound work, parsers read trimmed real answers, and the cache and
    // budget run against a private temp directory.
    const youtubeTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-wei-proxy-test-'));
    const youtubeState = path.join(youtubeTemp, 'voice-wei-youtube');
    /** @param {string} query */
    const youtube = query => {
        const result = invokeProxy(query, 'GET', youtubeTemp);
        if (result.status !== 0 || result.stderr) {
            report.errors.push(result.stderr || `proxy ${query} exited ${result.status}`);
        }
        return JSON.parse(result.stdout || '{}');
    };
    /** @param {string} fn @param {unknown[]} args */
    const youtubeCall = (fn, args) => {
        const result = callProxyFunction(fn, args, { tempDir: youtubeTemp, thrown: true });
        if (result.failure) report.errors.push(result.failure);
        return result.value;
    };

    const invalidRequests = {
        'youtube=channel&url=https%3A%2F%2Fexample.com%2F%40kexp': 'Not a YouTube channel link',
        'youtube=channel&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DyZXpav794BY': 'Not a YouTube channel link',
        'youtube=channel&id=UCshort': 'Not a YouTube channel id',
        'youtube=releases&id=PLfsbuQF4YPohXa4nvblxJQX-_ptryBAle': 'Not a YouTube channel id',
        'youtube=playlist&id=not%20an%20id': 'Not a YouTube playlist id',
        'youtube=more&token=short': 'Not a YouTube next-page token',
        'youtube=download&id=UC3I2GFN_F8WudD_2jUZbojA': 'Unknown YouTube operation (use channel, releases, playlist, or more)',
        'youtube[]=channel': 'The youtube parameter must be text of at most 4000 characters'
    };
    const invalidAnswers = Object.entries(invalidRequests).map(([query, expected]) => ({ query, expected, answer: youtube(query) }));
    const wrongAnswers = invalidAnswers.filter(({ expected, answer }) => answer.error !== expected);
    report.check(`YouTube listing rejects malformed requests before any outbound work (${wrongAnswers.map(entry => entry.query).join(', ') || 'all rejected'})`,
        wrongAnswers.length === 0 && !fs.existsSync(path.join(youtubeState, 'budget.json')));

    const channelLinks = {
        'https://www.youtube.com/@kexp/videos': 'https://www.youtube.com/@kexp',
        'https://m.youtube.com/@kexp?si=share-tracking': 'https://www.youtube.com/@kexp',
        'https://youtube.com/c/kexp/featured': 'https://www.youtube.com/c/kexp',
        'https://www.youtube.com/user/kexpradio': 'https://www.youtube.com/user/kexpradio',
        'https://music.youtube.com/channel/UC3I2GFN_F8WudD_2jUZbojA': 'https://www.youtube.com/channel/UC3I2GFN_F8WudD_2jUZbojA',
        'https://www.youtube.com/watch?v=yZXpav794BY': null,
        'https://www.youtube.com.example.net/@kexp': null,
        'https://example.net/@kexp': null,
        'ftp://www.youtube.com/@kexp': null
    };
    const linkMismatches = Object.entries(channelLinks)
        .filter(([link, expected]) => youtubeCall('youtubeChannelUrl', [link]) !== expected)
        .map(([link]) => link);
    report.check(`channel links reduce to the channel on www.youtube.com; other hosts and video links are not channels (${linkMismatches.join(', ') || 'all as expected'})`,
        linkMismatches.length === 0);

    const kexpChannel = youtubeCall('youtubeChannelPage', [youtubeFixture('channel-kexp-playlists.json')]);
    report.check('a channel answer names the channel, its sections as upload playlists, and its first playlists',
        kexpChannel?.channel?.id === 'UC3I2GFN_F8WudD_2jUZbojA'
        && kexpChannel.channel.title === 'KEXP'
        && kexpChannel.channel.handle === '@kexp'
        && JSON.stringify(kexpChannel.sections) === JSON.stringify([
            { key: 'videos', title: 'Videos', playlistId: 'UULF3I2GFN_F8WudD_2jUZbojA' },
            { key: 'popular', title: 'Popular', playlistId: 'UULP3I2GFN_F8WudD_2jUZbojA' },
            { key: 'live', title: 'Live', playlistId: 'UULV3I2GFN_F8WudD_2jUZbojA' },
            { key: 'playlists', title: 'Playlists' }
        ])
        && kexpChannel.playlists.length === 3
        && JSON.stringify(kexpChannel.playlists[0]) === JSON.stringify({ playlistId: 'PLVkZCaO56dXU', title: 'AXEAN Music Festival 2026', videoCount: 1 }));
    report.check('the next page of channel playlists comes from the playlist grid, never the channel header panel',
        typeof kexpChannel?.continuation === 'string'
        && kexpChannel.continuation.startsWith('4qmFsgJ4')
        && !kexpChannel.continuation.includes('DECOY'));

    const fleetChannel = youtubeCall('youtubeChannelPage', [youtubeFixture('channel-fleet-playlists.json')]);
    const fleetReleases = youtubeCall('youtubeReleasesPage', [youtubeFixture('channel-fleet-releases.json')]);
    report.check('an artist channel offers Releases, read as album playlists with track counts',
        JSON.stringify(fleetChannel?.sections?.map(section => section.key)) === JSON.stringify(['videos', 'popular', 'live', 'releases', 'playlists'])
        && fleetChannel.continuation === null
        && fleetReleases?.playlists?.length === 3
        && JSON.stringify(fleetReleases.playlists[2]) === JSON.stringify({ playlistId: 'OLAK5uy_kk3pfIo77dZqFOoB9_57qfDr6JeBaga7E', title: 'Shore', videoCount: 15 })
        && fleetReleases.continuation === null);

    const uploads = youtubeCall('youtubePlaylistPage', [youtubeFixture('playlist-kexp-uploads.json')]);
    report.check('a playlist page carries its title, owner, full count, videos with durations, and next-page token',
        JSON.stringify(uploads?.playlist) === JSON.stringify({ title: 'Videos', ownerTitle: 'KEXP', videoCount: 19452 })
        && uploads.videos.length === 3
        && JSON.stringify(uploads.videos[0]) === JSON.stringify({
            videoId: 'yZXpav794BY',
            title: 'TONTRAKUL - Full Performance (Live on KEXP)',
            channelTitle: 'KEXP',
            duration: '27:30',
            published: '3 hours ago'
        })
        && typeof uploads.continuation === 'string' && uploads.continuation.startsWith('4qmFsgJx'));

    const shore = youtubeCall('youtubePlaylistPage', [youtubeFixture('playlist-fleet-shore.json')]);
    report.check('a short playlist ends with no next page; the recommendations YouTube appends are never followed',
        shore?.playlist?.videoCount === 18
        && shore.playlist.ownerTitle === 'Fleet Foxes'
        && shore.videos.length === 3
        && shore.videos[0].duration === '2:15'
        && shore.continuation === null);

    const album = youtubeCall('youtubePlaylistPage', [youtubeFixture('playlist-fleet-shore-album.json')]);
    report.check('an album belongs to no channel; its header names the artist as the owner',
        JSON.stringify(album?.playlist) === JSON.stringify({ title: 'Shore', ownerTitle: 'Fleet Foxes', videoCount: 15 })
        && album.videos.length === 3
        && album.videos[0].channelTitle === 'Fleet Foxes and ANTI- Records'
        && album.continuation === null);

    const nextPage = youtubeCall('youtubeNextPage', [youtubeFixture('next-page-kexp-uploads.json')]);
    report.check('a next-page answer appends videos and carries the token after it',
        nextPage?.videos?.length === 3
        && nextPage.videos[0].videoId === 'LBWH13KxgHk'
        && nextPage.videos[0].duration === '5:10'
        && nextPage.playlists.length === 0
        && typeof nextPage.continuation === 'string' && nextPage.continuation !== uploads?.continuation);

    const unreadable = youtubeCall('youtubeListing', [[
        { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_SOMETHING_NEW', contentId: 'abc' } },
        { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_SOMETHING_NEW', contentId: 'def' } }
    ]]);
    const emptyList = youtubeCall('youtubeListing', [[]]);
    report.check('a list none of whose entries can be read reports a format change instead of showing nothing',
        unreadable?.status === 502
        && unreadable.thrown === "YouTube's list format changed: none of its 2 entries could be read"
        && JSON.stringify(emptyList) === JSON.stringify({ videos: [], playlists: [], continuation: null }));

    const firstCall = youtubeCall('youtubeBudgetDecision', [{}, 1000]);
    const minuteFull = youtubeCall('youtubeBudgetDecision', [{ 60: { start: 990, calls: 30 }, 3600: { start: 990, calls: 30 } }, 1000]);
    const minuteReset = youtubeCall('youtubeBudgetDecision', [{ 60: { start: 990, calls: 30 }, 3600: { start: 990, calls: 30 } }, 1050]);
    const hourFull = youtubeCall('youtubeBudgetDecision', [{ 60: { start: 990, calls: 2 }, 3600: { start: 0, calls: 300 } }, 1000]);
    report.check('the outbound budget allows 30 calls a minute and 300 an hour, and names the wait when full',
        firstCall?.allowed === true
        && JSON.stringify(firstCall.state) === JSON.stringify({ 60: { start: 1000, calls: 1 }, 3600: { start: 1000, calls: 1 } })
        && minuteFull?.allowed === false && minuteFull.waitSeconds === 50
        && minuteReset?.allowed === true
        && JSON.stringify(minuteReset.state) === JSON.stringify({ 60: { start: 1050, calls: 1 }, 3600: { start: 990, calls: 31 } })
        && hourFull?.allowed === false && hourFull.waitSeconds === 2600);

    // A full budget proves which answers make no outbound call: anything
    // that reaches YouTube is refused first.
    const nowSeconds = Math.floor(Date.now() / 1000);
    fs.mkdirSync(youtubeState, { recursive: true });
    const fullBudget = JSON.stringify({ 60: { start: nowSeconds, calls: 30 }, 3600: { start: nowSeconds, calls: 30 } });
    fs.writeFileSync(path.join(youtubeState, 'budget.json'), fullBudget);
    const refused = youtube('youtube=playlist&id=PLproxyTestList');
    report.check(`a call past the budget is refused with the wait, not queued (${refused.error})`,
        String(refused.error).startsWith("This site's YouTube request budget is used up; try again in ")
        && refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= 60);

    const cachedAnswer = { playlist: { title: 'Cached list', ownerTitle: 'Test', videoCount: 1 }, videos: [], continuation: null };
    const cachePath = String(youtubeCall('youtubeCachePath', ['playlist|PLproxyTestList', 21600]));
    const cacheInState = cachePath.startsWith(youtubeState + path.sep);
    let served = {}, budgetAfterHit = '', expired = {};
    if (cacheInState) {
        fs.writeFileSync(cachePath, JSON.stringify(cachedAnswer));
        served = youtube('youtube=playlist&id=PLproxyTestList');
        budgetAfterHit = fs.readFileSync(path.join(youtubeState, 'budget.json'), 'utf8');
        const staleSeconds = nowSeconds - 7 * 3600;
        fs.utimesSync(cachePath, staleSeconds, staleSeconds);
        expired = youtube('youtube=playlist&id=PLproxyTestList');
    }
    if (!cacheInState) report.errors.push(`youtubeCachePath answered ${cachePath}, outside ${youtubeState}`);
    report.check('a cached answer is served to every browser for six hours without an outbound call; an older one is not',
        cacheInState
        && JSON.stringify(served) === JSON.stringify(cachedAnswer)
        && budgetAfterHit === fullBudget
        && String(/** @type {{ error?: string }} */ (expired).error).startsWith("This site's YouTube request budget is used up"));

    const youtubeSourceStart = source.indexOf('// ---------------- YouTube channel and playlist listing');
    const youtubeSource = source.slice(youtubeSourceStart, source.indexOf('// Page-read mode:', youtubeSourceStart));
    report.check('YouTube listing calls one fixed host, with no User-Agent, through the shared request function',
        youtubeSource.includes("const YOUTUBE_API_BASE = 'https://www.youtube.com/youtubei/v1/';")
        && (youtubeSource.match(/requestPublicUrl\(/g) || []).length === 1
        && youtubeSource.includes("YOUTUBE_API_BASE . $endpoint . '?prettyPrint=false'")
        && youtubeSource.includes("'userAgent' => null"));
    fs.rmSync(youtubeTemp, { recursive: true, force: true });

    report.finish();
})();
