/**
 * The shared media player (media-player.js / media-player.css, a pinned copy of the owner's
 * library; docs/architecture.md, "Shared libraries"). The typecheck leaves the pinned copy
 * alone, so the part of its API this repo uses is declared here.
 */

interface MediaPlayerSeekDetail {
    from: number;
    to: number;
    /** What the player did: skip, percent, half-back, half-forward, jump-back, start, end, scale, media-session, ... */
    cause: string;
}

interface MediaPlayerItems {
    /** What one item is called, for messages such as "No next part". */
    label: string;
    previous: (() => void) | null;
    next: (() => void) | null;
}

interface MediaPlayerOptions {
    title?: string;
    resume?: boolean;
    halfJumps?: boolean;
    skips?: number[];
}

interface MediaPlayerInstance {
    /** Shown by the system's media controls (lock screen, car). */
    title: string;
    setItems(items: MediaPlayerItems | null): void;
    focus(): void;
}

declare const MediaPlayer: {
    enhance(media: HTMLMediaElement, options?: MediaPlayerOptions): MediaPlayerInstance;
    get(media: HTMLMediaElement): MediaPlayerInstance | null;
};

interface HTMLElementEventMap {
    'media-player:seek': CustomEvent<MediaPlayerSeekDetail>;
}
