/**
 * Music player types — VoiceMusicController is implemented in player.js and
 * extended at runtime by player-commands, player-playlist, and player-lyrics.
 */

interface PlayerAppSettings {
    readClaudeResponse: boolean;
    autoSubmitMode: boolean;
    claudeModel: string;
    openaiModel: string;
    aiProvider: string;
    lyricsOnNowPlaying: boolean;
    showSongNotes: boolean;
}

interface LyricsViewSettings {
    fontScale: number;
    widthMode: 'wide' | 'focus';
    align: 'center' | 'left';
    spacing: 'tight' | 'roomy';
    backdrop: 'blackout' | 'dim';
}

interface YouTubeVideoCandidate {
    videoId: string;
    title: string;
    channelTitle: string;
    duration: string;
    durationSeconds?: number;
}

/**
 * The song primitive. Identity is the YouTube videoId (the key that plays
 * it); everything else is descriptive metadata, always present as typed
 * defaults ('' / 0 / '--:--') so consumers never guess. Built only by
 * PlayerSongs (player-songs.js), never by hand.
 */
interface Song {
    videoId: string;
    name: string;
    artist: string;
    year: string;
    album: string;
    comment: string;
    searchTerm: string;
    title: string;
    channelTitle: string;
    duration: string;
    durationSeconds: number;
}

type PlaylistSourceKind = 'search' | 'favorite' | 'restored' | 'history' | 'demo' | 'backfill';

type PlaylistSortKey = 'artist' | 'year';

/** A Song's membership in the working playlist + runtime lyric state. */
interface PlaylistItem extends Song {
    id: number;
    sourceKind: PlaylistSourceKind;
    sourceLabel: string;
    sourceSearchTerm: string;
    lyricsStatus: 'idle' | 'loading' | 'ready' | 'not_found' | 'error';
    lyricsData: LyricsResult | null;
}

/** What the playlist persists per entry: the Song + membership, no lyric runtime. */
interface PersistedPlaylistEntry extends Song {
    id: number;
    sourceKind: PlaylistSourceKind;
    sourceLabel: string;
    sourceSearchTerm: string;
}

interface FavoriteData extends Song {
    favoritedAt: number;
}

interface SyncedLyricLine {
    time: number;
    text: string;
}

interface LyricsResult {
    provider: string;
    trackName: string;
    artistName: string;
    albumName: string;
    duration: number;
    instrumental: boolean;
    plainLyrics: string;
    syncedLyrics: string | null;
    syncedLines: SyncedLyricLine[];
}

/**
 * A song's lyric state in the permanent store (IndexedDB `lyricStates`,
 * keyed by videoId - the single source of truth for lyrics). 'found'
 * carries the lyrics; 'none' means a provider search ACTUALLY ANSWERED
 * empty at checkedAt (failures save nothing and stay unresolved). Live
 * playlist items are only ever activated from one of these records,
 * after it is read from or saved to the store.
 */
interface LyricStateRecord {
    videoId: string;
    status: 'found' | 'none';
    checkedAt: number;
    lyrics?: LyricsResult;
}

interface SongLibraryNote {
    midi: number;
    startMs: number;
    endMs: number;
    lyric?: string;
    measure?: number;
    beat?: number;
    sourceTrack?: number;
    sourceChannel?: number;
}

interface SongLibraryLyricLine {
    timeMs: number;
    text: string;
}

interface SongLibrarySong {
    id: string;
    title: string;
    sourceType: 'midi' | 'musicxml';
    sourceName: string;
    importedAt: number;
    favorite: boolean;
    tempoBpm: number;
    durationMs: number;
    noteCount: number;
    lyricsText: string;
    lyricLines: SongLibraryLyricLine[];
    notes: SongLibraryNote[];
}

interface SongLibraryStore {
    songs: SongLibrarySong[];
}

interface PlaylistSearchResult {
    addedCount: number;
    skippedCount: number;
    requestedCount: number;
    attemptedTerms: string[];
    skippedTerms: string[];
}

