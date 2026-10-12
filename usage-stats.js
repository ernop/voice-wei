// @ts-check
//-----------------------------------------------------------------------
// USAGE STATISTICS
// Gives fuseki-stats.js (the vendored statistics client) its one
// "in use without input" check. Voice-Wei is used hands-free, often
// driving with the screen off, so time counts while the page makes sound
// or listens. Every source is read from the module that owns it; no app
// code calls this module, so a statistics script that fails to load costs
// statistics, never the app. Decision: docs/product-goals.md, "Usage
// statistics"; construction: docs/architecture.md, "Usage statistics".
//-----------------------------------------------------------------------

const UsageStats = (function () {
    'use strict';

    // The client samples engaged() every 5 seconds. Drills leave silences
    // between notes and patterns, so piano or synth sound within the last
    // sample period still counts: a running drill counts whole.
    const RECENT_SOUND_MS = 5000;

    // Books plays through an <audio> element. The media-session keep-alive
    // loops silence on any page that claims the session; it is not use.
    function mediaElementPlaying() {
        for (const media of document.querySelectorAll('audio, video')) {
            if (media instanceof HTMLMediaElement && !media.paused
                && !media.hasAttribute('data-media-session-keep-alive')) return true;
        }
        return false;
    }

    // Each page loads only some of these owners. Called every 5 seconds,
    // cheapest reads first.
    function engaged() {
        return (typeof PianoCore !== 'undefined'
                && performance.now() - PianoCore.soundEndsAtMs() < RECENT_SOUND_MS)
            || (typeof PitchDetectCore !== 'undefined' && PitchDetectCore.isListening())
            || (typeof VoiceCommandCore !== 'undefined' && VoiceCommandCore.isAnyListening())
            || (typeof VoiceOutput !== 'undefined' && VoiceOutput.isSpeaking())
            || (typeof MediaSessionCore !== 'undefined'
                && MediaSessionCore.getReportedPlaybackState() === 'playing')
            || mediaElementPlaying();
    }

    try {
        if (window.FusekiStats) window.FusekiStats.engaged(engaged);
    } catch (error) {
        // Statistics must never break or slow the app (owner, 2026-10-11).
    }

    return { engaged };
})();

window.UsageStats = UsageStats;
