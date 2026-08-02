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
    llmMigration: string;
    lyricsOnNowPlaying: boolean;
    showSongNotes: boolean;
    playlistTimedOnly: boolean;
    songDisplayMode: 'identity' | 'report';
    songReportIntervalSeconds: number;
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
    /** YouTube auto-generated album track ("Provided to YouTube by" / " - Topic"): the studio recording by construction. */
    isAlbumTrack?: boolean;
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

type PlaylistSourceKind = 'search' | 'favorite' | 'restored' | 'history' | 'share' | 'demo' | 'backfill';

type PlaylistSortKey = 'artist' | 'year';

/** A Song's membership in the working playlist + runtime lyric state. */
interface PlaylistItem extends Song {
    id: number;
    sourceKind: PlaylistSourceKind;
    sourceLabel: string;
    sourceSearchTerm: string;
    lyricsStatus: 'idle' | 'loading' | 'ready' | 'not_found' | 'error';
    lyricsData: LyricsResult | null;
    /** Runtime copy of LyricStateRecord.lyricOffsetSeconds (0 when absent). */
    lyricOffsetSeconds: number;
}

interface LyricsFetchQueueEntry {
    /** Captured identity: remains stable if the representative item is rekeyed. */
    videoId: string;
    item: PlaylistItem;
}

/** What the playlist persists per entry: the Song + membership, no lyric runtime. */
interface PersistedPlaylistEntry extends Song {
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
    /** LYRICS_SEARCH_VERSION that produced this record. Every older record,
     *  including timed lyrics, gets one identity revalidation. */
    searchVersion?: number;
    lyrics?: LyricsResult;
    /**
     * Per-song lyric timing nudge in seconds (positive = show later
     * lines / correct lyrics that are too slow; negative = show earlier
     * lines / correct lyrics that are too fast). Absent or 0 means the
     * timed file is used as-is.
     */
    lyricOffsetSeconds?: number;
}

/** One report note: anchored to a lyric line's sung time, or general (null). */
interface SongReportEntry {
    time: number | null;
    text: string;
}

interface SongReportRecord {
    videoId: string;
    generatedAt: number;
    provider: 'claude' | 'openai';
    model: string;
    prompt: string;
    reportText: string;
    entries: SongReportEntry[];
    /** Pre-timed-notes records carried display lines; migrated to entries on load. */
    lines?: string[];
}

interface SongReportRequestState {
    phase: 'idle' | 'sending' | 'waiting' | 'received' | 'playing' | 'failed';
    videoId: string | null;
    startedAt: number;
    elapsedMs: number;
    provider: 'claude' | 'openai' | null;
    model: string;
    returnedCharacters: number;
    returnedLines: number;
    error: string;
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
    listStoredLogs(): Promise<any[]>;
    listLookups(): Promise<any[]>;
    listSongs(): Promise<any[]>;
    listYouTubeSearches(): Promise<any[]>;
    recordFavorite(favorite: any, active: boolean): void;
    putLyricState(record: LyricStateRecord): Promise<void>;
    getLyricState(videoId: string): Promise<LyricStateRecord | null>;
    putSongReport(record: SongReportRecord): Promise<void>;
    getSongReport(videoId: string): Promise<SongReportRecord | null>;
}

interface AppConfig {
    claudeApiKey?: string;
    openaiApiKey?: string;
}

interface PrebufferProbeSlot {
    item: PlaylistItem;
    slotIndex: number;
    stage: string;
    readyMs: number;
    coldStartMs: number;
    warmStartMs: number;
    bufferedAfterPrewarmSeconds: number;
    bufferedAfterWarmSeconds: number;
    warmRequestedAt: number;
    finished: boolean;
    errorCode: number;
}

interface PlayerStartupPhase {
    name: string;
    startMs: number;
    durationMs: number;
    detail: Record<string, string | number | boolean>;
}

interface PlayerStartupReport {
    budgetMs: number;
    readyAtMs: number;
    withinBudget: boolean;
    navigation: {
        serverResponseMs: number;
        documentDownloadMs: number;
        parseAndBlockingResourcesMs: number;
        domContentLoadedHandlersMs: number;
        appAfterDomContentLoadedMs: number;
        totalReadyMs: number;
    };
    phases: PlayerStartupPhase[];
    resources: Array<{
        name: string;
        initiator: string;
        startMs: number;
        durationMs: number;
        transferBytes: number;
        decodedBytes: number;
    }>;
    longTasks: Array<{ startMs: number; durationMs: number }>;
}

