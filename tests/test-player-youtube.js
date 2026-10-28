// @ts-check
// YouTube channel and playlist links in the Find music box: a pasted channel
// opens a card with its sections, a pasted playlist opens that playlist, and
// listed videos reach the working playlist all at once, filtered, or
// hand-picked. Pages load on demand and are never requested twice while the
// card is open; proxy refusals are shown and never retried; other text and
// plain video links stay searches.

const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

const PHONE = { width: 412, height: 915 };
const CHANNEL_ID = 'UC3I2GFN_F8WudD_2jUZbojA';
const UPLOADS = `UULF${CHANNEL_ID.slice(2)}`;
const POPULAR = `UULP${CHANNEL_ID.slice(2)}`;
const LIVE = `UULV${CHANNEL_ID.slice(2)}`;

/** @param {string} videoId @param {string} title @param {string} channelTitle @param {string} duration */
function video(videoId, title, channelTitle, duration) {
    return { videoId, title, channelTitle, duration, published: '3 days ago' };
}

/** proxy.php youtube-mode answers, keyed "<operation>:<id or token>". */
const ANSWERS = {
    channel: {
        channel: { id: CHANNEL_ID, title: 'KEXP', handle: '@kexp' },
        sections: [
            { key: 'videos', title: 'Videos', playlistId: UPLOADS },
            { key: 'popular', title: 'Popular', playlistId: POPULAR },
            { key: 'live', title: 'Live', playlistId: LIVE },
            { key: 'playlists', title: 'Playlists' }
        ],
        playlists: [
            { playlistId: 'PLsessions01', title: 'KEXP - Live Sessions 2026', videoCount: 2 },
            { playlistId: 'PLmissing001', title: 'Removed Playlist', videoCount: 7 }
        ],
        continuation: 'PLAYLISTS-PAGE-2-TOKEN'
    },
    [`playlist:${UPLOADS}`]: {
        playlist: { title: 'Videos', ownerTitle: 'KEXP', videoCount: 5 },
        videos: [
            video('kexpvid0001', 'TONTRAKUL - Full Performance (Live on KEXP)', 'KEXP', '27:30'),
            video('kexpvid0002', 'Fleet Foxes - Sunblind (Live on KEXP)', 'KEXP and Sub Pop Records', '4:34'),
            video('kexpvid0003', 'KEXP - Morning Show Highlights', 'KEXP', '12:01')
        ],
        continuation: 'UPLOADS-PAGE-2-TOKEN'
    },
    'more:UPLOADS-PAGE-2-TOKEN': {
        videos: [
            video('kexpvid0003', 'KEXP - Morning Show Highlights', 'KEXP', '12:01'),
            video('kexpvid0004', 'Bomba Estereo - Soy Yo (Live on KEXP)', 'KEXP', '3:58'),
            video('kexpvid0005', 'Japanese Breakfast - Be Sweet (Live on KEXP)', 'KEXP', '3:31')
        ],
        playlists: [],
        continuation: null
    },
    [`playlist:${POPULAR}`]: {
        playlist: { title: 'Popular videos', ownerTitle: 'KEXP', videoCount: 2 },
        videos: [
            video('kexppop0001', 'Billie Eilish - Full Performance (Live on KEXP)', 'KEXP', '20:00'),
            video('kexpvid0001', 'TONTRAKUL - Full Performance (Live on KEXP)', 'KEXP', '27:30')
        ],
        continuation: null
    },
    [`playlist:${LIVE}`]: {
        playlist: { title: 'Live streams', ownerTitle: 'KEXP', videoCount: 5 },
        videos: [
            video('kexplive001', 'KEXP Live at Home 1', 'KEXP', '1:02:00'),
            video('kexplive002', 'KEXP Live at Home 2', 'KEXP', '58:10')
        ],
        continuation: 'LIVE-PAGE-2-TOKEN'
    },
    'more:LIVE-PAGE-2-TOKEN': {
        videos: [video('kexplive003', 'KEXP Live at Home 3', 'KEXP', '45:00'), video('kexplive004', 'KEXP Live at Home 4', 'KEXP', '50:00')],
        playlists: [],
        continuation: 'LIVE-PAGE-3-TOKEN'
    },
    // A page whose token points back at itself: the list ends there.
    'more:LIVE-PAGE-3-TOKEN': {
        videos: [video('kexplive005', 'KEXP Live at Home 5', 'KEXP', '40:00')],
        playlists: [],
        continuation: 'LIVE-PAGE-3-TOKEN'
    },
    'more:PLAYLISTS-PAGE-2-TOKEN': {
        videos: [],
        playlists: [{ playlistId: 'PLarchive001', title: 'KEXP Archive', videoCount: 1200 }],
        continuation: null
    },
    'playlist:PLsessions01': {
        playlist: { title: 'KEXP - Live Sessions 2026', ownerTitle: 'KEXP', videoCount: 2 },
        videos: [
            video('sessvid0001', 'Wet Leg - Chaise Longue', 'Wet Leg', '3:16'),
            video('sessvid0002', 'KEXP - Studio Tour', 'KEXP', '8:00')
        ],
        continuation: null
    },
    'playlist:PLstandalone': {
        playlist: { title: 'Road Trip', ownerTitle: 'Someone Else', videoCount: 1 },
        videos: [video('roadvid0001', 'Fleet Foxes - Mykonos', 'Fleet Foxes', '4:36')],
        continuation: null
    }
};