interface PlayerHistoryDBApi {
    setNoticeHandler(handler: (message: string) => void): void;
    recordLog(entry: { type: string; label: string; text: string; line: string }): void;
    recordLookup(lookup: any): void;
    recordSong(song: any, sourceKind: string): void;
    recordSongs(songs: any[], sourceKind: string): void;
    recordYouTubeSearch(query: string, results: any[], meta?: Record<string, any>): void;
    getYouTubeSearch(query: string): Promise<any | null>;
    listLookups(): Promise<any[]>;
    listSongs(): Promise<any[]>;
    listYouTubeSearches(): Promise<any[]>;
    recordFavorite(favorite: any, active: boolean): void;
    putLyricState(record: LyricStateRecord): Promise<void>;
    getLyricState(videoId: string): Promise<LyricStateRecord | null>;
}

interface AppConfig {
    claudeApiKey?: string;
    openaiApiKey?: string;
}

interface VoiceMusicController {
    // Authoritative playback state plus the thin accessors PlayerPlaylist
    // installs over it. These read/write through this.playback so playback
    // state has exactly one storage location.
    playback: PlaybackState;
    readonly isPlaying: boolean;
    readonly isPaused: boolean;
    readonly currentPlayingId: number | null;
    currentPlaylistIndex: number;
    wasPlayingBeforeListening: boolean;
    progressDiff: ValueDiff;
    youtubeApiReadyPromise: Promise<void> | null;
    resolveYouTubeApiReady: (() => void) | null;

    parseControlCommand(transcript: string): string | null;
    executeControlCommand(command: string): void;
    showHelp(): void;
    announceCurrentSong(): void;
    processCommandWithLLM(transcript: string): Promise<any>;
    processCommandWithClaude(transcript: string): Promise<any>;
    processCommandWithOpenAI(transcript: string): Promise<any>;
    buildOpenAIRequest(prompt: string): { url: string; body: any };
    extractOpenAIResponseText(data: any): string;
    extractUrlsFromTranscript(transcript: string): string[];
    inferKnownPageUrls(transcript: string): string[];
    prepareMusicSearchRequest(transcript: string): Promise<any>;
    fetchLinkedPageText(url: string): Promise<any>;
    getMusicSearchPrompt(request: any): string;
    getMusicSearchPrompts(request: any): string[];
    buildMusicSourceChunks(transcript: string, linkedPages: any[]): any[];
    chunkMusicSource(text: string, label: string, meta: string): any[];
    buildMusicSearchPrompt(transcript: string, sourceContext: string): string;
    parseAIResponse(responseText: string, prompt: string, options?: { allowEmpty?: boolean }): any;
    mergeAIResponseBatches(songLists: any[][], prompts: string[]): any;
    extractAIJson(responseText: string): string;
    normalizeAISongList(parsed: any): any[];
    normalizeAISongItem(item: any): any;

