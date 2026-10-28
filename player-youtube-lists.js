// @ts-check
// YouTube channel and playlist browsing for the Find music card. A pasted
// channel link opens a card listing the channel's uploads, popular videos,
// live streams, releases, and playlists (a pasted playlist link opens that
// playlist); the listed videos then go to the working playlist all at
// once, filtered, or hand-picked. Listings come from proxy.php's youtube
// mode, which owns the shared server cache and the outbound request
// budget. Nothing here retries, and a page already in the card is never
// requested again while the card is open.

const PlayerYouTubeLists = (function () {
    'use strict';

    const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
    const CHANNEL_PATH = /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)(?:\/([^/]+))?/;
    /** A channel tab in a pasted link names the section the card opens on. */
    const SECTION_FOR_TAB = Object.freeze({ videos: 'videos', streams: 'live', releases: 'releases', playlists: 'playlists' });
    const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
    // Mixes (RD...) are generated per viewer, and Watch later and Liked
    // videos (WL, LL, LM) are private: none of them can be listed.
    const UNLISTABLE_PLAYLIST = /^(?:RD|(?:WL|LL|LM)$)/;
    /** One Load all press stops after this many more videos (ten pages). */
    const LOAD_ALL_VIDEO_CAP = 1000;
    const AGE_UNITS = Object.freeze({ second: 's', minute: 'min', hour: 'h', day: 'd', week: 'wk', month: 'mo', year: 'y' });

    /**
     * The channel or playlist a submitted text names, or null. Only a text
     * that is one YouTube link and nothing else opens the card; search
     * words and plain video links stay searches.
     * @param {string} text
     * @returns {YouTubeListLink | null}
     */
    function parseLink(text) {
        const trimmed = String(text || '').trim();
        if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
        let url = null;
        try {
            url = new URL(trimmed);
        } catch (_invalidUrl) {
            return null;
        }
        const host = url.hostname.toLowerCase();
        const list = url.searchParams.get('list') || '';
        if (list && (YOUTUBE_HOSTS.has(host) || host === 'youtu.be')
            && PLAYLIST_ID.test(list) && !UNLISTABLE_PLAYLIST.test(list)) {
            return { kind: 'playlist', text: trimmed, playlistId: list };
        }
        if (!YOUTUBE_HOSTS.has(host)) return null;
        const channel = url.pathname.match(CHANNEL_PATH);
        if (!channel) return null;
        return { kind: 'channel', text: trimmed, url: trimmed, section: SECTION_FOR_TAB[(channel[1] || '').toLowerCase()] || '' };
    }

    /**
     * One request to proxy.php's youtube mode. A refusal (no such channel,
     * a used-up request budget) arrives as an error naming the reason.
     * @param {Record<string, string>} params
     */
    async function requestListing(params) {
        const response = await fetch(`proxy.php?${new URLSearchParams(params)}`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        return response.json();
    }

    /** @param {unknown} error */
    function errorText(error) {
        return error instanceof Error ? error.message : String(error);
    }

    /** @param {number} value */
    function formatCount(value) {
        return value.toLocaleString('en-US');
    }

    /** YouTube's "3 hours ago" / "Streamed 5 years ago" as "3h ago" / "5y ago". @param {string} published */
    function compactAge(published) {
        const match = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(published || '');
        return match ? `${match[1]}${AGE_UNITS[match[2].toLowerCase()]} ago` : '';
    }

    /**
     * The channel a listed video counts as. A collaboration byline that
     * starts with the list's owner ("Fleet Foxes and ANTI- Records") is the
     * owner's own upload.
     * @param {YouTubeListVideo} video @param {YouTubeVideoList} list
     */
    function videoChannel(video, list) {
        const owner = list.ownerTitle;
        if (owner && (video.channelTitle.startsWith(`${owner} and `) || video.channelTitle.startsWith(`${owner}, `))) return owner;
        return video.channelTitle || owner;
    }

    /**
     * A row's title without a leading "<channel> - ", which the row already
     * says; the song itself still parses the whole title.
     * @param {string} title @param {string} channel
     */
    function rowTitle(title, channel) {
        if (!channel) return title;
        for (const separator of [' - ', ' \u2013 ', ' \u2014 ']) {
            const prefix = `${channel}${separator}`.toLowerCase();
            if (title.length > prefix.length && title.toLowerCase().startsWith(prefix)) return title.slice(prefix.length);
        }
        return title;
    }

    /** @param {YouTubeListVideo} video @param {string} query normalized */
    function videoMatches(video, query) {
        return PlayerSongs.songFieldsMatchQuery([video.title, video.channelTitle], query);
    }

    /** @param {YouTubeListPlaylist} playlist @param {string} query normalized */
    function playlistMatches(playlist, query) {
        return PlayerSongs.songFieldsMatchQuery([playlist.title], query);
    }

    /** @param {YouTubeListLink} link @returns {YouTubeListState} */
    function newState(link) {
        return { link, channel: null, sections: [], lists: new Map(), sectionKey: '', shownKey: '', backKey: '', filter: '', error: '' };
    }

    /**
     * The card's list for one playlist, created on first use.
     * @param {YouTubeListState} state @param {string} playlistId @param {string} title
     * @param {string} album the release title when opened from Releases
     * @returns {YouTubeVideoList}
     */
    function videoList(state, playlistId, title, album) {
        const key = `playlist:${playlistId}`;
        const existing = state.lists.get(key);
        if (existing?.kind === 'videos') return existing;
        /** @type {YouTubeVideoList} */
        const list = {
            kind: 'videos', key, playlistId, title, ownerTitle: '', videoCount: null, album,
            videos: [], continuation: null, picked: new Set(),
            loaded: false, loading: false, loadingAll: false, stopLoadingAll: false, note: '', error: ''
        };
        state.lists.set(key, list);
        return list;
    }

    /**
     * @param {YouTubeListState} state @param {string} key @param {string} title
     * @returns {YouTubePlaylistList}
     */
    function playlistList(state, key, title) {
        const existing = state.lists.get(key);
        if (existing?.kind === 'playlists') return existing;
        /** @type {YouTubePlaylistList} */
        const list = { kind: 'playlists', key, title, playlists: [], continuation: null, loaded: false, loading: false, note: '', error: '' };
        state.lists.set(key, list);
        return list;
    }

    /**
     * Fold a page of videos into a list; a video YouTube lists twice is kept once.
     * @param {YouTubeVideoList} list @param {YouTubeListVideo[]} videos
     * @returns {YouTubeListVideo[]} the videos that were new
     */
    function addVideos(list, videos) {
        const known = new Set(list.videos.map(video => video.videoId));
        const fresh = videos.filter(video => {
            if (known.has(video.videoId)) return false;
            known.add(video.videoId);
            return true;
        });
        list.videos.push(...fresh);
        return fresh;
    }

    /**
     * @param {YouTubePlaylistList} list @param {YouTubeListPlaylist[]} playlists
     * @returns {YouTubeListPlaylist[]} the playlists that were new
     */
    function addPlaylists(list, playlists) {
        const known = new Set(list.playlists.map(playlist => playlist.playlistId));
        const fresh = playlists.filter(playlist => {
            if (known.has(playlist.playlistId)) return false;
            known.add(playlist.playlistId);
            return true;
        });
        list.playlists.push(...fresh);
        return fresh;
    }

    /** @param {YouTubeListState} state */
    function shownList(state) {
        return state.lists.get(state.shownKey) || null;
    }

    /**
     * What Play and Add act on: the picked videos the filter shows, or every
     * shown video when none of those is picked.
     * @param {YouTubeListState} state @param {YouTubeVideoList} list
     */
    function actionVideos(state, list) {
        const shown = list.videos.filter(video => videoMatches(video, state.filter));
        const picked = shown.filter(video => list.picked.has(video.videoId));
        return { videos: picked.length > 0 ? picked : shown, picked: picked.length > 0 };
    }

    /** "KEXP · Videos" for a channel's list; a pasted playlist is its own name. @param {YouTubeListState} state @param {YouTubeVideoList} list */
    function listName(state, list) {
        return state.channel ? `${state.channel.title} \u00b7 ${rowTitle(list.title, state.channel.title)}` : list.title;
    }

    /** @param {string} id @param {boolean} visible */
    function setVisible(id, visible) {
        const element = document.getElementById(id);
        if (element) element.hidden = !visible;
    }

    /** @param {string} id @param {string} label @param {boolean} disabled */
    function setButton(id, label, disabled) {
        const button = /** @type {HTMLButtonElement | null} */ (document.getElementById(id));
        if (!button) return;
        button.textContent = label;
        button.disabled = disabled;
    }

    /** @param {PlayerController} controller @param {YouTubeListVideo} video @param {YouTubeVideoList} list */
    function videoRowHtml(controller, video, list) {
        const esc = (/** @type {string} */ text) => controller.escapeHtml(text);
        const channel = videoChannel(video, list);
        return `<label class="youtube-list-row" data-video-id="${esc(video.videoId)}">`
            + `<input type="checkbox" data-youtube-pick="${esc(video.videoId)}"${list.picked.has(video.videoId) ? ' checked' : ''} aria-label="Pick ${esc(video.title)}">`
            + `<span class="youtube-list-row-title">${esc(rowTitle(video.title, channel))}</span>`
            + (channel !== list.ownerTitle ? `<span class="youtube-list-row-channel">${esc(channel)}</span>` : '')
            + `<span class="youtube-list-row-age">${esc(compactAge(video.published))}</span>`
            + `<span class="youtube-list-row-duration">${esc(video.duration)}</span>`
            + '</label>';
    }

    /** @param {PlayerController} controller @param {YouTubeListPlaylist} playlist @param {string} owner */
    function playlistRowHtml(controller, playlist, owner) {
        const esc = (/** @type {string} */ text) => controller.escapeHtml(text);
        const count = playlist.videoCount === null ? ''
            : `<span class="youtube-list-row-count"><span class="youtube-list-value">${formatCount(playlist.videoCount)}</span> video${playlist.videoCount === 1 ? '' : 's'}</span>`;
        return `<div class="youtube-list-row youtube-list-playlist-row" data-playlist-id="${esc(playlist.playlistId)}">`
            + `<span class="youtube-list-row-title">${esc(rowTitle(playlist.title, owner))}</span>`
            + count
            + `<button class="panel-action-btn" type="button" data-youtube-open="${esc(playlist.playlistId)}">Open</button>`
            + '</div>';
    }

    /**
     * @param {PlayerController} controller @param {YouTubeListState} state @param {YouTubeList} list
     * @param {Array<YouTubeListVideo | YouTubeListPlaylist>} entries
     */
    function rowsHtml(controller, state, list, entries) {
        return list.kind === 'videos'
            ? /** @type {YouTubeListVideo[]} */ (entries).map(video => videoRowHtml(controller, video, list)).join('')
            : /** @type {YouTubeListPlaylist[]} */ (entries).map(playlist => playlistRowHtml(controller, playlist, state.channel?.title || '')).join('');
    }

    /** Hide the rows the filter excludes. @param {YouTubeListState} state */
    function applyFilter(state) {
        const list = shownList(state);
        const rows = document.getElementById('youtubeListRows');
        if (!list || !rows) return;
        if (list.kind === 'videos') {
            const byId = new Map(list.videos.map(video => [video.videoId, video]));
            rows.querySelectorAll('[data-video-id]').forEach(row => {
                const video = byId.get(/** @type {HTMLElement} */ (row).dataset.videoId || '');
                /** @type {HTMLElement} */ (row).hidden = !video || !videoMatches(video, state.filter);
            });
        } else {
            const byId = new Map(list.playlists.map(playlist => [playlist.playlistId, playlist]));
            rows.querySelectorAll('[data-playlist-id]').forEach(row => {
                const playlist = byId.get(/** @type {HTMLElement} */ (row).dataset.playlistId || '');
                /** @type {HTMLElement} */ (row).hidden = !playlist || !playlistMatches(playlist, state.filter);
            });
        }
    }

    /** The one-line status: counts as the most legible values, then any activity or problem. @param {PlayerController} controller @param {YouTubeListState} state */
    function statusHtml(controller, state) {
        const value = (/** @type {number} */ count) => `<span class="youtube-list-value">${formatCount(count)}</span>`;
        const problem = (/** @type {string} */ text) => `<span class="youtube-list-error">${controller.escapeHtml(text)}</span>`;
        if (state.error) return problem(state.error);
        const list = shownList(state);
        if (!list) return `Opening the ${state.link.kind}...`;
        const parts = [];
        if (list.loaded && list.kind === 'videos') {
            const loaded = list.videos.length;
            const total = list.videoCount;
            const partial = total !== null && total !== loaded;
            parts.push(`${value(loaded)}${partial ? ` of ${value(total)}` : ''} video${(total ?? loaded) === 1 ? '' : 's'}`
                + (list.continuation ? ' loaded' : (partial ? ', end of list' : '')));
            const { videos, picked } = actionVideos(state, list);
            if (state.filter) parts.push(`${value(list.videos.filter(video => videoMatches(video, state.filter)).length)} shown`);
            if (picked) parts.push(`${value(videos.length)} picked`);
        } else if (list.loaded && list.kind === 'playlists') {
            const noun = list.key === 'releases' ? 'release' : 'playlist';
            parts.push(`${value(list.playlists.length)} ${noun}${list.playlists.length === 1 ? '' : 's'}${list.continuation ? ' loaded, more available' : ''}`);
            if (state.filter) parts.push(`${value(list.playlists.filter(playlist => playlistMatches(playlist, state.filter)).length)} shown`);
        }
        if (list.loading) parts.push(list.loaded ? 'loading more...' : 'loading...');
        if (list.note) parts.push(controller.escapeHtml(list.note));
        if (list.error) parts.push(problem(list.error));
        return parts.join(' \u00b7 ');
    }

    /** Status line, action labels, and which controls the shown list offers. @param {PlayerController} controller */
    function refresh(controller) {
        const state = controller.youtubeList;
        if (!state) return;
        const list = shownList(state);
        const status = document.getElementById('youtubeListStatus');
        if (status) status.innerHTML = statusHtml(controller, state);

        const videos = list?.kind === 'videos' && list.loaded ? list : null;
        const target = videos ? actionVideos(state, videos) : null;
        const count = target ? formatCount(target.videos.length) : '0';
        const suffix = target?.picked ? ' picked' : '';
        setVisible('youtubeListToolbar', Boolean(list?.loaded));
        setVisible('youtubeListPickShownBtn', Boolean(videos));
        setVisible('youtubeListPickNoneBtn', Boolean(videos));
        setButton('youtubeListPickNoneBtn', 'Pick none', !videos || videos.picked.size === 0);
        setVisible('youtubeListPlayBtn', Boolean(videos));
        setVisible('youtubeListAddBtn', Boolean(videos));
        setButton('youtubeListPlayBtn', `Play ${count}${suffix}`, !target || target.videos.length === 0);
        setButton('youtubeListAddBtn', `Add ${count}${suffix}`, !target || target.videos.length === 0);
        setVisible('youtubeListMoreBtn', Boolean(list?.loaded && list.continuation));
        setButton('youtubeListMoreBtn', videos ? 'Load 100 more' : 'Load more', Boolean(list?.loading));
        setVisible('youtubeListAllBtn', Boolean(videos && (videos.continuation || videos.loadingAll)));
        setButton('youtubeListAllBtn', videos?.loadingAll ? 'Stop loading' : 'Load all', Boolean(videos && !videos.loadingAll && videos.loading));
    }

    /** Redraw the whole card from its state. @param {PlayerController} controller */
    function render(controller) {
        const state = controller.youtubeList;
        if (!state) return;
        const list = shownList(state);
        const title = state.channel?.title || list?.title || (state.link.kind === 'channel' ? 'YouTube channel' : 'YouTube playlist');
        const owner = state.channel ? state.channel.handle : (list?.kind === 'videos' ? list.ownerTitle : '');
        PracticeControls.setValueText('youtubeListTitle', title);
        PracticeControls.setValueText('youtubeListOwner', owner);

        const sections = document.getElementById('youtubeListSections');
        if (sections) {
            sections.hidden = state.sections.length === 0;
            sections.innerHTML = state.sections.map(section =>
                `<button class="vf-btn" type="button" data-youtube-section="${controller.escapeHtml(section.key)}">${controller.escapeHtml(section.title)}</button>`).join('');
            PracticeControls.syncSingleSelect('data-youtube-section', state.sectionKey);
        }
        setVisible('youtubeListSubheader', Boolean(state.backKey));
        PracticeControls.setValueText('youtubeListSubtitle', state.backKey && list ? rowTitle(list.title, state.channel?.title || '') : '');

        const rows = document.getElementById('youtubeListRows');
        if (rows) {
            rows.innerHTML = list?.loaded
                ? rowsHtml(controller, state, list, list.kind === 'videos' ? list.videos : list.playlists)
                : '';
            rows.scrollTop = 0;
        }
        applyFilter(state);
        refresh(controller);
    }

    /**
     * Load a list's first page unless it is loaded or on its way. A failure
     * stays on the list (shown in the status line) instead of throwing.
     * @param {PlayerController} controller @param {YouTubeListState} state @param {YouTubeList} list
     */
    async function ensureLoaded(controller, state, list) {
        if (list.loaded || list.loading) return;
        list.loading = true;
        list.error = '';
        if (state.shownKey === list.key) refresh(controller);
        try {
            if (list.kind === 'videos') {
                const answer = await requestListing({ youtube: 'playlist', id: list.playlistId });
                if (controller.youtubeList !== state) return;
                list.title = list.title || answer.playlist.title;
                list.ownerTitle = answer.playlist.ownerTitle;
                list.videoCount = answer.playlist.videoCount;
                addVideos(list, answer.videos);
                list.continuation = answer.continuation;
            } else {
                const answer = await requestListing({ youtube: 'releases', id: state.channel?.id || '' });
                if (controller.youtubeList !== state) return;
                addPlaylists(list, answer.playlists);
                list.continuation = answer.continuation;
            }
            list.loaded = true;
        } catch (error) {
            if (controller.youtubeList !== state) return;
            list.error = `YouTube list failed: ${errorText(error)}`;
            controller.logError('YouTube list', error);
        } finally {
            list.loading = false;
        }
        if (state.shownKey === list.key) render(controller);
    }

    /**
     * Append the list's next page. Returns how many new entries arrived.
     * @param {PlayerController} controller @param {YouTubeListState} state @param {YouTubeList} list
     */
    async function loadNextPage(controller, state, list) {
        const token = list.continuation;
        if (!token || list.loading) return 0;
        list.loading = true;
        list.error = '';
        list.note = '';
        if (state.shownKey === list.key) refresh(controller);
        /** @type {Array<YouTubeListVideo | YouTubeListPlaylist>} */
        let fresh = [];
        try {
            const answer = await requestListing({ youtube: 'more', token });
            if (controller.youtubeList !== state) return 0;
            fresh = list.kind === 'videos' ? addVideos(list, answer.videos) : addPlaylists(list, answer.playlists);
            // A page pointing back at itself ends the list instead of looping.
            list.continuation = answer.continuation === token ? null : answer.continuation;
        } catch (error) {
            if (controller.youtubeList !== state) return 0;
            list.error = `YouTube list failed: ${errorText(error)}`;
            controller.logError('YouTube list', error);
        } finally {
            list.loading = false;
        }
        const rows = document.getElementById('youtubeListRows');
        if (state.shownKey === list.key && rows) {
            rows.insertAdjacentHTML('beforeend', rowsHtml(controller, state, list, fresh));
            applyFilter(state);
        }
        if (state.shownKey === list.key) refresh(controller);
        return fresh.length;
    }

    /**
     * Load pages until the list ends, a page fails, Stop is pressed, or this
     * press has brought LOAD_ALL_VIDEO_CAP more videos.
     * @param {PlayerController} controller @param {YouTubeListState} state @param {YouTubeVideoList} list
     */
    async function loadAllPages(controller, state, list) {
        if (list.loadingAll || list.loading) return;
        list.loadingAll = true;
        list.stopLoadingAll = false;
        list.error = '';
        const start = list.videos.length;
        while (list.continuation && !list.stopLoadingAll && !list.error && controller.youtubeList === state) {
            if (list.videos.length - start >= LOAD_ALL_VIDEO_CAP) {
                list.note = `stopped after ${formatCount(LOAD_ALL_VIDEO_CAP)} more; Load all again continues`;
                break;
            }
            await loadNextPage(controller, state, list);
        }
        list.loadingAll = false;
        if (state.shownKey === list.key) refresh(controller);
    }

    /**
     * Show one of the channel's sections, loading its first page if needed.
     * @param {PlayerController} controller @param {YouTubeListState} state @param {string} sectionKey
     */
    async function showSection(controller, state, sectionKey) {
        const section = state.sections.find(entry => entry.key === sectionKey);
        if (!section) return;
        const list = section.playlistId
            ? videoList(state, section.playlistId, section.title, '')
            : playlistList(state, section.key, section.title);
        state.sectionKey = section.key;
        state.shownKey = list.key;
        state.backKey = '';
        render(controller);
        await ensureLoaded(controller, state, list);
    }

    /**
     * Open a playlist or release from the shown Playlists or Releases list;
     * Back returns to that list.
     * @param {PlayerController} controller @param {YouTubeListState} state @param {string} playlistId
     */
    async function openPlaylist(controller, state, playlistId) {
        const from = shownList(state);
        if (from?.kind !== 'playlists') return;
        const entry = from.playlists.find(playlist => playlist.playlistId === playlistId);
        if (!entry) return;
        const list = videoList(state, playlistId, entry.title, from.key === 'releases' ? entry.title : '');
        state.backKey = from.key;
        state.shownKey = list.key;
        render(controller);
        await ensureLoaded(controller, state, list);
    }

    /**
     * Playlist items for listed videos: titles split into artist and song
     * the same way direct search results are, and a release's title as the
     * album.
     * @param {PlayerController} controller @param {YouTubeListState} state
     * @param {YouTubeVideoList} list @param {YouTubeListVideo[]} videos
     * @returns {PlaylistItem[]}
     */
    function playlistItemsFor(controller, state, list, videos) {
        const sourceLabel = `YouTube: ${listName(state, list)}`;
        /** @type {PlaylistItem[]} */
        const items = [];
        for (const video of videos) {
            const song = PlayerSongs.songFromYouTubeCandidate({
                videoId: video.videoId,
                title: video.title,
                channelTitle: videoChannel(video, list),
                duration: video.duration,
                album: list.album
            }, video.title);
            const item = song && PlayerSongs.createPlaylistItem(song, { sourceKind: 'youtube', sourceLabel, sourceSearchTerm: video.title });
            if (item) items.push(item);
        }
        return items;
    }

    /**
     * Put new items into the working playlist, record them, and clear the
     * picks they came from.
     * @param {PlayerController} controller @param {YouTubeVideoList} list @param {PlaylistItem[]} items
     */
    function commitItems(controller, list, items) {
        controller.appendPlaylistItems(items);
        if (window.PlayerHistoryDB) {
            window.PlayerHistoryDB.recordSongs(items, 'youtube-list');
        }
        controller.updatePlaylistLabel();
        controller.persistPlaylist();
        list.picked.clear();
        document.querySelectorAll('#youtubeListRows [data-youtube-pick]:checked').forEach(input => {
            /** @type {HTMLInputElement} */ (input).checked = false;
        });
        refresh(controller);
    }

    /**
     * Play: the shown (or picked) videos replace the working playlist the way
     * a search does - a song already playing keeps playing at the top.
     * @param {PlayerController} controller
     */
    function playShown(controller) {
        const state = controller.youtubeList;
        const list = state && shownList(state);
        if (!state || list?.kind !== 'videos') return;
        const current = controller.playlist.find(entry => entry.id === controller.currentPlayingId);
        const keepVideoId = current && (controller.isPlaying || controller.isPaused) ? current.videoId : '';
        const items = playlistItemsFor(controller, state, list,
            actionVideos(state, list).videos.filter(video => video.videoId !== keepVideoId));
        if (items.length === 0) {
            controller.updateStatus('That video is already playing');
            return;
        }
        const previousCount = controller.playlist.length;
        const keptCurrent = controller.replacePlaylistItemsKeepingCurrent();
        if (previousCount > 0) {
            const droppedCount = previousCount - (keptCurrent ? 1 : 0);
            controller.addMessage('claude', 'YouTube list',
                `Replaced the working playlist (${droppedCount} song${droppedCount === 1 ? '' : 's'} stay in Known Songs history${keptCurrent ? '; current song keeps playing' : ''})`);
        }
        commitItems(controller, list, items);
        const summary = `${formatCount(items.length)} video${items.length === 1 ? '' : 's'} from ${listName(state, list)}`;
        controller.addMessage('claude', 'YouTube list', `Playing ${summary}`);
        if (!controller.isPlaying) controller.playPlaylist();
        controller.updateStatus(`Playing ${summary}`);
    }

    /**
     * Add: the shown (or picked) videos go after the working playlist's
     * songs; videos already in it are skipped.
     * @param {PlayerController} controller
     */
    function addShown(controller) {
        const state = controller.youtubeList;
        const list = state && shownList(state);
        if (!state || list?.kind !== 'videos') return;
        const inPlaylist = new Set(controller.playlist.map(item => item.videoId));
        const chosen = actionVideos(state, list).videos;
        const items = playlistItemsFor(controller, state, list, chosen.filter(video => !inPlaylist.has(video.videoId)));
        const skipped = chosen.length - items.length;
        commitItems(controller, list, items);
        const summary = `Added ${formatCount(items.length)} video${items.length === 1 ? '' : 's'} from ${listName(state, list)}`
            + (skipped > 0 ? ` (${formatCount(skipped)} already in the playlist)` : '');
        controller.addMessage('claude', 'YouTube list', summary);
        controller.updateStatus(summary);
    }

    /** @param {PlayerController} controller */
    function install(controller) {
        controller.youtubeList = null;

        Object.assign(controller, /** @type {ThisType<PlayerController>} */ ({
            setupYouTubeListUI() {
                const filterInput = /** @type {HTMLInputElement | null} */ (document.getElementById('youtubeListFilterInput'));
                const rows = document.getElementById('youtubeListRows');
                document.getElementById('youtubeListCloseBtn')?.addEventListener('click', () => this.closeYouTubeList());
                document.getElementById('youtubeListBackBtn')?.addEventListener('click', () => {
                    const state = this.youtubeList;
                    if (!state?.backKey) return;
                    state.shownKey = state.backKey;
                    state.backKey = '';
                    render(this);
                });
                document.getElementById('youtubeListSections')?.addEventListener('click', event => {
                    const button = /** @type {Element} */ (event.target).closest('[data-youtube-section]');
                    if (button && this.youtubeList) void showSection(this, this.youtubeList, button.getAttribute('data-youtube-section') || '');
                });
                filterInput?.addEventListener('input', () => {
                    const state = this.youtubeList;
                    if (!state) return;
                    state.filter = PlayerSongs.normalizeSearchQuery(filterInput.value);
                    applyFilter(state);
                    refresh(this);
                });
                document.getElementById('youtubeListPickShownBtn')?.addEventListener('click', () => {
                    const state = this.youtubeList;
                    const list = state && shownList(state);
                    if (!state || list?.kind !== 'videos') return;
                    for (const video of list.videos) {
                        if (videoMatches(video, state.filter)) list.picked.add(video.videoId);
                    }
                    rows?.querySelectorAll('[data-youtube-pick]').forEach(input => {
                        const box = /** @type {HTMLInputElement} */ (input);
                        box.checked = list.picked.has(box.dataset.youtubePick || '');
                    });
                    refresh(this);
                });
                document.getElementById('youtubeListPickNoneBtn')?.addEventListener('click', () => {
                    const state = this.youtubeList;
                    const list = state && shownList(state);
                    if (list?.kind !== 'videos') return;
                    list.picked.clear();
                    rows?.querySelectorAll('[data-youtube-pick]').forEach(input => {
                        /** @type {HTMLInputElement} */ (input).checked = false;
                    });
                    refresh(this);
                });
                rows?.addEventListener('change', event => {
                    const box = /** @type {HTMLInputElement} */ (event.target);
                    const state = this.youtubeList;
                    const list = state && shownList(state);
                    if (list?.kind !== 'videos' || !box.dataset.youtubePick) return;
                    if (box.checked) list.picked.add(box.dataset.youtubePick);
                    else list.picked.delete(box.dataset.youtubePick);
                    refresh(this);
                });
                rows?.addEventListener('click', event => {
                    const row = /** @type {Element} */ (event.target).closest('[data-playlist-id]');
                    const state = this.youtubeList;
                    if (row && state) void openPlaylist(this, state, row.getAttribute('data-playlist-id') || '');
                });
                document.getElementById('youtubeListPlayBtn')?.addEventListener('click', () => playShown(this));
                document.getElementById('youtubeListAddBtn')?.addEventListener('click', () => addShown(this));
                document.getElementById('youtubeListMoreBtn')?.addEventListener('click', () => {
                    const state = this.youtubeList;
                    const list = state && shownList(state);
                    if (state && list) void loadNextPage(this, state, list);
                });
                document.getElementById('youtubeListAllBtn')?.addEventListener('click', () => {
                    const state = this.youtubeList;
                    const list = state && shownList(state);
                    if (!state || list?.kind !== 'videos') return;
                    if (list.loadingAll) {
                        list.stopLoadingAll = true;
                        return;
                    }
                    void loadAllPages(this, state, list);
                });
            },

            /**
             * Open the card for a pasted channel or playlist link. A channel
             * opens on the section its link names (or its first section).
             */
            async openYouTubeListLink(link) {
                this.logUserMessage(link.text);
                this.showRequest(link.text);
                const state = newState(link);
                this.youtubeList = state;
                const filterInput = /** @type {HTMLInputElement | null} */ (document.getElementById('youtubeListFilterInput'));
                if (filterInput) filterInput.value = '';
                setVisible('youtubeListCard', true);
                render(this);
                this.isProcessingRequest = true;
                this.updateRequestUI(true);
                this.updateStatus(`Opening YouTube ${link.kind}...`);
                try {
                    if (link.kind === 'channel') {
                        const answer = await requestListing({ youtube: 'channel', url: link.url });
                        if (this.youtubeList !== state) return;
                        state.channel = answer.channel;
                        state.sections = answer.sections;
                        const playlists = playlistList(state, 'playlists', 'Playlists');
                        addPlaylists(playlists, answer.playlists);
                        playlists.continuation = answer.continuation;
                        playlists.loaded = true;
                        const section = state.sections.find(entry => entry.key === link.section) || state.sections[0];
                        if (!section) {
                            state.error = `${answer.channel.title} has no videos or playlists to list`;
                            render(this);
                            this.updateStatus(state.error);
                            return;
                        }
                        await showSection(this, state, section.key);
                    } else {
                        const list = videoList(state, link.playlistId, '', '');
                        state.shownKey = list.key;
                        await ensureLoaded(this, state, list);
                    }
                    if (this.youtubeList === state) {
                        const list = shownList(state);
                        this.updateStatus(list?.error || `Opened ${state.channel?.title || list?.title || 'the YouTube list'}`);
                    }
                } catch (error) {
                    if (this.youtubeList !== state) return;
                    state.error = `YouTube list failed: ${errorText(error)}`;
                    render(this);
                    this.logError('YouTube list', error);
                    this.updateStatus(state.error);
                } finally {
                    this.isProcessingRequest = false;
                    this.updateRequestUI(false);
                }
            },

            closeYouTubeList() {
                this.youtubeList = null;
                setVisible('youtubeListCard', false);
                const rows = document.getElementById('youtubeListRows');
                if (rows) rows.innerHTML = '';
            }
        }));
    }

    return { install, parseLink };
})();

window.PlayerYouTubeLists = PlayerYouTubeLists;
