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
}

interface LyricsViewSettings {
    fontScale: number;
    widthMode: 'wide' | 'focus';
    align: 'center' | 'left';
    spacing: 'tight' | 'roomy';
    backdrop: 'blackout' | 'dim';
}

interface PlaylistItem {
    id: number;
    videoId: string;
    name: string;
    artist: string;
    year: string;
    album: string;
    title: string;
    channelTitle: string;
    duration: string;
    durationSeconds?: number;
    comment: string;
    searchTerm: string;
    lyricsStatus?: 'idle' | 'loading' | 'ready' | 'not_found' | 'error';
    lyricsData?: LyricsResult | null;
}

interface FavoriteData {
    videoId: string;
    name: string;
    artist: string;
    year: string;
    album: string;
    title: string;
    channelTitle: string;
    duration: string;
    durationSeconds?: number;
    comment: string;
    searchTerm: string;
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

interface LyricsCacheStore {
    [cacheKey: string]: LyricsResult;
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
}

interface AppConfig {
    claudeApiKey?: string;
    openaiApiKey?: string;
}

interface VoiceMusicController {
    parseControlCommand(transcript: string): string | null;
    executeControlCommand(command: string): void;
    showHelp(): void;
    announceCurrentSong(): void;
    processCommandWithLLM(transcript: string): Promise<any>;
    getMusicSearchPrompt(transcript: string): string;
    parseAIResponse(responseText: string, prompt: string): any;

    loadFavoritesToPlaylist(): void;
    shufflePlaylist(): void;
    updatePlaylistLabel(): void;
    formatSeconds(totalSeconds: number): string;
    addPlaylistItemToDOM(item: PlaylistItem): void;
    updateCentralPlayer(item: PlaylistItem): void;
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
    updateCurrentProgress(): void;
    updateProgressBar(currentTime: number, duration: number): void;
    formatTime(seconds: number): string;
    setupYouTubeAPI(): void;
    playerReady(): void;
    loadDemoSongIfRequested(): void;
    parseDurationToSeconds(value: string): number;
    searchAndAddToPlaylist(songList: any[]): Promise<PlaylistSearchResult>;

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
    applyActiveLyricsLine(activeIndex: number, force?: boolean): void;
    hydrateItemLyricsFromCache(item: PlaylistItem): void;
    cachedLyricsMatchesItem(cached: LyricsResult, item: PlaylistItem): boolean;
    persistLyricsForItem(item: PlaylistItem, lyricsData: LyricsResult): void;
    getLyricsCacheKeysForItem(item: PlaylistItem): string[];
    buildLyricsCacheKey(artist: string, title: string, durationSeconds: number): string;
    refreshLyricsRowButton(item: PlaylistItem): void;

    songLibrary: SongLibraryStore;
    setupSongLibraryUI(): void;
    importSongLibraryFiles(files: FileList | File[]): Promise<void>;
    renderSongLibrary(): void;
    playLibrarySong(songId: string): Promise<void>;
    stopLibrarySong(): void;
    toggleLibrarySongFavorite(songId: string): void;
}

declare const PlayerCommands: {
    install(controller: VoiceMusicController): void;
};

declare const PlayerPlaylist: {
    install(controller: VoiceMusicController): void;
};

declare const PlayerLyrics: {
    install(controller: VoiceMusicController): void;
};

declare const PlayerSongLibrary: {
    install(controller: VoiceMusicController): void;
};

declare const ScalesVoiceMaps: NonNullable<Window['ScalesVoiceMaps']>;