    loadFavoritesToPlaylist(): void;
    shufflePlaylist(): void;
    sortPlaylist(key: PlaylistSortKey): void;
    playlistFilterQuery: string;
    setPlaylistFilter(value: string): void;
    clearPlaylistFilter(): void;
    applyPlaylistFilter(): void;
    applySongNotesVisibility(): void;
    rerenderPlaylistDom(): void;
    removePlaylistItem(itemId: number): void;
    appendPlaylistItem(item: PlaylistItem): void;
    showPlaylistSurfaces(): void;
    clearPlaylistItems(): void;
    updatePlaylistLabel(): void;
    formatSeconds(totalSeconds: number): string;
    formatYouTubeResult(video: any): YouTubeVideoCandidate;
    searchYouTube(query: string): Promise<any>;
    searchSongsWithConcurrency(
        validSongs: any[],
        options?: { onResult?: (result: any) => void; concurrency?: number }
    ): Promise<any[]>;
    replacePlaylistItemsKeepingCurrent(): boolean;
    createPlaylistPlayer(item: PlaylistItem): void;
    ensurePlaylistPlayer(item: PlaylistItem): void;
    recreatePlaylistPlayer(item: PlaylistItem): void;
    ensureYouTubeApi(): Promise<void>;
    applyVideoDataToPlaylistItem(item: PlaylistItem, videoData: any): void;
    refreshPlaylistRowVideo(item: PlaylistItem): void;
    describeYouTubePlayerError(code: number | string): string;
    playerLoadFailureInfo(failure: any): { detail: string; errorCode: number | null };
    shouldRetryWithAlternateVideo(errorCode: number | string): boolean;
    tryNextVideoResult(item: PlaylistItem, failure: any): boolean;
    describePlaylistItem(item: PlaylistItem): string;
    waitForPlayerReady(item: PlaylistItem, timeoutMs?: number): Promise<any>;
    reportPlayerLoadFailure(item: PlaylistItem, failure: any): void;
    playVideo(item: PlaylistItem): Promise<void>;
    updateMediaSessionForItem(item: PlaylistItem): void;
    addPlaylistItemToDOM(item: PlaylistItem): void;
    updateCentralPlayer(item: PlaylistItem): void;
    scrollToCurrentSong(): void;
    updateTransportBarLyric(text: string): void;
    stopPlayback(): void;
    playPlaylist(): void;
    pausePlayback(): void;
    togglePlayPause(): void;
    playNext(): void;
    playPrevious(): void;
    fastForward(): void;
    rewind(): void;
    updateTransportPauseLabel(): void;
    restartCurrentTrack(): void;
    updatePlayPauseButton(): void;
    clearPlaylist(): void;
    persistPlaylist(): void;
    restoreSavedPlaylist(): void;
    escapeHtml(text: string): string;
    decodeHtml(text: string): string;
    currentPlaylistItem(): PlaylistItem | null;
    showTransportBar(): void;
    hideTransportBar(): void;
    setupProgressBar(): void;
    seekToPercentage(percentage: number): void;
    startProgressUpdates(): void;
    stopProgressUpdates(): void;
    resyncProgressClock(): void;
    scheduleNextProgressRender(): void;
    renderPlaybackPosition(): number | null;
    nextLyricDeadline(currentTime: number): number;
    updateProgressBar(currentTime: number, duration: number): void;
    formatTime(seconds: number): string;
    setupYouTubeAPI(): void;
    playerReady(): void;
    loadDemoSongIfRequested(): void;
    parseDurationToSeconds(value: string): number;
    searchAndAddToPlaylist(songList: any[], options?: { replaceExisting?: boolean }): Promise<PlaylistSearchResult>;
    musicHistoryLookups: any[];
    musicHistorySongs: any[];
    musicHistorySearches: any[];
    setMusicHistoryPanelVisible(visible: boolean): void;
    toggleMusicHistoryPanel(): void;
    toggleSongLibraryPanel(): void;
    setupMusicHistoryUI(): void;
    refreshMusicHistoryPanel(): Promise<void>;
    renderLookupHistory(lookups: any[]): void;
    renderKnownSongsHistory(songs: any[]): void;
    renderSearchCacheHistory(searches: any[]): void;
    knownSongsQuery: string;
    shownKnownSongs(): any[];
    loadShownKnownSongs(): Promise<void>;
    selectedLookupIds(): number[];
    selectedSongIds(): string[];
    loadSelectedHistoryLookups(): Promise<void>;
    loadHistoryLookupById(id: number): Promise<void>;
    loadHistoryLookups(ids: number[]): Promise<void>;
    rerunHistoryLookupById(id: number): Promise<void>;
    loadSelectedKnownSongs(): Promise<void>;
    loadKnownSongByVideoId(videoId: string): Promise<void>;
    loadKnownSongs(videoIds: string[]): Promise<void>;
    addKnownSongsToPlaylist(songs: any[]): void;
    loadCachedSearchFirstResult(query: string): Promise<void>;
    refreshCachedSearchQuery(query: string): Promise<void>;

