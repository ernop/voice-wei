// @ts-check
// Live search/lyrics audit: runs real songs through the REAL production
// code paths - proxy.php (Piped/Invidious), scoreVideoCandidate ranking,
// and the LRCLIB lyric matcher - and prints what the player would pick.
//
// Network-dependent by design, so it is NOT part of any npm test profile.
// Run it when investigating wrong-version / wrong-lyrics reports:
//
//   php -S 127.0.0.1:8000 &        # proxy host (or use the live site)
//   node tests/audit-search-live.js                 # Fleet Foxes case
//   node tests/audit-search-live.js "Artist - Song" "Artist - Song"
//   PROXY_BASE=https://fuseki.net/voice-wei node tests/audit-search-live.js
//
// Each line shows the pick the playlist would receive, its score, the
// runner-up, how many alternates survive the same-recording filter, and
// which LRCLIB record the lyric lookup would attach.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROXY_BASE = process.env.PROXY_BASE || 'http://127.0.0.1:8000';

/** The shipped regression case: every track of the first two Fleet Foxes albums. */
const DEFAULT_SONGS = [
    ['Fleet Foxes', 'Sun It Rises', 'Fleet Foxes'],
    ['Fleet Foxes', 'White Winter Hymnal', 'Fleet Foxes'],
    ['Fleet Foxes', 'Ragged Wood', 'Fleet Foxes'],
    ['Fleet Foxes', 'Quiet Houses', 'Fleet Foxes'],
    ['Fleet Foxes', "He Doesn't Know Why", 'Fleet Foxes'],
    ['Fleet Foxes', 'Heard Them Stirring', 'Fleet Foxes'],
    ['Fleet Foxes', 'Your Protector', 'Fleet Foxes'],
    ['Fleet Foxes', 'Meadowlarks', 'Fleet Foxes'],
    ['Fleet Foxes', 'Blue Ridge Mountains', 'Fleet Foxes'],
    ['Fleet Foxes', 'Oliver James', 'Fleet Foxes'],
    ['Fleet Foxes', 'Montezuma', 'Helplessness Blues'],
    ['Fleet Foxes', 'Bedouin Dress', 'Helplessness Blues'],
    ['Fleet Foxes', 'Sim Sala Bim', 'Helplessness Blues'],
    ['Fleet Foxes', 'Battery Kinzie', 'Helplessness Blues'],
    ['Fleet Foxes', 'The Plains / Bitter Dancer', 'Helplessness Blues'],
    ['Fleet Foxes', 'Helplessness Blues', 'Helplessness Blues'],
    ['Fleet Foxes', 'The Cascades', 'Helplessness Blues'],
    ['Fleet Foxes', 'Lorelai', 'Helplessness Blues'],
    ['Fleet Foxes', "Someone You'd Admire", 'Helplessness Blues'],
    ['Fleet Foxes', 'The Shrine / An Argument', 'Helplessness Blues'],
    ['Fleet Foxes', 'Blue Spotted Tail', 'Helplessness Blues'],
    ['Fleet Foxes', 'Grown Ocean', 'Helplessness Blues']
];

/** Load the production player modules into a bare controller, no browser. */
function buildController() {
    const sandbox = /** @type {any} */ ({
        document: {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: () => {}
        },
        PlaybackState: class { constructor() { this.isPlaying = false; } },
        console, setTimeout, clearTimeout, Promise, URLSearchParams,
        fetch: (...args) => fetch(...args),
        AbortSignal
    });
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    for (const file of ['player-songs.js', 'player-playlist.js', 'player-lyrics.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file });
    }

    const controller = /** @type {any} */ ({
        addMessage() {},
        playback: {},
        lyricsLookupCache: new Map()
    });
    sandbox.window.PlayerPlaylist.install(controller);
    sandbox.window.PlayerLyrics.install(controller);
    return controller;
}

function parseArgSongs(args) {
    return args.map(arg => {
        const [artist, name] = arg.split(' - ').map(part => part.trim());
        if (!artist || !name) {
            throw new Error(`Song argument must be "Artist - Song", got: ${arg}`);
        }
        return [artist, name, ''];
    });
}

async function main() {
    const args = process.argv.slice(2);
    const songs = args.length ? parseArgSongs(args) : DEFAULT_SONGS;
    const controller = buildController();
    let searchFailures = 0;

    for (const [artist, name, album] of songs) {
        const searchTerm = `${artist} ${name}`;
        const response = await fetch(`${PROXY_BASE}/proxy.php?q=${encodeURIComponent(searchTerm)}`);
        const data = await response.json();
        console.log(`\n=== ${artist} - ${name}${album ? ` (${album})` : ''} ===`);
        if (data.error) {
            searchFailures++;
            console.log(`  SEARCH FAILED: ${data.error}`);
            continue;
        }

        const context = { searchTerm, artist, name };
        const scored = (data.results || [])
            .filter(result => result.videoId)
            .map(result => controller.formatYouTubeResult(result))
            .map((video, index) => ({ video, index, score: controller.scoreVideoCandidate(video, context) }))
            .sort((a, b) => (b.score - a.score) || (a.index - b.index));
        if (!scored.length) {
            searchFailures++;
            console.log('  SEARCH FAILED: no results');
            continue;
        }

        const pick = scored[0];
        const survivingAlternates = scored.slice(1).filter(entry => entry.score >= 0).length;
        const describe = entry => `[${entry.score.toFixed(2)}] ${entry.video.duration} "${entry.video.title}" -- ${entry.video.channelTitle}${entry.video.isAlbumTrack ? ' (album track)' : ''}`;
        console.log(`  pick    ${describe(pick)}`);
        if (scored[1]) console.log(`  next    ${describe(scored[1])}`);
        console.log(`  alternates surviving same-recording filter: ${survivingAlternates} of ${scored.length - 1}`);

        const lyrics = await controller.lookupLyrics({
            name, artist, album,
            title: pick.video.title,
            channelTitle: pick.video.channelTitle,
            duration: pick.video.duration,
            durationSeconds: pick.video.durationSeconds
        }).catch(error => ({ error: error.message }));
        if (!lyrics) {
            console.log('  lyrics  none found');
        } else if (lyrics.error) {
            console.log(`  lyrics  LOOKUP FAILED: ${lyrics.error}`);
        } else {
            const kind = lyrics.syncedLines.length > 0 ? 'timed' : 'simple';
            console.log(`  lyrics  ${kind}: ${lyrics.artistName} - ${lyrics.trackName} [${lyrics.albumName}] ${Math.round(lyrics.duration)}s`);
        }
    }

    console.log(`\nDone: ${songs.length} songs, ${searchFailures} search failure${searchFailures === 1 ? '' : 's'}.`);
    process.exit(searchFailures > 0 ? 1 : 0);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
