/**
 * The usage-statistics client (fuseki-stats.js, a vendored copy of fuseki4_ai's
 * setup/apps/fuseki-stats.js; docs/architecture.md, "Usage statistics"). The
 * typecheck leaves the copy alone, so its browser API is declared here. Off
 * fuseki.net/voice-wei/ both methods do nothing.
 */

interface FusekiStatsApi {
    /**
     * One completed round. Keys match [a-z][a-z0-9_]{0,23}; values are finite
     * numbers, booleans, or tokens of letters, digits and _ . : / -. The client
     * drops anything else (null included) before sending.
     */
    game(fields: Record<string, string | number | boolean | null>): void;
    /** check() is true while the app is in use without input; sampled every 5 seconds. */
    engaged(check: () => boolean): void;
}

interface Window {
    FusekiStats?: FusekiStatsApi;
}