interface PlayerPlaybackDiagnosticSnapshot {
    appStatus: 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'unavailable';
    videoId: string;
    positionSeconds: number | null;
    youtubeState: number | null;
    mediaSessionState: MediaSessionPlaybackState | 'unavailable';
    keepAlive: 'absent' | 'playing' | 'paused' | 'disabled';
}

interface PlayerLifecycleMemorySnapshot {
    deviceMemoryGb: number | null;
    usedJsHeapMb: number | null;
    heapLimitMb: number | null;
}

interface PlayerLifecycleBreadcrumb {
    sessionId: string;
    sequence: number;
    event: string;
    recordedAt: string;
    visibility: DocumentVisibilityState;
    hidden: boolean;
    network: string;
    navigationType: string;
    discarded: 'yes' | 'no' | 'unsupported';
    orderlyExit: boolean;
    memory: PlayerLifecycleMemorySnapshot;
    playback: PlayerPlaybackDiagnosticSnapshot;
    detail: Record<string, string | number | boolean | null>;
}

interface PlayerLifecycleApi {
    start(controller: VoiceMusicController, reporter: (text: string) => void): void;
    recordIntent(intent: string): void;
    recordHeartbeat(): void;
    recordYouTubeReady(): void;
    recordYouTubeState(state: number): void;
    recordYouTubeError(code: number | string): void;
    getPreviousBreadcrumb(): PlayerLifecycleBreadcrumb | null;
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
    activeSeekStrip: HTMLElement | null;
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
    parseAIResponse(responseText: string, prompt: string, options?: { allowEmpty?: boolean; truncated?: boolean }): any;
    salvageJsonArrayItems(text: string): any[] | null;
    mergeAIResponseBatches(songLists: any[][], prompts: string[]): any;
    extractAIJson(responseText: string): string;
    normalizeAISongList(parsed: any): any[];
    normalizeAISongItem(item: any): any;
    missingApiKeyError(provider: 'claude' | 'openai'): Error & { provider?: string; missingKey?: boolean };
    classifyProviderError(provider: 'claude' | 'openai', status: number, errorBody: any): Error & { provider?: string; status?: number };
    requestSongReportResearch(prompt: string): Promise<{ text: string; provider: 'claude' | 'openai'; model: string }>;