    currentLyricsItem(): PlaylistItem | null;
    toggleLyricsPanel(): void;
    setLyricsPanelVisible(visible: boolean): void;
    openLyricsOverlay(): void;
    closeLyricsOverlay(): void;
    toggleLyricsConfig(): void;
    closeLyricsConfig(): void;
    updateLyricsButtonLabels(): void;
    updateBigLyricsAvailability(): void;
    adjustLyricsFontScale(delta: number): void;
    applyLyricsViewSettings(): void;
    updateLyricsStatus(item: PlaylistItem, message: string, isError?: boolean): void;
    updateLyricsTitles(item: PlaylistItem): void;
    renderLyricsStateForItem(item: PlaylistItem): void;
    getRenderableLyricsLines(lyricsData: LyricsResult): string[];
    renderLyricsLines(lines: string[]): void;
    buildLyricsLookupCandidates(item: PlaylistItem): Array<{ artist: string; title: string }>;
    addLyricsCandidate(candidates: Array<{ artist: string; title: string }>, artist: string, title: string): void;
    extractArtistTitleFromVideoTitle(title: string): { artist: string; title: string };
    cleanSongTitle(text: string): string;
    cleanArtistName(text: string): string;
    normalizeWhitespace(text: string): string;
    normalizeComparisonText(value: string): string;
    tokenSimilarity(a: string, b: string): number;
    scoreLyricsCandidate(record: LyricsResult, artist: string, title: string, expectedDuration: number): number;
    parseSyncedLyrics(syncedLyrics: string): SyncedLyricLine[];
    currentPlaybackTime(): number;
    updateSyncedLyricsPosition(currentTime: number): void;
    syncedLyricLineIndexAt(syncedLines: SyncedLyricLine[], time: number): number;
    lyricTitleLineAt(lines: SyncedLyricLine[], index: number): string;
    describeSongIdentity(item: PlaylistItem): string;
    lyricDisplayTextAt(item: PlaylistItem, lines: SyncedLyricLine[], index: number, currentTime: number): string;
    applyActiveLyricsLine(activeIndex: number, force?: boolean): void;
    relayLyricToNowPlaying(activeIndex: number, currentTime?: number): void;
    nowPlayingShowsLyric: boolean;
    mediaActionHandlersSet: boolean;
    ensureLyricsForItem(item: PlaylistItem, options?: { forceLookup?: boolean }): Promise<LyricsResult | null>;
    resolveLyricState(item: PlaylistItem, forceLookup: boolean): Promise<LyricStateRecord>;
    applyLyricStateToItem(item: PlaylistItem, state: LyricStateRecord): void;
    showLyricsForItem(item: PlaylistItem): Promise<void>;
    lookupLyrics(item: PlaylistItem): Promise<LyricsResult | null>;
    searchLyricsProvider(title: string, artist: string, album: string): Promise<LyricsResult[]>;
    lyricsFetchQueue: PlaylistItem[];
    lyricsFetchActive: number;
    lyricsLookupsInFlight: Map<string, Promise<LyricStateRecord>>;
    queueLyricsLookup(item: PlaylistItem): void;
    pumpLyricsQueue(): void;
    reconcileLibraryLyrics(): void;
    refreshLyricsRowButton(item: PlaylistItem): void;

    songLibrary: SongLibraryStore;
    hydrateSongLibrary(): Promise<void>;
    setupSongLibraryUI(): void;
    importSongLibraryFiles(files: FileList | File[]): Promise<void>;
    renderSongLibrary(): void;
    playLibrarySong(songId: string): Promise<void>;
    stopLibrarySong(): void;
    toggleLibrarySongFavorite(songId: string): void;
}

declare const ScalesVoiceMaps: NonNullable<Window['ScalesVoiceMaps']>;