/** Refusals proxy.php answers with, keyed like ANSWERS. */
const REFUSALS = {
    'playlist:PLmissing001': { status: 404, error: 'No YouTube playlist PLmissing001 (YouTube said: Request contains an invalid argument.)' },
    'playlist:PLbusy000001': { status: 429, error: "This site's YouTube request budget is used up; try again in 42 seconds", retryAfterSeconds: 42 }
};

/** The shown list finished loading (or failed). */
function shownSettled() {
    const state = window.musicController.youtubeList;
    const list = state && state.lists.get(state.shownKey);
    return Boolean(state && (state.error || (list && !list.loading && (list.loaded || list.error))));
}

/** Everything the card shows, read from the page. */
function cardView() {
    const text = (/** @type {string} */ id) => document.getElementById(id)?.textContent || '';
    /** @param {string} id */
    const button = id => {
        const el = /** @type {HTMLButtonElement} */ (document.getElementById(id));
        return { text: el.textContent, hidden: el.hidden, disabled: el.disabled };
    };
    const card = /** @type {HTMLElement} */ (document.getElementById('youtubeListCard'));
    return {
        visible: !card.hidden && card.getBoundingClientRect().height > 0,
        title: text('youtubeListTitle'),
        owner: text('youtubeListOwner'),
        sectionsHidden: /** @type {HTMLElement} */ (document.getElementById('youtubeListSections')).hidden,
        sections: Array.from(document.querySelectorAll('[data-youtube-section]')).map(el => el.textContent),
        selected: Array.from(document.querySelectorAll('[data-youtube-section].selected')).map(el => el.textContent),
        subheaderHidden: /** @type {HTMLElement} */ (document.getElementById('youtubeListSubheader')).hidden,
        subtitle: text('youtubeListSubtitle'),
        status: text('youtubeListStatus'),
        statusError: document.querySelector('#youtubeListStatus .youtube-list-error')?.textContent || '',
        rows: Array.from(document.querySelectorAll('#youtubeListRows .youtube-list-row'))
            .filter(row => !(/** @type {HTMLElement} */ (row).hidden))
            .map(row => ({
                title: row.querySelector('.youtube-list-row-title')?.textContent || '',
                channel: row.querySelector('.youtube-list-row-channel')?.textContent || '',
                age: row.querySelector('.youtube-list-row-age')?.textContent || '',
                duration: row.querySelector('.youtube-list-row-duration')?.textContent || '',
                count: row.querySelector('.youtube-list-row-count')?.textContent || '',
                height: Math.round(row.getBoundingClientRect().height)
            })),
        play: button('youtubeListPlayBtn'),
        add: button('youtubeListAddBtn'),
        more: button('youtubeListMoreBtn'),
        all: button('youtubeListAllBtn'),
        pickNone: button('youtubeListPickNoneBtn'),
        searchDisabled: /** @type {HTMLButtonElement} */ (document.getElementById('typedCommandSubmitBtn')).disabled
    };
}