    loadFavoritesToPlaylist(): void;
    shufflePlaylist(): void;
    sortPlaylist(key: PlaylistSortKey): void;
    playlistFilterQuery: string;
    setPlaylistFilter(value: string): void;
    clearPlaylistFilter(): void;
    applyPlaylistFilter(): void;
    itemHasTimedLyrics(item: PlaylistItem | null | undefined): boolean;
    applySongNotesVisibility(): void;
    rerenderPlaylistDom(): void;
    removePlaylistItem(itemId: number): void;
    appendPlaylistItem(item: PlaylistItem): void;
    appendPlaylistItems(items: PlaylistItem[]): void;
    showPlaylistSurfaces(): void;
    clearPlaylistItems(): void;
    updatePlaylistLabel(): void;
    formatSeconds(totalSeconds: number): string;
    formatYouTubeResult(video: any): YouTubeVideoCandidate;
    searchYouTubeCandidates(query: string, context?: { artist?: string; name?: string }): Promise<YouTubeVideoCandidate[]>;
    searchYouTube(query: string, context?: { artist?: string; name?: string }): Promise<any>;
    unwantedVersionMarkers(): RegExp[];
    simplifyVideoText(value: string): string;
    videoMatchesRequestedSong(video: YouTubeVideoCandidate, context: { name?: string }): boolean;
    songMatchesIntendedIdentity(song: Song, intendedSong: Song): boolean;
    itemAwaitsFavoriteVideoIdentityRepair(item: PlaylistItem): boolean;
    neutralTitleWords(): Set<string>;
    countExtraneousTitleWords(simplifiedTitle: string, songName: string, artist: string, requested: string): number;
    scoreVideoCandidate(video: YouTubeVideoCandidate, context: { searchTerm?: string; artist?: string; name?: string }): number;
    rankYouTubeResults(videos: YouTubeVideoCandidate[], context: { searchTerm?: string; artist?: string; name?: string }): YouTubeVideoCandidate[];
    searchSongsWithConcurrency(
        validSongs: any[],
        options?: { onResult?: (result: any) => void; concurrency?: number }
    ): Promise<any[]>;
    replacePlaylistItemsKeepingCurrent(): boolean;
    createPlaylistPlayer(item: PlaylistItem): void;
    ensurePlaylistPlayer(item: PlaylistItem): void;
    recreatePlaylistPlayer(item: PlaylistItem): void;
    ensureYouTubeApi(): Promise<void>;
    prebufferProbeEnabled: boolean;
    prebufferProbeRunId: number;
    prebufferProbePlayers: YT.Player[];
    prebufferProbeTimers: ReturnType<typeof setTimeout>[];
    prebufferProbeSlots: PrebufferProbeSlot[];
    prebufferProbeCandidates(currentItem: PlaylistItem): PlaylistItem[];
    cleanupPrebufferProbe(): void;
    schedulePrebufferProbe(runId: number, callback: () => void, delayMs: number): void;
    startPrebufferProbeFor(currentItem: PlaylistItem): Promise<void>;
    handlePrebufferProbeState(runId: number, slot: PrebufferProbeSlot, player: YT.Player, state: number, runStartedAt: number): void;
    finishPrebufferProbeSlot(runId: number, slot: PrebufferProbeSlot, player: YT.Player): void;
    transitionVideoIdentity(
        oldVideoId: string,
        videoData: YouTubeVideoCandidate,
        transition:
            | { relation: 'equivalent-recording' }
            | { relation: 'favorite-repair'; intendedSong: Song }
    ): PlaylistItem[];
    refreshPlaylistRowFavorite(item: PlaylistItem): void;
    refreshPlaylistRowVideo(item: PlaylistItem): void;
    describeYouTubePlayerError(code: number | string): string;
    playerLoadFailureInfo(failure: any): { detail: string; errorCode: number | null };
    shouldRetryWithAlternateVideo(errorCode: number | string): boolean;
    tryNextVideoResult(item: PlaylistItem, failure: any): boolean;
    describePlaylistItem(item: PlaylistItem): string;
    waitForPlayerReady(item: PlaylistItem, timeoutMs?: number): Promise<any>;
    reportPlayerLoadFailure(item: PlaylistItem, failure: any): Promise<void>;
    refreshAlternatesFromSearch(item: PlaylistItem): Promise<boolean>;
    favoriteNeedsVideoIdentityRepair(favorite: FavoriteData): boolean;
    healSavedFavoriteVideoIdentities(): number;
    alternateVideoSearchAttempts: Set<number>;
    playVideo(item: PlaylistItem): Promise<void>;
    updateMediaSessionForItem(item: PlaylistItem): void;
    playlistItemRowHtml(item: PlaylistItem): string;
    bindPlaylistRowEvents(playlistBody: HTMLElement): void;
    addPlaylistItemsToDOM(items: PlaylistItem[]): void;
    addPlaylistItemToDOM(item: PlaylistItem): void;
    updateCentralPlayer(item: PlaylistItem): void;
    scrollToCurrentSong(): void;
    updateTransportBarLyric(text: string): void;
    updateTransportBarSecondary(text: string): void;
    setTransportBarRowText(id: string, text: string): void;
    resetTransportBarText(): void;
    armLyricScrollGuard(container: HTMLElement): void;
    stopPlayback(): void;
    playPlaylist(): void;
    pausePlayback(): void;
    togglePlayPause(): void;
    playNext(): void;
    playPrevious(): void;
    fastForward(): void;
    rewind(): void;
    seekBy(seconds: number): void;
    seekToFirstLyric(): void;
    updateFirstLyricButton(): void;
    lyricsRowMarker(item: PlaylistItem): { label: string; className: string; aria: string };
    updateTransportPauseLabel(): void;
    restartCurrentTrack(): void;
    updatePlayPauseButton(): void;
    clearPlaylist(): void;
    persistPlaylist(): void;
    restoreSavedPlaylist(): void;
    escapeHtml(text: string): string;
    decodeHtml(text: string): string;
    currentPlaylistItem(): PlaylistItem | null;
    shareLinkForItem(item: PlaylistItem): string;
    copyCurrentSongShareLink(): Promise<void>;
    showTransportBar(): void;
    hideTransportBar(): void;
    setupProgressBar(): void;
    seekToPercentage(percentage: number): void;
    seekToTime(seconds: number): void;
    startProgressUpdates(): void;
    stopProgressUpdates(): void;
    resyncProgressClock(): void;
    scheduleNextProgressRender(): void;
    renderPlaybackPosition(): number | null;
    nextListeningTextDeadline(currentTime: number): number;
    updateProgressBar(currentTime: number, duration: number): void;
    formatTime(seconds: number): string;
    setupYouTubeAPI(): void;
    playerReady(): void;
    loadLinkedSongIfRequested(): void;
    parseDurationToSeconds(value: string): number;
    searchAndAddToPlaylist(songList: any[], options?: { replaceExisting?: boolean }): Promise<PlaylistSearchResult>;
    searchDirectAndAddToPlaylist(query: string): Promise<{ addedCount: number; resultCount: number }>;
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
    playingPlaylistItem(): PlaylistItem | null;
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
    lyricsRecordMatchesIdentity(record: LyricsResult, artist: string, title: string): boolean;
    isExactStrongTimedLyricsMatch(record: LyricsResult, artist: string, title: string, expectedDuration: number): boolean;
    lyricsMatchItemIdentity(lyrics: LyricsResult, item: PlaylistItem): boolean;
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
    updateListeningTextPosition(currentTime: number): void;
    lyricOffsetForItem(item: PlaylistItem | null | undefined): number;
    formatLyricOffset(offsetSeconds: number): string;
    updateLyricOffsetControls(): void;
    nudgeLyricOffset(deltaSeconds: number): Promise<void>;
    lyricsTooFast(): Promise<void>;
    lyricsTooSlow(): Promise<void>;
    syncedLyricLineIndexAt(syncedLines: SyncedLyricLine[], time: number): number;
    lyricTitleLineIndexAt(lines: SyncedLyricLine[], index: number): number;
    describeSongIdentity(item: PlaylistItem): string;
    describeNowPlayingArtist(item: PlaylistItem): string;
    lyricDisplayTextAt(item: PlaylistItem, lines: SyncedLyricLine[], index: number, currentTime: number): string;
    applyActiveLyricsLine(activeIndex: number, force?: boolean): void;
    relayListeningTextToNowPlaying(primaryText: string, secondaryText: string): void;
    nowPlayingShowsText: boolean;
    mediaActionHandlersSet: boolean;
    ensureLyricsForItem(item: PlaylistItem, options?: { forceLookup?: boolean }): Promise<LyricsResult | null>;
    resolveLyricState(item: PlaylistItem, forceLookup: boolean): Promise<LyricStateRecord>;
    applyLyricStateToItem(item: PlaylistItem, state: LyricStateRecord): void;
    showLyricsForItem(item: PlaylistItem): Promise<void>;
    lookupLyrics(item: PlaylistItem): Promise<LyricsResult | null>;
    searchLyricsProvider(title: string, artist: string): Promise<LyricsResult[]>;
    lyricsFetchQueue: LyricsFetchQueueEntry[];
    lyricsQueuedVideoIds: Set<string>;
    lyricsFetchActive: number;
    lyricsLookupsInFlight: Map<string, Promise<LyricStateRecord>>;
    queueLyricsLookup(item: PlaylistItem): void;
    pumpLyricsQueue(): void;
    dropPlaylistLyricsQueueEntries(): void;
    reconcileLibraryLyrics(): void;
    lyricItemsForVideo(videoId: string, detachedItem: PlaylistItem): PlaylistItem[];
    refreshActivatedLyricsItem(item: PlaylistItem): void;
    refreshLyricsRowButton(item: PlaylistItem): void;

