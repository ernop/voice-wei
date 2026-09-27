// @ts-check
// Lyrics page layout and curation contract (the 2026-09-27 redo): prominent
// transport, one-tap favorites, unload, live Favorites only, a notched seek
// scale, one-line rows, and the owner display rules (no gray text).

const fs = require('fs');
const path = require('path');
const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

const PHONE = { width: 412, height: 915 };

// A clock-driven stand-in for the YouTube IFrame API: playback state and
// position are real to the page, and no external network is touched.
const FAKE_YOUTUBE_API = `(function () {
    class Player {
        constructor(id, opts) {
            this.opts = opts;
            this.videoId = opts.videoId;
            this.state = -1;
            this.base = 0;
            this.startedAt = 0;
            setTimeout(() => opts.events.onReady({ target: this }), 0);
        }
        now() { return this.state === 1 ? this.base + (performance.now() - this.startedAt) / 1000 : this.base; }
        setVolume() {}
        mute() {}
        getDuration() { return (window.__uiDurations || {})[this.videoId] || 200; }
        getCurrentTime() { return Math.min(this.now(), this.getDuration()); }
        getPlaybackRate() { return 1; }
        getPlayerState() { return this.state; }
        getVideoLoadedFraction() { return 0.5; }
        loadVideoById(id) { this.videoId = id; this.base = 0; this.state = -1; this.playVideo(); }
        playVideo() {
            if (this.state !== 1) { this.startedAt = performance.now(); this.state = 1; }
            setTimeout(() => this.opts.events.onStateChange({ target: this, data: 1 }), 0);
        }
        pauseVideo() { this.base = this.now(); this.state = 2; }
        stopVideo() { this.base = 0; this.state = 5; }
        seekTo(time) { this.base = time; this.startedAt = performance.now(); }
        destroy() {}
    }
    window.YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
    if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();
})();`;

/** @param {string} name @param {string} artist @param {string} duration @param {boolean} starred @param {string} lyrics */
function song(name, artist, duration, starred, lyrics) {
    const videoId = `ui${name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 9).padEnd(9, 'x')}`;
    const [m, s] = duration.split(':').map(Number);
    return {
        starred,
        lyrics,
        record: {
            videoId, name, artist, year: '1970', album: `${name} Album`, comment: `Note about ${name}`,
            searchTerm: `${artist} ${name}`, title: `${artist} - ${name}`, channelTitle: artist,
            duration, durationSeconds: m * 60 + s
        }
    };
}

const SONGS = [
    song('Amazing Grace', 'Judy Collins', '4:05', true, 'timed'),
    song('Shenandoah', 'Tennessee Ernie Ford', '3:08', false, 'timed'),
    song('Danny Boy', 'Harry Belafonte', '4:31', false, 'simple'),
    song('The Water Is Wide', 'Karla Bonoff', '3:52', true, 'timed'),
    song('Red River Valley', 'Marty Robbins', '2:47', false, 'none'),
    song('Greensleeves', 'Loreena McKennitt', '4:14', true, 'timed')
];
const EXTRA_FAVORITES = [
    song('Barbara Allen', 'Joan Baez', '4:26', true, 'timed'),
    song('The Parting Glass', 'The Wailin Jennys', '2:56', true, 'timed')
];