/** The working playlist, as the checks compare it. */
function playlistView() {
    const c = window.musicController;
    return {
        songs: c.playlist.map(item => ({
            videoId: item.videoId, name: item.name, artist: item.artist, album: item.album,
            duration: item.duration, sourceKind: item.sourceKind, sourceLabel: item.sourceLabel
        })),
        played: c.__youtubeTestPlayed || 0,
        status: document.getElementById('status')?.textContent || ''
    };
}

(async () => {
    const report = createReporter('player YouTube channel and playlist links');
    const browser = await launch();
    const ctx = await browser.newContext({ viewport: PHONE });
    /** @type {string[]} */
    const requests = [];
    /** @type {string[]} */
    const searches = [];
    /** @type {string[]} */
    const unanswered = [];
    /** @type {(value?: unknown) => void} */
    let releaseLivePage2 = () => {};
    const livePage2Held = new Promise(resolve => { releaseLivePage2 = resolve; });

    await ctx.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await ctx.route('**/proxy.php?*', async route => {
        const params = new URL(route.request().url()).searchParams;
        const operation = params.get('youtube');
        if (operation) {
            const key = operation === 'channel' ? 'channel'
                : operation === 'more' ? `more:${params.get('token')}` : `${operation}:${params.get('id')}`;
            requests.push(operation === 'channel' ? `channel:${params.get('url')}` : key);
            if (key === 'more:LIVE-PAGE-2-TOKEN') await livePage2Held;
            const refusal = REFUSALS[key];
            if (refusal) {
                const { status, ...body } = refusal;
                return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
            }
            const answer = ANSWERS[key];
            if (!answer) unanswered.push(key);
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer || { error: `no test answer for ${key}` }) });
        }
        if (params.has('q')) {
            searches.push(params.get('q') || '');
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [], source: 'test-proxy' }) });
        }
        return route.fulfill({ contentType: 'application/json', body: '[]' });
    });
    const tab = await ctx.newPage();
    // Chromium logs each refused answer as a failed load; the refusal checks
    // count those and everything else is an error.
    /** @type {string[]} */
    const consoleErrors = [];
    collectErrors(tab, 'player-youtube', consoleErrors);
    const refusedLoad = /console\.error: Failed to load resource: the server responded with a status of (404|429) /;
    await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
    await tab.evaluate(() => {
        const controller = window.musicController;
        // List behavior, not YouTube iframe playback, owns this suite.
        controller.playPlaylist = () => { controller.__youtubeTestPlayed = (controller.__youtubeTestPlayed || 0) + 1; };
    });

    /** Submit a link and wait until its card has finished opening. @param {string} text */
    const submit = async text => {
        await tab.fill('#typedCommandInput', text);
        await tab.press('#typedCommandInput', 'Enter');
        await tab.waitForFunction(linkText => {
            const controller = window.musicController;
            return controller.youtubeList?.link.text === linkText && !controller.isProcessingRequest;
        }, text);
    };

    // ---- Which texts open the card: one channel or playlist link and nothing else.
    const links = await tab.evaluate(() => [
        'kexp live sessions',
        '@kexp',
        'https://www.youtube.com/watch?v=yZXpav794BY',
        'https://www.youtube.com/watch?v=yZXpav794BY&list=RDyZXpav794BY',
        'https://www.youtube.com/playlist?list=WL',
        'https://example.com/@kexp',
        'https://www.youtube.com/@kexp and more words',
        'https://youtu.be/yZXpav794BY?list=PLabc123',
        'https://m.youtube.com/@kexp/streams',
        'https://music.youtube.com/channel/UC3I2GFN_F8WudD_2jUZbojA/releases',
        'https://www.youtube.com/c/kexp'
    ].map(text => PlayerYouTubeLists.parseLink(text)));
    report.check('only a lone channel or playlist link opens the card; words, video links, mixes, and private lists stay searches',
        links.slice(0, 7).every(link => link === null)
        && links[7]?.kind === 'playlist' && links[7].playlistId === 'PLabc123'
        && links[8]?.kind === 'channel' && links[8].section === 'live'
        && links[9]?.kind === 'channel' && links[9].section === 'releases'
        && links[10]?.kind === 'channel' && links[10].section === '');

    // ---- A pasted channel link opens on its videos.
    await submit('https://www.youtube.com/@kexp/videos?si=share-tracking');
    const opened = await tab.evaluate(cardView);
    report.check(`a channel link opens the card on its uploads, with no search (${opened.status})`,
        opened.visible
        && opened.title === 'KEXP' && opened.owner === '@kexp'
        && opened.sections.join('|') === 'Videos|Popular|Live|Playlists'
        && opened.selected.join('|') === 'Videos'
        && opened.status === '3 of 5 videos loaded'
        && opened.play.text === 'Play 3' && !opened.play.hidden
        && opened.more.text === 'Load 100 more' && !opened.more.hidden
        && !opened.searchDisabled
        && searches.length === 0
        && requests.join(' ') === `channel:https://www.youtube.com/@kexp/videos?si=share-tracking playlist:${UPLOADS}`);
    report.check('rows read title, age, duration on one line; a byline led by the owner and a leading "<owner> - " are not repeated',
        JSON.stringify(opened.rows.map(row => [row.title, row.channel, row.age, row.duration])) === JSON.stringify([
            ['TONTRAKUL - Full Performance (Live on KEXP)', '', '3d ago', '27:30'],
            ['Fleet Foxes - Sunblind (Live on KEXP)', '', '3d ago', '4:34'],
            ['Morning Show Highlights', '', '3d ago', '12:01']
        ])
        && opened.rows.every(row => row.height <= 48));

    // ---- Filter, pick, Add.
    await tab.fill('#youtubeListFilterInput', 'live on kexp');
    const filtered = await tab.evaluate(cardView);
    await tab.locator('#youtubeListRows .youtube-list-row:not([hidden]) input[type=checkbox]').first().check();
    const picked = await tab.evaluate(cardView);
    await tab.click('#youtubeListAddBtn');
    const afterPickAdd = { card: await tab.evaluate(cardView), list: await tab.evaluate(playlistView) };
    report.check(`the filter narrows what Play and Add take; picks narrow it further (${picked.status})`,
        filtered.rows.length === 2 && filtered.status === '3 of 5 videos loaded · 2 shown' && filtered.play.text === 'Play 2'
        && picked.play.text === 'Play 1 picked' && picked.add.text === 'Add 1 picked'
        && picked.status === '3 of 5 videos loaded · 2 shown · 1 picked' && !picked.pickNone.disabled);
    report.check('Add puts the picked video in the playlist as a song, then clears the picks',
        JSON.stringify(afterPickAdd.list.songs) === JSON.stringify([{
            videoId: 'kexpvid0001', name: 'Full Performance (Live on KEXP)', artist: 'TONTRAKUL', album: '',
            duration: '27:30', sourceKind: 'youtube', sourceLabel: 'YouTube: KEXP \u00b7 Videos'
        }])
        && afterPickAdd.list.status === 'Added 1 video from KEXP \u00b7 Videos'
        && afterPickAdd.card.add.text === 'Add 2' && afterPickAdd.card.pickNone.disabled);
    await tab.fill('#youtubeListFilterInput', '');

    // ---- Load more: the next page appends, a repeated video stays once, the end hides the loaders.
    await tab.click('#youtubeListMoreBtn');
    await tab.waitForFunction(shownSettled);
    const more = await tab.evaluate(cardView);
    report.check(`Load 100 more appends the next page once and ends the list (${more.status})`,
        more.rows.length === 5
        && more.rows.map(row => row.title).join('|').includes('Soy Yo')
        && more.status === '5 videos'
        && more.more.hidden && more.all.hidden
        && requests.filter(entry => entry === 'more:UPLOADS-PAGE-2-TOKEN').length === 1);

    await tab.click('#youtubeListAddBtn');
    const addedAll = await tab.evaluate(playlistView);
    await tab.click('#youtubeListPlayBtn');
    const played = await tab.evaluate(playlistView);
    report.check(`Add skips videos already in the playlist; Play replaces the playlist in list order and starts it (${addedAll.status})`,
        addedAll.songs.length === 5
        && addedAll.status === 'Added 4 videos from KEXP \u00b7 Videos (1 already in the playlist)'
        && played.songs.map(song => song.videoId).join(',') === 'kexpvid0001,kexpvid0002,kexpvid0003,kexpvid0004,kexpvid0005'
        && played.songs[1].artist === 'Fleet Foxes' && played.songs[1].name === 'Sunblind (Live on KEXP)'
        && played.played === 1
        && played.status === 'Playing 5 videos from KEXP \u00b7 Videos');

    // ---- Sections load once each.
    await tab.click('[data-youtube-section="popular"]');
    await tab.waitForFunction(shownSettled);
    const popular = await tab.evaluate(cardView);
    await tab.click('[data-youtube-section="videos"]');
    const videosAgain = await tab.evaluate(cardView);
    report.check('each section loads on first view; returning to one asks nothing again',
        popular.selected.join('|') === 'Popular' && popular.rows.length === 2
        && videosAgain.rows.length === 5 && videosAgain.status === '5 videos'
        && requests.filter(entry => entry === `playlist:${UPLOADS}`).length === 1
        && requests.filter(entry => entry === `playlist:${POPULAR}`).length === 1);

    // ---- Load all, Stop, and a page that points back at itself.
    await tab.click('[data-youtube-section="live"]');
    await tab.waitForFunction(shownSettled);
    await tab.click('#youtubeListAllBtn');
    await tab.waitForFunction(() => document.getElementById('youtubeListAllBtn')?.textContent === 'Stop loading');
    await tab.click('#youtubeListAllBtn');
    releaseLivePage2();
    await tab.waitForFunction(() => document.getElementById('youtubeListAllBtn')?.textContent === 'Load all');
    const stopped = await tab.evaluate(cardView);
    if (!stopped.all.hidden) {
        await tab.click('#youtubeListAllBtn');
        await tab.waitForFunction(() => document.getElementById('youtubeListAllBtn')?.hidden === true);
    }
    const loadedAll = await tab.evaluate(cardView);
    report.check(`Load all loads page after page; Stop ends it after the current page; a self-pointing page ends the list (stopped at ${stopped.status}; then ${loadedAll.status})`,
        stopped.rows.length === 4 && stopped.status === '4 of 5 videos loaded'
        && loadedAll.rows.length === 5 && loadedAll.status === '5 videos'
        && requests.filter(entry => entry === 'more:LIVE-PAGE-2-TOKEN').length === 1
        && requests.filter(entry => entry === 'more:LIVE-PAGE-3-TOKEN').length === 1);

    // ---- Playlists: more playlists, open one, Back, and a removed one.
    await tab.click('[data-youtube-section="playlists"]');
    const playlists = await tab.evaluate(cardView);
    await tab.click('#youtubeListMoreBtn');
    await tab.waitForFunction(shownSettled);
    const morePlaylists = await tab.evaluate(cardView);
    await tab.click('[data-playlist-id="PLsessions01"]');
    await tab.waitForFunction(shownSettled);
    const session = await tab.evaluate(cardView);
    await tab.click('#youtubeListBackBtn');
    const back = await tab.evaluate(cardView);
    report.check(`Playlists list one per line with counts, and load more of them (${morePlaylists.status})`,
        JSON.stringify(playlists.rows.map(row => [row.title, row.count])) === JSON.stringify([['Live Sessions 2026', '2 videos'], ['Removed Playlist', '7 videos']])
        && playlists.status === '2 playlists loaded, more available'
        && playlists.play.hidden && playlists.add.hidden && playlists.all.hidden && !playlists.more.hidden
        && morePlaylists.rows.length === 3 && morePlaylists.rows[2].count === '1,200 videos'
        && morePlaylists.status === '3 playlists'
        && morePlaylists.rows.every(row => row.height <= 48));
    report.check('an opened playlist shows its videos under Back; another channel\'s video names that channel',
        !session.subheaderHidden && session.subtitle === 'Live Sessions 2026'
        && session.selected.join('|') === 'Playlists'
        && JSON.stringify(session.rows.map(row => [row.title, row.channel])) === JSON.stringify([['Chaise Longue', 'Wet Leg'], ['Studio Tour', '']])
        && back.subheaderHidden && back.rows.length === 3
        && requests.filter(entry => entry === 'playlist:PLsessions01').length === 1);

    await tab.click('[data-playlist-id="PLmissing001"]');
    await tab.waitForFunction(shownSettled);
    const missing = await tab.evaluate(cardView);
    report.check(`a playlist YouTube no longer has shows why (${missing.statusError})`,
        missing.statusError === 'YouTube list failed: No YouTube playlist PLmissing001 (YouTube said: Request contains an invalid argument.)'
        && missing.rows.length === 0 && missing.play.hidden);

    // ---- A pasted playlist link (from a video in it) and a refusal over budget.
    await submit('https://www.youtube.com/watch?v=roadvid0001&list=PLstandalone&index=1');
    const standalone = await tab.evaluate(cardView);
    report.check('a playlist link opens that playlist without channel sections',
        standalone.title === 'Road Trip' && standalone.owner === 'Someone Else' && standalone.sectionsHidden
        && standalone.status === '1 video' && standalone.rows.length === 1 && standalone.rows[0].title === 'Mykonos'
        && standalone.rows[0].channel === 'Fleet Foxes');

    await submit('https://www.youtube.com/playlist?list=PLbusy000001');
    await tab.waitForTimeout(300);
    const refused = { card: await tab.evaluate(cardView), list: await tab.evaluate(playlistView) };
    report.check(`a used-up request budget is shown with its wait and not retried (${refused.card.statusError})`,
        refused.card.statusError === "YouTube list failed: This site's YouTube request budget is used up; try again in 42 seconds"
        && refused.list.status === refused.card.statusError
        && requests.filter(entry => entry === 'playlist:PLbusy000001').length === 1);

    // ---- Close, then a plain video link is still a search.
    await tab.click('#youtubeListCloseBtn');
    const requestCount = requests.length;
    await tab.fill('#typedCommandInput', 'https://www.youtube.com/watch?v=yZXpav794BY');
    await tab.press('#typedCommandInput', 'Enter');
    await tab.waitForFunction(() => window.musicController.isProcessingRequest === false);
    const closed = { card: await tab.evaluate(cardView), state: await tab.evaluate(() => window.musicController.youtubeList) };
    report.check('Close drops the card; a plain video link searches as before',
        !closed.card.visible && closed.state === null
        && searches.join('|') === 'https://www.youtube.com/watch?v=yZXpav794BY'
        && requests.length === requestCount);

    const refusals = consoleErrors.filter(entry => refusedLoad.test(entry));
    report.check(`each refusal was one request; every other request had its answer (${refusals.length} refused, unanswered: ${unanswered.join(', ') || 'none'})`,
        refusals.length === 2 && unanswered.length === 0);
    report.errors.push(...consoleErrors.filter(entry => !refusedLoad.test(entry)));

    await ctx.close();
    await browser.close();
    report.finish();
})();