    songReports: Map<string, SongReportRecord>;
    songReportLoadsInFlight: Map<string, Promise<SongReportRecord | null>>;
    songReportRequestInFlight: boolean;
    songReportRequestState: SongReportRequestState;
    songReportRequestTimer: number | null;
    songReportAnchorVideoId: string | null;
    songReportAnchorTime: number;
    songReportForItem(item: PlaylistItem | null | undefined): SongReportRecord | null;
    songReportLyricsText(item: PlaylistItem): string;
    buildSongReportPrompt(item: PlaylistItem): string;
    sanitizeSongReportNote(noteText: string | null | undefined): string;
    parseSongReportResponse(responseText: string, item: PlaylistItem): SongReportEntry[];
    songReportSchedule(item: PlaylistItem): Array<{ at: number; text: string }>;
    songReportDisplayAt(item: PlaylistItem | null | undefined, currentTime: number): { text: string; blank: boolean };
    segmentSongReport(reportText: string, maxChars?: number): string[];
    songReportAsText(record: SongReportRecord): string;
    toggleSongReportText(): void;
    loadSongReportForItem(item: PlaylistItem): Promise<SongReportRecord | null>;
    requestSongReport(): Promise<void>;
    activateSongReport(): Promise<void>;
    formatSongReportElapsed(elapsedMs: number): string;
    setSongDisplayMode(mode: 'identity' | 'report'): void;
    stepSongReportInterval(direction: -1 | 1): void;
    resetSongReportForPlay(item: PlaylistItem): void;
    clearSongReportPlayback(): void;
    songReportLineIndexAt(item: PlaylistItem, currentTime: number): number;
    nextSongReportDeadline(currentTime: number): number;
    updateSongReportControls(): void;

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