(async () => {
    const report = createReporter('player page layout and curation');
    const browser = await launch();
    const ctx = await browser.newContext({ viewport: PHONE });
    await ctx.route('https://www.youtube.com/iframe_api', route => route.fulfill({
        contentType: 'text/javascript', body: FAKE_YOUTUBE_API
    }));
    await ctx.route('https://i.ytimg.com/**', route => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    }));
    const all = [...SONGS, ...EXTRA_FAVORITES];
    await ctx.route(/\/proxy\.php\?.*lyrics=search/, route => {
        const track = new URL(route.request().url()).searchParams.get('track_name') || '';
        const entry = all.find(candidate => candidate.record.name === track);
        const records = !entry || entry.lyrics === 'none' ? [] : [{
            trackName: entry.record.name,
            artistName: entry.record.artist,
            albumName: entry.record.album,
            duration: entry.record.durationSeconds,
            instrumental: false,
            plainLyrics: 'first line\nsecond line',
            syncedLyrics: entry.lyrics === 'timed' ? '[00:10.00]first line\n[00:20.00]second line' : null
        }];
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(records) });
    });
    const tab = await ctx.newPage();
    collectErrors(tab, 'player-ui', report.errors);

    await tab.goto(`${BASE_URL}/player.html`, { waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
    await tab.evaluate(({ songs, favorites }) => {
        SettingsStore.saveJson(StorageKeys.PLAYER_PLAYLIST, {
            items: songs.map(entry => ({ ...entry, sourceKind: 'search', sourceLabel: 'UI test', sourceSearchTerm: entry.searchTerm })),
            currentPlaylistIndex: 0
        });
        SettingsStore.saveJson(StorageKeys.PLAYER_FAVORITES, Object.fromEntries(
            favorites.map((entry, index) => [entry.videoId, { ...entry, favoritedAt: 1000 + index }])
        ));
    }, {
        songs: SONGS.map(entry => entry.record),
        favorites: all.filter(entry => entry.starred).map(entry => entry.record)
    });
    await tab.reload({ waitUntil: 'domcontentloaded' });
    await tab.waitForFunction(() => window.__voiceWeiStartup?.ready === true);
    await tab.evaluate(durations => { window.__uiDurations = durations; },
        Object.fromEntries(all.map(entry => [entry.record.videoId, entry.record.durationSeconds])));
    await tab.waitForFunction(() => {
        const c = window.musicController;
        return c.lyricsFetchQueue.length === 0 && c.lyricsFetchActive === 0 && c.lyricsLookupsInFlight.size === 0
            && c.playlist.every(item => item.lyricsStatus !== 'idle' && item.lyricsStatus !== 'loading');
    });

    // ---- Play the first song at 21s so the card, lyric row, and scale are live.
    await tab.evaluate(() => { void window.musicController.playVideo(window.musicController.playlist[0]); });
    await tab.waitForFunction(() => window.musicController.isPlaying === true);
    await tab.evaluate(() => {
        const c = window.musicController;
        c.playback.player.seekTo(21, true);
        c.resyncProgressClock();
    });
    await tab.waitForFunction(() => document.getElementById('transportBarTimeCurrent')?.textContent === '0:21');

    const layout = await tab.evaluate(() => {
        const rect = id => /** @type {HTMLElement} */ (document.getElementById(id)).getBoundingClientRect();
        const card = rect('playlistTransportBar');
        const prev = rect('transportPrevBtn');
        const play = rect('transportPlayPauseBtn');
        const next = rect('transportNextBtn');
        const labels = Array.from(document.querySelectorAll('#transportProgressTicks .seek-tick-label'))
            .map(label => label.textContent);
        return {
            cardShare: card.height / window.innerHeight,
            transportHeights: [prev.height, play.height, next.height],
            playWidthRatio: play.width / prev.width,
            transportIsLargest: Array.from(document.querySelectorAll('main button'))
                .filter(button => button.getBoundingClientRect().height > 0)
                .every(button => button.getBoundingClientRect().height <= play.height + 0.5),
            playLabel: document.getElementById('transportPlayPauseBtn')?.getAttribute('aria-label'),
            identity: [
                document.querySelector('#transportBarInfo .now-playing-name')?.textContent,
                document.querySelector('#transportBarInfo .now-playing-detail')?.textContent
            ],
            lyric: document.getElementById('transportBarLyric')?.textContent,
            ticks: document.querySelectorAll('#transportProgressTicks .seek-tick').length,
            labels,
            elapsed: document.getElementById('transportBarTimeCurrent')?.textContent,
            remaining: document.getElementById('transportBarTimeTotal')?.textContent,
            sliderValue: document.getElementById('transportProgressTrack')?.getAttribute('aria-valuetext')
        };
    });
    report.check(`transport is the largest control and the now-playing card stays under half the phone screen (${Math.round(layout.cardShare * 100)}%, buttons ${layout.transportHeights.map(Math.round).join('/')}px)`,
        layout.cardShare < 0.5
        && layout.transportHeights.every(height => height >= 56)
        && layout.playWidthRatio >= 1.4
        && layout.transportIsLargest
        && layout.playLabel === 'Pause'
        && layout.identity.join('|') === 'Amazing Grace|Judy Collins \u00b7 1970'
        && layout.lyric === 'second line');
    report.check(`seek scale shows notches, both endpoints, and the current value (${layout.labels.join(' ')}; ${layout.elapsed} / ${layout.remaining})`,
        layout.ticks === 6
        && layout.labels.join('|') === '0:00|1:00|2:00|3:00|4:05'
        && layout.elapsed === '0:21'
        && layout.remaining === '-3:44'
        && layout.sliderValue === '0:21 of 4:05');

    // ---- Owner display rules: no gray text anywhere visible, one-line rows.
    // The scanner stays installed so later states (open panels, Big Lyrics)
    // are checked by the same definition.
    await tab.evaluate(() => {
        /** @param {Element} el */
        const effectiveOpacity = el => {
            let opacity = 1;
            for (let node = /** @type {Element | null} */ (el); node; node = node.parentElement) {
                opacity *= Number(getComputedStyle(node).opacity);
            }
            return opacity;
        };
        window.__scanGrayText = () => {
            const offenders = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (!node.textContent?.trim()) continue;
                const el = node.parentElement;
                if (!el) continue;
                const box = el.getBoundingClientRect();
                if (box.width === 0 || box.height === 0) continue;
                const style = getComputedStyle(el);
                if (style.visibility === 'hidden') continue;
                const [r, g, b, a = 1] = (style.color.match(/[\d.]+/g) || []).map(Number);
                // Near-neutral text (low saturation, or tinted near-white /
                // near-black) must be pure white or pure black; semantic
                // colors must be opaque.
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const lightness = (max + min) / 510;
                const saturation = max === min ? 0 : (max - min) / 255 / (1 - Math.abs(2 * lightness - 1));
                const nearNeutral = saturation < 0.3 || min > 200 || max < 60;
                const pure = (r === 255 && g === 255 && b === 255) || (r === 0 && g === 0 && b === 0);
                const opacity = effectiveOpacity(el);
                if (a < 1 || opacity < 1 || (nearNeutral && !pure)) {
                    offenders.push(`${el.tagName.toLowerCase()}.${el.className}: "${node.textContent.trim().slice(0, 24)}" ${style.color} opacity ${opacity}`);
                }
            }
            return offenders;
        };
    });
    const displayRules = await tab.evaluate(() => {
        const offenders = window.__scanGrayText();
        const rows = Array.from(document.querySelectorAll('#playlistBody .playlist-row'));
        const rowHeights = () => rows.filter(row => !row.hidden).map(row => Math.round(row.getBoundingClientRect().height));
        const plainHeights = rowHeights();
        window.musicController.settings.showSongNotes = true;
        window.musicController.applySongNotesVisibility();
        const notesHeights = rowHeights();
        const noteShown = getComputedStyle(/** @type {Element} */ (document.querySelector('.playlist-song-comment'))).display !== 'none';
        window.musicController.settings.showSongNotes = false;
        window.musicController.applySongNotesVisibility();

        // Every secondary surface opened at once, then Big Lyrics with its options.
        document.getElementById('settingsPanel').style.display = 'block';
        window.musicController.setMusicHistoryPanelVisible(true);
        document.getElementById('songLibraryPanel').style.display = 'block';
        window.musicController.toggleLogPanel();
        window.musicController.transcript.show('a spoken request');
        const panelOffenders = window.__scanGrayText();
        document.getElementById('settingsPanel').style.display = 'none';
        window.musicController.setMusicHistoryPanelVisible(false);
        document.getElementById('songLibraryPanel').style.display = 'none';
        window.musicController.toggleLogPanel();
        window.musicController.openLyricsOverlay();
        window.musicController.toggleLyricsConfig();
        const overlayOffenders = window.__scanGrayText();
        window.musicController.closeLyricsOverlay();
        return { offenders: [...offenders, ...panelOffenders, ...overlayOffenders], plainHeights, notesHeights, noteShown };
    });
    report.check(`no gray text on the page (${displayRules.offenders.length} offenders${displayRules.offenders.length ? ': ' + displayRules.offenders.slice(0, 6).join('; ') : ''})`,
        displayRules.offenders.length === 0);
    report.check(`playlist rows stay one line, notes included (${displayRules.plainHeights[0]}px / ${displayRules.notesHeights[0]}px)`,
        displayRules.noteShown
        && displayRules.plainHeights.length === SONGS.length
        && displayRules.plainHeights.every(height => height <= 48)
        && displayRules.notesHeights.join() === displayRules.plainHeights.join());

    // ---- Star from the now-playing card; every view follows.
    const nowPlayingStar = await tab.evaluate(() => {
        const c = window.musicController;
        const shenandoah = c.playlist[1];
        void c.playVideo(shenandoah);
        const star = /** @type {HTMLButtonElement} */ (document.getElementById('nowPlayingStarBtn'));
        const rowStar = () => document.querySelector(`.playlist-row[data-item-id="${shenandoah.id}"] .favorite-btn`);
        const before = { card: star.classList.contains('favorited'), row: rowStar()?.classList.contains('favorited'), count: document.getElementById('playlistStarCount')?.textContent };
        star.click();
        const after = {
            card: star.classList.contains('favorited'),
            row: rowStar()?.classList.contains('favorited'),
            count: document.getElementById('playlistStarCount')?.textContent,
            stored: !!SettingsStore.peekData(StorageKeys.PLAYER_FAVORITES)?.[shenandoah.videoId],
            status: document.getElementById('status')?.textContent
        };
        /** @type {HTMLButtonElement} */ (rowStar()).click();
        const unstarredFromRow = { card: star.classList.contains('favorited'), label: star.getAttribute('aria-label') };
        return { before, after, unstarredFromRow };
    });
    report.check(`now-playing star and row stars are one favorite (${nowPlayingStar.before.count} -> ${nowPlayingStar.after.count} starred)`,
        !nowPlayingStar.before.card && !nowPlayingStar.before.row
        && nowPlayingStar.after.card && nowPlayingStar.after.row
        && nowPlayingStar.after.stored
        && Number(nowPlayingStar.after.count) === Number(nowPlayingStar.before.count) + 1
        && nowPlayingStar.after.status === 'Starred: Shenandoah'
        && !nowPlayingStar.unstarredFromRow.card
        && nowPlayingStar.unstarredFromRow.label === 'Star this song');

    // ---- Favorites only: live hide on unstar, and Next/Previous follow the view.
    const favoritesOnly = await tab.evaluate(() => {
        const c = window.musicController;
        const shownNames = () => c.playlist
            .filter(item => !document.querySelector(`.playlist-row[data-item-id="${item.id}"]`)?.hidden)
            .map(item => item.name);
        void c.playVideo(c.playlist[0]);
        const toggle = /** @type {HTMLInputElement} */ (document.getElementById('playlistFavoritesOnlyToggle'));
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
        const shown = shownNames();
        const statusText = document.getElementById('playlistFilterStatusText')?.textContent || '';
        c.playNext();
        const afterNext = c.playingPlaylistItem()?.name;
        c.playNext();
        const afterSecondNext = c.playingPlaylistItem()?.name;
        c.playNext();
        const wrapped = c.playingPlaylistItem()?.name;
        c.playPrevious();
        const afterPrevious = c.playingPlaylistItem()?.name;
        const water = c.playlist.find(item => item.name === 'The Water Is Wide');
        /** @type {HTMLButtonElement} */ (document.querySelector(`.playlist-row[data-item-id="${water.id}"] .favorite-btn`)).click();
        const afterUnstar = shownNames();
        const hiddenStatus = document.getElementById('status')?.textContent;
        /** @type {HTMLButtonElement} */ (document.querySelector(`.playlist-row[data-item-id="${water.id}"] .favorite-btn`)).click();
        const afterRestar = shownNames();
        const persisted = SettingsStore.peekData(StorageKeys.PLAYER_SETTINGS)?.playlistFavoritesOnly;
        return { shown, statusText, afterNext, afterSecondNext, wrapped, afterPrevious, afterUnstar, hiddenStatus, afterRestar, persisted };
    });
    report.check(`Favorites only hides unstarred rows and updates live as stars change (${favoritesOnly.shown.join(', ')})`,
        favoritesOnly.shown.join('|') === 'Amazing Grace|The Water Is Wide|Greensleeves'
        && favoritesOnly.statusText.startsWith('Filtering for favorites only - 3 of 6 shown')
        && favoritesOnly.afterUnstar.join('|') === 'Amazing Grace|Greensleeves'
        && favoritesOnly.hiddenStatus === 'Unstarred: The Water Is Wide - hidden by Favorites only'
        && favoritesOnly.afterRestar.join('|') === 'Amazing Grace|The Water Is Wide|Greensleeves'
        && favoritesOnly.persisted === true);
    report.check(`Next and Previous step through the shown songs only (${favoritesOnly.afterNext} -> ${favoritesOnly.afterSecondNext} -> ${favoritesOnly.wrapped} <- ${favoritesOnly.afterPrevious})`,
        favoritesOnly.afterNext === 'The Water Is Wide'
        && favoritesOnly.afterSecondNext === 'Greensleeves'
        && favoritesOnly.wrapped === 'Amazing Grace'
        && favoritesOnly.afterPrevious === 'Greensleeves');

    // ---- Load favorites (one tap), Unload unstarred (keeps the playing song), Show all.
    const curation = await tab.evaluate(() => {
        const c = window.musicController;
        document.getElementById('playlistFilterCancelBtn')?.click();
        const showAllCleared = !c.settings.playlistFavoritesOnly
            && !/** @type {HTMLInputElement} */ (document.getElementById('playlistFavoritesOnlyToggle')).checked
            && c.playlist.every(item => !document.querySelector(`.playlist-row[data-item-id="${item.id}"]`)?.hidden);
        const countBefore = document.getElementById('loadFavoritesCount')?.textContent;
        document.getElementById('loadFavoritesBtn')?.click();
        const loaded = { count: document.getElementById('loadFavoritesCount')?.textContent, songs: c.playlist.length, status: document.getElementById('status')?.textContent };
        document.getElementById('loadFavoritesBtn')?.click();
        const reloadedStatus = document.getElementById('status')?.textContent;
        const danny = c.playlist.find(item => item.name === 'Danny Boy');
        void c.playVideo(danny);
        document.getElementById('unloadUnstarredBtn')?.click();
        return {
            showAllCleared,
            countBefore,
            loaded,
            reloadedStatus,
            afterUnload: c.playlist.map(item => item.name),
            rows: document.querySelectorAll('#playlistBody .playlist-row').length,
            playing: c.playingPlaylistItem()?.name,
            stillPlaying: c.isPlaying && !c.isPaused,
            unloadStatus: document.getElementById('status')?.textContent,
            persisted: SettingsStore.peekData(StorageKeys.PLAYER_PLAYLIST)?.items.map(item => item.name)
        };
    });
    report.check(`Show all clears Favorites only; Load favorites adds the missing ones in one tap (${curation.countBefore} -> ${curation.loaded.count})`,
        curation.showAllCleared
        && curation.countBefore === '+2'
        && curation.loaded.count === '+0'
        && curation.loaded.songs === 8
        && curation.loaded.status === 'Loaded 2 favorites'
        && curation.reloadedStatus === 'All 5 favorites are already in the playlist');
    report.check(`Unload unstarred drops unstarred songs but never cuts off the playing one (${curation.afterUnload.join(', ')})`,
        curation.afterUnload.join('|') === 'Amazing Grace|Danny Boy|The Water Is Wide|Greensleeves|Barbara Allen|The Parting Glass'
        && curation.rows === 6
        && curation.playing === 'Danny Boy'
        && curation.stillPlaying
        && curation.unloadStatus === 'Unloaded 2 unstarred songs; the playing song stays until you skip it'
        && curation.persisted?.join('|') === curation.afterUnload.join('|'));

    // ---- Voice grammar reaches the same controls.
    const voice = await tab.evaluate(() => {
        const c = window.musicController;
        return ['load favorites', 'play my favourites', 'star this', 'unstar this song', 'favorites only',
            'show only starred songs', 'show all', 'unload unstarred', 'remove non-favorites', 'next', 'star wars theme']
            .map(phrase => c.parseControlCommand(phrase));
    });
    report.check(`voice commands reach the curation controls (${voice.join(', ')})`,
        voice.join('|') === 'loadfavorites|loadfavorites|star|unstar|favoritesonly|favoritesonly|showall|unloadunstarred|unloadunstarred|next|');

    // ---- A linked-page build ends visibly at "tap Play": status, request card, and Play all on screen.
    const linkedPage = await tab.evaluate(() => {
        const c = window.musicController;
        c.transcript.show('Linked page (onlyURL=true): https://example.test/album');
        c.updateStatus('Playlist ready: 6 songs - tap Play to start');
        const onScreen = id => {
            const box = /** @type {HTMLElement} */ (document.getElementById(id)).getBoundingClientRect();
            return box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight;
        };
        document.querySelector('main').scrollTop = 0;
        return { status: onScreen('status'), request: onScreen('transcriptContainer'), play: onScreen('transportPlayPauseBtn') };
    });
    report.check('a linked-page build shows its request, the tap-Play status, and Play without scrolling',
        linkedPage.status && linkedPage.request && linkedPage.play);

    // ---- Big Lyrics: star and transport ride along; display options are canonical segment rows.
    const overlay = await tab.evaluate(() => {
        const c = window.musicController;
        c.openLyricsOverlay();
        const star = /** @type {HTMLButtonElement} */ (document.getElementById('lyricsOverlayStarBtn'));
        const starredBefore = star.classList.contains('favorited');
        star.click();
        const starredAfter = star.classList.contains('favorited');
        const cardAgrees = document.getElementById('nowPlayingStarBtn')?.classList.contains('favorited') === starredAfter;
        star.click();
        /** @type {HTMLElement} */ (document.querySelector('[data-lyrics-width="focus"]')).click();
        document.getElementById('lyricsFontUpBtn')?.click();
        const view = {
            width: getComputedStyle(/** @type {HTMLElement} */ (document.getElementById('lyricsOverlay'))).getPropertyValue('--lyrics-overlay-width').trim(),
            focusSelected: document.querySelector('[data-lyrics-width="focus"]')?.classList.contains('selected'),
            size: document.getElementById('lyricsFontValue')?.textContent
        };
        /** @type {HTMLElement} */ (document.querySelector('[data-lyrics-width="wide"]')).click();
        document.getElementById('lyricsFontDownBtn')?.click();
        c.closeLyricsOverlay();
        return { starredBefore, starredAfter, cardAgrees, view };
    });
    report.check(`Big Lyrics stars the sounding song and uses fluid widths (${overlay.view.width}, size ${overlay.view.size})`,
        overlay.starredAfter !== overlay.starredBefore
        && overlay.cardAgrees
        && overlay.view.width === '74%'
        && overlay.view.focusSelected
        && overlay.view.size === '112%');

    // ---- Static guard: the page sheet never declares translucent or gray text.
    const css = fs.readFileSync(path.join(__dirname, '..', 'player.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    /** Equal-channel hex other than pure black/white is gray. @param {string} value */
    const isGrayHex = value => {
        const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
        if (!hex) return false;
        const channels = hex.length === 3 ? hex.split('').map(c => c + c) : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];
        return channels.every(channel => channel.toLowerCase() === channels[0].toLowerCase())
            && !['00', 'ff'].includes(channels[0].toLowerCase());
    };
    const grayText = [...css.matchAll(/(?:^|[;{\s])color:\s*([^;]+);/g)]
        .map(match => match[1].trim())
        .filter(value => /rgba\([^)]*,\s*0?\.\d+\)/.test(value) || isGrayHex(value) || /gr[ae]y/i.test(value));
    report.check(`player.css declares no translucent or gray text colors (${grayText.join(', ') || 'none'})`, grayText.length === 0);

    await ctx.close();
    await browser.close();
    report.finish();
})();
