<?php
// Same-origin keyless YouTube search, YouTube channel and playlist listing,
// fixed-provider lyrics search, and the webpage/PDF importer shared by Books
// and linked-page music requests. Every network hop is resolved and pinned
// before cURL connects so redirects and DNS rebinding cannot reach private
// hosts.
header('Content-Type: application/json');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Allow: GET');
    echo json_encode(['error' => 'Only GET requests are accepted']);
    exit;
}

function publicUrlTarget($url) {
    $parts = parse_url($url);
    if (!$parts || !isset($parts['scheme']) || !isset($parts['host'])) {
        return null;
    }

    $scheme = strtolower($parts['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') {
        return null;
    }

    if (isset($parts['user']) || isset($parts['pass'])) {
        return null;
    }
    $host = strtolower($parts['host']);
    if ($host === 'localhost' || substr($host, -6) === '.local') {
        return null;
    }

    $port = isset($parts['port']) ? (int) $parts['port'] : ($scheme === 'https' ? 443 : 80);
    if (($scheme === 'https' && $port !== 443) || ($scheme === 'http' && $port !== 80)) {
        return null;
    }
    $ips = gethostbynamel($host);
    if (!$ips || count($ips) === 0) {
        return null;
    }

    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return null;
        }
    }

    return ['host' => $host, 'port' => $port, 'ip' => $ips[0]];
}

function isPublicHttpUrl($url) {
    return publicUrlTarget($url) !== null;
}

function resolveReadablePageUrl($url) {
    $parts = parse_url($url);
    if (!$parts || !isset($parts['host']) || !isset($parts['path'])) {
        return $url;
    }

    $host = strtolower($parts['host']);
    $path = $parts['path'];
    $query = isset($parts['query']) ? '?' . $parts['query'] : '';
    if (($host === 'tvtropes.org' || $host === 'www.tvtropes.org')
        && preg_match('/\/RegionalRiffs?$/i', $path)) {
        return 'https://allthetropes.org/wiki/Regional_Riff';
    }

    // LessWrong / EA Forum / Alignment Forum render content client-side, but
    // GreaterWrong serves the same posts as clean server-rendered HTML.
    if ($host === 'lesswrong.com' || $host === 'www.lesswrong.com') {
        return 'https://www.greaterwrong.com' . $path . $query;
    }
    if ($host === 'forum.effectivealtruism.org' || $host === 'www.forum.effectivealtruism.org') {
        return 'https://ea.greaterwrong.com' . $path . $query;
    }
    if ($host === 'alignmentforum.org' || $host === 'www.alignmentforum.org') {
        return 'https://www.greaterwrong.com' . $path . $query;
    }

    return $url;
}

// $options['postJson']: send this JSON body as a POST. A redirect is then an
// error, so the body is never re-sent to wherever a redirect points.
// $options['userAgent']: the User-Agent header, or null to send none.
function requestPublicUrl($url, $accept, $maxBytes, $timeoutSeconds, $options = []) {
    $postJson = $options['postJson'] ?? null;
    $userAgent = array_key_exists('userAgent', $options) ? $options['userAgent'] : 'Voice-Wei URL Import/1.0';
    $headers = ['Accept: ' . $accept, 'Accept-Language: en-US,en;q=0.9'];
    if ($postJson !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    $currentUrl = $url;
    for ($redirects = 0; $redirects <= 3; $redirects++) {
        $target = publicUrlTarget($currentUrl);
        if ($target === null) {
            return ['response' => false, 'httpCode' => 0, 'contentType' => '', 'error' => 'URL resolved to a non-public host'];
        }

        $response = '';
        $location = '';
        $tooLarge = false;
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $currentUrl,
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => $timeoutSeconds,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RESOLVE => [
                "{$target['host']}:{$target['port']}:{$target['ip']}"
            ],
            CURLOPT_HEADERFUNCTION => function ($curl, $header) use (&$location, &$tooLarge, $maxBytes) {
                $length = strlen($header);
                if (stripos($header, 'Location:') === 0) {
                    $location = trim(substr($header, 9));
                }
                if (stripos($header, 'Content-Length:') === 0
                    && (int) trim(substr($header, 15)) > $maxBytes) {
                    $tooLarge = true;
                }
                return $length;
            },
            CURLOPT_WRITEFUNCTION => function ($curl, $chunk) use (&$response, &$tooLarge, $maxBytes) {
                if ($tooLarge || strlen($response) + strlen($chunk) > $maxBytes) {
                    $tooLarge = true;
                    return 0;
                }
                $response .= $chunk;
                return strlen($chunk);
            }
        ]);
        if ($userAgent !== null) {
            curl_setopt($ch, CURLOPT_USERAGENT, $userAgent);
        }
        if ($postJson !== null) {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $postJson);
        }

        $ok = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: '';
        $error = curl_error($ch);
        curl_close($ch);

        if ($tooLarge) {
            return ['response' => false, 'httpCode' => 413, 'contentType' => $contentType, 'error' => 'Remote content exceeds the import size limit'];
        }
        if ($ok === false) {
            return ['response' => false, 'httpCode' => $httpCode, 'contentType' => $contentType, 'error' => $error];
        }
        if ($httpCode >= 300 && $httpCode < 400) {
            if ($postJson !== null) {
                return ['response' => false, 'httpCode' => $httpCode, 'contentType' => $contentType, 'error' => 'Remote answered a POST with a redirect'];
            }
            if ($location === '') {
                return ['response' => false, 'httpCode' => $httpCode, 'contentType' => $contentType, 'error' => 'Remote redirect had no Location header'];
            }
            $currentUrl = absolutizeUrl($location, $currentUrl);
            continue;
        }

        return [
            'response' => $response,
            'httpCode' => $httpCode,
            'contentType' => $contentType,
            'error' => '',
            'finalUrl' => $currentUrl
        ];
    }

    return ['response' => false, 'httpCode' => 0, 'contentType' => '', 'error' => 'Remote URL exceeded the redirect limit'];
}

function makePageRequest($url) {
    return requestPublicUrl(
        $url,
        'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9',
        8000000,
        20
    );
}

function makeSearchRequest($url) {
    return requestPublicUrl($url, 'application/json', 2000000, 15);
}

// preg_* report engine failures (backtrack limit, malformed input) as
// false/null. Read as "no match", that silently imported whole page chrome
// or empty text, so page extraction goes through these and fails loudly.
class PageTextExtractionError extends RuntimeException {}

function pregMatchStrict($pattern, $subject, &$matches = null, $flags = 0, $offset = 0) {
    $result = preg_match($pattern, $subject, $matches, $flags, $offset);
    if ($result === false) {
        throw new PageTextExtractionError(preg_last_error_msg() . " in $pattern");
    }
    return $result === 1;
}

function pregReplaceStrict($pattern, $replacement, $subject) {
    $result = preg_replace($pattern, $replacement, $subject);
    if ($result === null) {
        throw new PageTextExtractionError(preg_last_error_msg() . " in $pattern");
    }
    return $result;
}

function extractPageTitle($html) {
    if (pregMatchStrict('/<title[^>]*>(.*?)<\/title>/is', $html, $matches)) {
        return trim(html_entity_decode(strip_tags($matches[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }
    return '';
}

// Drop a trailing comment thread (everything from the first comment-section
// marker onward) so reader/listen text and link lists are not polluted by
// reader discussion. No-op when no marker is found.
function stripTrailingComments($source) {
    $pattern = '/<(?:div|section|ol|ul|aside)\b[^>]*(?:id|class)=["\'][^"\']*'
        . '(?:comments?-area|comment-list|commentlist|comment-respond|comment-thread|disqus_thread)/i';
    if (pregMatchStrict($pattern, $source, $matches, PREG_OFFSET_CAPTURE)) {
        return substr($source, 0, $matches[0][1]);
    }
    if (pregMatchStrict('/<[^>]+id=["\']comments["\'][^>]*>/i', $source, $matches, PREG_OFFSET_CAPTURE)) {
        return substr($source, 0, $matches[0][1]);
    }
    return $source;
}

// Readable-content containers, most specific first: the opening tag and the
// markers that end its content. The content is sliced by the offsets these
// bounded patterns find. A lazy capture spanning the whole article exhausted
// PCRE's backtrack limit on megabyte pages (every large Wikipedia article).
const READABLE_CONTAINERS = [
    [
        'start' => '/<div[^>]+id=["\']mw-content-text["\'][^>]*>/i',
        'end' => '/<div[^>]+class=["\']printfooter|<div[^>]+id=["\']catlinks|<\/main>|<\/body>/i'
    ],
    [
        'start' => '/<article\b[^>]*>/i',
        'end' => '/<\/article>/i'
    ],
    [
        'start' => '/<div[^>]+class=["\'][^"\']*(?:entry-content|post-content|postcontent|article-content|post-body|markdown-body)[^"\']*["\'][^>]*>/i',
        'end' => '/<footer\b|<div[^>]+(?:id|class)=["\'][^"\']*comment|<\/main>|<\/body>/i'
    ],
    [
        'start' => '/<main\b[^>]*>/i',
        'end' => '/<\/main>|<\/body>/i'
    ]
];

function narrowToReadable($body) {
    foreach (READABLE_CONTAINERS as $container) {
        if (!pregMatchStrict($container['start'], $body, $start, PREG_OFFSET_CAPTURE)) {
            continue;
        }
        $contentStart = $start[0][1] + strlen($start[0][0]);
        if (!pregMatchStrict($container['end'], $body, $end, PREG_OFFSET_CAPTURE, $contentStart)) {
            continue;
        }
        return substr($body, $contentStart, $end[0][1] - $contentStart);
    }
    return $body;
}

// Markup rarely has whitespace between adjacent cells or list items, so
// stripping tags alone fused tracklist rows ('Buckingham2:432."Dreams"').
// Boundaries become marks first: cells a tab, rows/items/<br> a line break,
// blocks a paragraph break (the marks are control bytes absent from text).
const READABLE_CELL_TAGS = '/<\/?(?:td|th)\b[^>]*>/i';
const READABLE_LINE_TAGS = '/<br\b[^>]*>|<\/?(?:li|tr|dt|dd|caption|figcaption|summary|legend|option)\b[^>]*>/i';
const READABLE_BLOCK_TAGS = '/<\/?(?:p|div|h[1-6]|ul|ol|dl|table|thead|tbody|tfoot|blockquote|pre|section|article|header|footer|aside|nav|figure|main|hr|address|details|form|fieldset)\b[^>]*>/i';
const LINE_BREAK_MARK = "\x01";
const BLOCK_BREAK_MARK = "\x02";

function extractReadableText($body) {
    $source = stripTrailingComments(narrowToReadable($body));
    $text = pregReplaceStrict('/<(script|style|svg|noscript|template)\b[^>]*>.*?<\/\1>/is', ' ', $source);
    $text = pregReplaceStrict('/<!--.*?-->/s', ' ', $text);
    // Newlines inside HTML source render as spaces; only tags break lines.
    $text = pregReplaceStrict('/[ \t\r\n\f]+/', ' ', $text);
    $text = pregReplaceStrict(READABLE_CELL_TAGS, "\t", $text);
    $text = pregReplaceStrict(READABLE_LINE_TAGS, LINE_BREAK_MARK, $text);
    $text = pregReplaceStrict(READABLE_BLOCK_TAGS, BLOCK_BREAK_MARK, $text);
    $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return normalizeReadableWhitespace($text);
}

// Plain-text pages keep their own lines; blank lines separate paragraphs.
function extractPlainText($body) {
    $text = pregReplaceStrict('/\r\n?/', "\n", $body);
    $text = pregReplaceStrict('/\n[ \t]*\n[ \t\n]*/', BLOCK_BREAK_MARK, $text);
    return normalizeReadableWhitespace(str_replace("\n", LINE_BREAK_MARK, $text));
}

// One line per row, item, or line break; a tab between cells; one blank line
// between blocks. Adjacent boundaries merge to the strongest one rather than
// stacking (a closing </li> plus the next <li> is still one line break).
function normalizeReadableWhitespace($text) {
    $text = str_replace("\xC2\xA0", ' ', $text);
    $text = pregReplaceStrict('/[ \t]*\t[ \t]*/', "\t", $text);
    $text = pregReplaceStrict('/ {2,}/', ' ', $text);
    $text = pregReplaceStrict('/[ \t\x01\x02]*\x02[ \t\x01\x02]*/', "\n\n", $text);
    $text = pregReplaceStrict('/[ \t\x01]*\x01[ \t\x01]*/', "\n", $text);
    return trim($text);
}

// Longest prefix of at most $maxBytes that does not split a UTF-8 character
// (a split character makes json_encode fail and the answer come back empty).
function utf8Prefix($text, $maxBytes) {
    if (strlen($text) <= $maxBytes) {
        return $text;
    }
    $cut = $maxBytes;
    while ($cut > 0 && (ord($text[$cut]) & 0xC0) === 0x80) {
        $cut--;
    }
    return substr($text, 0, $cut);
}

// Resolve a possibly-relative href against the page URL it was found on.
function absolutizeUrl($href, $baseUrl) {
    $href = trim($href);
    if ($href === '') {
        return '';
    }
    if (preg_match('/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//', $href)) {
        return $href;
    }
    if (substr($href, 0, 2) === '//') {
        $base = parse_url($baseUrl);
        $scheme = isset($base['scheme']) ? $base['scheme'] : 'https';
        return $scheme . ':' . $href;
    }

    $base = parse_url($baseUrl);
    if (!$base || !isset($base['scheme']) || !isset($base['host'])) {
        return '';
    }
    $origin = $base['scheme'] . '://' . $base['host'] . (isset($base['port']) ? ':' . $base['port'] : '');

    if ($href[0] === '/') {
        return $origin . $href;
    }

    $basePath = isset($base['path']) ? $base['path'] : '/';
    $dir = substr($basePath, -1) === '/' ? $basePath : substr($basePath, 0, strrpos($basePath, '/') + 1);
    if ($dir === '') {
        $dir = '/';
    }

    $combined = $dir . $href;
    $segments = [];
    foreach (explode('/', $combined) as $segment) {
        if ($segment === '' || $segment === '.') {
            continue;
        }
        if ($segment === '..') {
            array_pop($segments);
            continue;
        }
        $segments[] = $segment;
    }
    return $origin . '/' . implode('/', $segments);
}

// Pull outbound links (with their visible text) from a page's main content,
// skipping site chrome so the list reads like a table of readings.
function extractOutboundLinks($body, $baseUrl) {
    $source = stripTrailingComments(narrowToReadable($body));
    $source = pregReplaceStrict('/<(script|style|svg|noscript|template)\b[^>]*>.*?<\/\1>/is', ' ', $source);
    $source = pregReplaceStrict('/<(nav|header|footer)\b[^>]*>.*?<\/\1>/is', ' ', $source);

    $linkPattern = '/<a\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*>(.*?)<\/a>/is';
    $found = preg_match_all($linkPattern, $source, $matches, PREG_SET_ORDER);
    if ($found === false) {
        throw new PageTextExtractionError(preg_last_error_msg() . " in $linkPattern");
    }
    if ($found === 0) {
        return [];
    }

    $links = [];
    $seen = [];
    foreach ($matches as $match) {
        $href = html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        if ($href === '' || $href[0] === '#' || stripos($href, 'javascript:') === 0
            || stripos($href, 'mailto:') === 0 || stripos($href, 'tel:') === 0) {
            continue;
        }
        $resolved = absolutizeUrl($href, $baseUrl);
        if ($resolved === '' || !preg_match('/^https?:\/\//i', $resolved)) {
            continue;
        }
        $canonical = strtok($resolved, '#');
        if ($canonical === false || $canonical === '' || $canonical === $baseUrl) {
            continue;
        }
        if (isset($seen[$canonical])) {
            continue;
        }
        $seen[$canonical] = true;

        $text = pregReplaceStrict('/<[^>]+>/', ' ', $match[2]);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = trim(pregReplaceStrict('/\s+/', ' ', $text));
        $text = utf8Prefix($text, 300);

        $links[] = ['text' => $text, 'url' => $canonical];
        if (count($links) >= 400) {
            break;
        }
    }
    return $links;
}

const STRUCTURED_DATA_MAX_BYTES = 1000000;

// The page's JSON-LD blocks, parsed, in page order. Music pages often carry
// their tracklist only here (Apple Music renders its song list client-side),
// so the importer passes the blocks through and each client takes what it
// can use. A block that is not valid JSON carries no data and is skipped.
function extractStructuredData($body) {
    $pattern = '/<script\b[^>]*\btype=["\']application\/ld\+json["\'][^>]*>(.*?)<\/script>/is';
    $found = preg_match_all($pattern, $body, $matches);
    if ($found === false) {
        throw new PageTextExtractionError(preg_last_error_msg() . " in $pattern");
    }
    $blocks = [];
    $bytes = 0;
    foreach ($matches[1] as $raw) {
        $bytes += strlen($raw);
        if ($bytes > STRUCTURED_DATA_MAX_BYTES) {
            break;
        }
        $decoded = json_decode(trim($raw));
        if ($decoded !== null) {
            $blocks[] = $decoded;
        }
    }
    return $blocks;
}

const READABLE_TEXT_MAX_BYTES = 800000;

// The readUrl answer for a fetched page that is not a PDF:
// [HTTP status, JSON-ready body].
function readablePageAnswer($url, $requestedUrl, $contentType, $body) {
    $isPlainText = stripos($contentType, 'text/plain') !== false;
    try {
        $title = $isPlainText ? '' : extractPageTitle($body);
        $text = $isPlainText ? extractPlainText($body) : extractReadableText($body);
        $links = $isPlainText ? [] : extractOutboundLinks($body, $url);
        $structuredData = $isPlainText ? [] : extractStructuredData($body);
    } catch (PageTextExtractionError $error) {
        return [500, ['error' => "Could not extract readable text from $url: {$error->getMessage()}"]];
    }

    $originalCharCount = strlen($text);
    $truncated = $originalCharCount > READABLE_TEXT_MAX_BYTES;
    $text = utf8Prefix($text, READABLE_TEXT_MAX_BYTES);
    if ($text === '') {
        return [422, ['error' => 'No readable text found on linked page']];
    }

    return [200, [
        'url' => $url,
        'requestedUrl' => $requestedUrl,
        'title' => $title,
        'text' => $text,
        'charCount' => strlen($text),
        'originalCharCount' => $originalCharCount,
        'truncated' => $truncated,
        'contentType' => $contentType,
        'links' => $links,
        'structuredData' => $structuredData
    ]];
}

// ---------------- YouTube channel and playlist listing ----------------
// proxy.php?youtube=... lists a channel's uploads, releases, and playlists so
// the Lyrics page can load them in bulk. The browser names a channel, a
// playlist, or a next-page token; the outbound host is always
// www.youtube.com (the keyless API youtube.com's own pages call), so this
// mode adds no general-purpose fetch. Requests carry no User-Agent, cookie,
// or other header that could identify this site or its user.
//
// Answers are cached here for every browser, and every outbound call spends
// one shared budget. YouTube publishes no limit for this API, so the budget
// is a politeness cap: a call past it is refused (HTTP 429 naming the wait),
// never queued or retried.
const YOUTUBE_API_BASE = 'https://www.youtube.com/youtubei/v1/';
// The web client version youtube.com reported on 2026-10-07. Once YouTube
// stops accepting it, every call fails loudly; update it then.
const YOUTUBE_CLIENT_CONTEXT = [
    'client' => ['clientName' => 'WEB', 'clientVersion' => '2.20261007.01.00', 'hl' => 'en', 'gl' => 'US']
];
// Channel tab selectors exactly as YouTube's own link resolver issues them.
const YOUTUBE_TAB_PARAMS = [
    'playlists' => 'EglwbGF5bGlzdHO4AQCSAwDyBgQKAkIA',
    'releases' => 'EghyZWxlYXNlc7gBAJIDAPIGBQoDsgEA'
];
const YOUTUBE_RESPONSE_MAX_BYTES = 6000000; // a 100-video page is about 1.3 MB
const YOUTUBE_TIMEOUT_SECONDS = 20;
// Part of every cache key: bump it whenever an answer's shape changes, so an
// answer cached in the old shape is never served.
const YOUTUBE_CACHE_VERSION = 1;
// Uploads and playlists can change at any moment; the channel a link names
// almost never does.
const YOUTUBE_LISTING_TTL_SECONDS = 21600; // 6 hours
const YOUTUBE_RESOLVE_TTL_SECONDS = 2592000; // 30 days
// Outbound calls allowed per window (window seconds => calls), across all
// browsers. Opening a channel costs up to three calls; Load all, up to ten.
const YOUTUBE_BUDGET = [60 => 30, 3600 => 300];
const YOUTUBE_CHANNEL_ID = '/^UC[A-Za-z0-9_-]{22}$/';
const YOUTUBE_PLAYLIST_ID = '/^[A-Za-z0-9_-]{2,64}$/';
const YOUTUBE_PAGE_TOKEN = '/^[A-Za-z0-9_%=+\/-]{16,4000}$/';

class YouTubeListingError extends RuntimeException {
    public $status;
    public $retryAfterSeconds;

    public function __construct($status, $message, $retryAfterSeconds = 0) {
        parent::__construct($message);
        $this->status = $status;
        $this->retryAfterSeconds = $retryAfterSeconds;
    }
}

// Cache entries and the budget live in the system temp directory, the one
// place the PHP pool may write besides the site (open_basedir).
function youtubeStateDir() {
    $dir = sys_get_temp_dir() . '/voice-wei-youtube';
    if (!is_dir($dir) && !mkdir($dir, 0700) && !is_dir($dir)) {
        throw new YouTubeListingError(500, "Cannot create the YouTube listing cache at $dir");
    }
    return $dir;
}

// Entry names carry their lifetime so the sweep can expire them.
function youtubeCachePath($key, $ttlSeconds) {
    return youtubeStateDir() . "/cache-$ttlSeconds-" . hash('sha256', YOUTUBE_CACHE_VERSION . "|$key") . '.json';
}

// The answer stored under $key while it is younger than $ttlSeconds;
// otherwise $fetch() supplies it, and it is stored for every later request.
function youtubeCached($key, $ttlSeconds, callable $fetch) {
    $path = youtubeCachePath($key, $ttlSeconds);
    if (is_file($path) && time() - filemtime($path) < $ttlSeconds) {
        $cached = json_decode((string) file_get_contents($path), true);
        if (is_array($cached)) {
            return $cached;
        }
    }
    $answer = $fetch();
    $temp = "$path." . bin2hex(random_bytes(6)) . '.tmp';
    if (file_put_contents($temp, json_encode($answer)) === false || !rename($temp, $path)) {
        throw new YouTubeListingError(500, 'Cannot write the YouTube listing cache');
    }
    youtubeSweepCache(time());
    return $answer;
}

// Expired entries, and temp files a crashed write left behind, are deleted
// at most once a day, by the first cache write that finds the stamp a day old.
function youtubeSweepCache($now) {
    $dir = youtubeStateDir();
    $stamp = "$dir/sweep-stamp";
    if (is_file($stamp) && $now - filemtime($stamp) < 86400) {
        return;
    }
    touch($stamp);
    foreach (glob("$dir/cache-*") ?: [] as $file) {
        $lifetime = preg_match('/\/cache-(\d+)-[0-9a-f]{64}\.json$/', $file, $match) ? (int) $match[1] : 3600;
        if (is_file($file) && $now - filemtime($file) >= $lifetime) {
            unlink($file);
        }
    }
}

// Fixed windows, each counting the calls since it opened. A call is refused
// while any window is full; the wait is until the fullest one closes.
function youtubeBudgetDecision($state, $now) {
    $windows = [];
    $waitSeconds = 0;
    foreach (YOUTUBE_BUDGET as $seconds => $limit) {
        $window = $state[$seconds] ?? null;
        if (!is_array($window) || $now - $window['start'] >= $seconds) {
            $window = ['start' => $now, 'calls' => 0];
        }
        if ($window['calls'] >= $limit) {
            $waitSeconds = max($waitSeconds, $window['start'] + $seconds - $now);
        }
        $windows[$seconds] = $window;
    }
    if ($waitSeconds > 0) {
        return ['allowed' => false, 'state' => $state, 'waitSeconds' => $waitSeconds];
    }
    foreach ($windows as $seconds => $window) {
        $windows[$seconds]['calls']++;
    }
    return ['allowed' => true, 'state' => $windows, 'waitSeconds' => 0];
}

// Counts one outbound call against the shared budget (the file lock makes
// concurrent PHP workers take turns), or refuses it with the wait.
function youtubeSpendBudget() {
    $handle = fopen(youtubeStateDir() . '/budget.json', 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        throw new YouTubeListingError(500, 'Cannot open the YouTube request budget');
    }
    $state = json_decode((string) stream_get_contents($handle), true);
    $decision = youtubeBudgetDecision(is_array($state) ? $state : [], time());
    if ($decision['allowed']) {
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($decision['state']));
        fflush($handle);
    }
    flock($handle, LOCK_UN);
    fclose($handle);
    if (!$decision['allowed']) {
        throw new YouTubeListingError(
            429,
            "This site's YouTube request budget is used up; try again in {$decision['waitSeconds']} seconds",
            $decision['waitSeconds']
        );
    }
}

// One budgeted call to YouTube's web API. YouTube answers 400 or 404 when it
// does not know what was named; $missing says what that was.
function youtubeApi($endpoint, $body, $missing) {
    youtubeSpendBudget();
    $result = requestPublicUrl(
        YOUTUBE_API_BASE . $endpoint . '?prettyPrint=false',
        'application/json',
        YOUTUBE_RESPONSE_MAX_BYTES,
        YOUTUBE_TIMEOUT_SECONDS,
        ['postJson' => json_encode(['context' => YOUTUBE_CLIENT_CONTEXT] + $body), 'userAgent' => null]
    );
    $status = $result['httpCode'];
    $data = $result['response'] === false ? null : json_decode($result['response'], true);
    if ($status === 400 || $status === 404) {
        $said = $data['error']['message'] ?? "HTTP $status";
        throw new YouTubeListingError(404, "$missing (YouTube said: $said)");
    }
    if ($status !== 200 || !is_array($data)) {
        $detail = $result['error'] ?: "HTTP $status";
        throw new YouTubeListingError(502, "YouTube did not answer $endpoint: $detail");
    }
    return $data;
}

// Every value stored under $key anywhere inside $node, depth first.
function youtubeFindAll($node, $key, &$found = []) {
    if (is_array($node)) {
        foreach ($node as $childKey => $child) {
            if ($childKey === $key) {
                $found[] = $child;
            }
            youtubeFindAll($child, $key, $found);
        }
    }
    return $found;
}

function youtubeRunsText($node) {
    $text = '';
    foreach ($node['runs'] ?? [] as $run) {
        $text .= (string) ($run['text'] ?? '');
    }
    return $text;
}

// "19,452 videos" -> 19452, "No videos" -> 0, anything else -> null.
function youtubeCount($text) {
    if (preg_match('/\d[\d,]*/', $text, $match)) {
        return (int) str_replace(',', '', $match[0]);
    }
    return stripos($text, 'no ') === 0 ? 0 : null;
}

// One video from a lockup, or null for anything that is not a playable
// video (playlists, shelves, malformed entries).
function youtubeVideoItem($lockup) {
    $videoId = $lockup['contentId'] ?? '';
    if (($lockup['contentType'] ?? '') !== 'LOCKUP_CONTENT_TYPE_VIDEO'
        || !is_string($videoId) || !preg_match('/^[A-Za-z0-9_-]{11}$/', $videoId)) {
        return null;
    }
    $meta = $lockup['metadata']['lockupMetadataViewModel'] ?? [];
    $rows = $meta['metadata']['contentMetadataViewModel']['metadataRows'] ?? [];
    $duration = '';
    foreach (youtubeFindAll($lockup['contentImage'] ?? [], 'thumbnailBadgeViewModel') as $badge) {
        $text = (string) ($badge['text'] ?? '');
        if (preg_match('/^\d+(?::\d\d){1,2}$/', $text)) {
            $duration = $text;
            break;
        }
    }
    return [
        'videoId' => $videoId,
        'title' => (string) ($meta['title']['content'] ?? ''),
        'channelTitle' => (string) ($rows[0]['metadataParts'][0]['text']['content'] ?? ''),
        'duration' => $duration,
        'published' => (string) ($rows[1]['metadataParts'][1]['text']['content'] ?? '')
    ];
}

// One playlist: a channel playlist (a lockup) or a release (a
// playlistRenderer), or null for anything else.
function youtubePlaylistItem($entry) {
    if (isset($entry['playlistRenderer'])) {
        $renderer = $entry['playlistRenderer'];
        $playlistId = (string) ($renderer['playlistId'] ?? '');
        $title = (string) ($renderer['title']['simpleText'] ?? '');
        $videoCount = isset($renderer['videoCount']) ? (int) $renderer['videoCount'] : null;
    } elseif (($entry['lockupViewModel']['contentType'] ?? '') === 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
        $lockup = $entry['lockupViewModel'];
        $playlistId = (string) ($lockup['contentId'] ?? '');
        $title = (string) ($lockup['metadata']['lockupMetadataViewModel']['title']['content'] ?? '');
        $videoCount = null;
        foreach (youtubeFindAll($lockup['contentImage'] ?? [], 'thumbnailBadgeViewModel') as $badge) {
            if (preg_match('/^[\d,]+ videos?$/', (string) ($badge['text'] ?? ''))) {
                $videoCount = youtubeCount($badge['text']);
                break;
            }
        }
    } else {
        return null;
    }
    if (!preg_match(YOUTUBE_PLAYLIST_ID, $playlistId)) {
        return null;
    }
    return ['playlistId' => $playlistId, 'title' => $title, 'videoCount' => $videoCount];
}

// The array holding a listing's items. Playlist pages, channel grids, and
// next-page answers keep their items, then the next-page token, in one
// array. The other tokens in a response (channel header panels, the
// recommendations YouTube appends to short playlists) load unrelated lists,
// so only this array is read.
function youtubeItemArray($node) {
    if (!is_array($node)) {
        return null;
    }
    if (array_is_list($node)) {
        foreach ($node as $entry) {
            if (isset($entry['lockupViewModel']) || isset($entry['playlistRenderer']) || isset($entry['richItemRenderer'])) {
                return $node;
            }
        }
    }
    foreach ($node as $child) {
        $found = youtubeItemArray($child);
        if ($found !== null) {
            return $found;
        }
    }
    return null;
}

function youtubeContinuationToken($node) {
    if (!is_array($node)) {
        return null;
    }
    if (is_string($node['continuationCommand']['token'] ?? null)) {
        return $node['continuationCommand']['token'];
    }
    foreach ($node as $child) {
        $token = youtubeContinuationToken($child);
        if ($token !== null) {
            return $token;
        }
    }
    return null;
}

// Videos, playlists, and the next-page token from one item array. Channel
// grids end in a continuationItemRenderer, playlist pages in a
// continuationItemViewModel. Entries none of which can be read mean
// YouTube changed its format, which is reported rather than shown as an
// empty list.
function youtubeListing($items) {
    $listing = ['videos' => [], 'playlists' => [], 'continuation' => null];
    $entries = 0;
    foreach ($items ?? [] as $entry) {
        $holder = $entry['continuationItemRenderer'] ?? $entry['continuationItemViewModel'] ?? null;
        if ($holder !== null) {
            $listing['continuation'] = youtubeContinuationToken($holder);
            continue;
        }
        $entries++;
        $entry = $entry['richItemRenderer']['content'] ?? $entry;
        $video = isset($entry['lockupViewModel']) ? youtubeVideoItem($entry['lockupViewModel']) : null;
        if ($video !== null) {
            $listing['videos'][] = $video;
            continue;
        }
        $playlist = youtubePlaylistItem($entry);
        if ($playlist !== null) {
            $listing['playlists'][] = $playlist;
        }
    }
    if ($entries > 0 && !$listing['videos'] && !$listing['playlists']) {
        throw new YouTubeListingError(502, "YouTube's list format changed: none of its $entries entries could be read");
    }
    return $listing;
}

function youtubeSelectedTab($response) {
    foreach ($response['contents']['twoColumnBrowseResultsRenderer']['tabs'] ?? [] as $tab) {
        if (($tab['tabRenderer']['selected'] ?? false) === true) {
            return $tab['tabRenderer'];
        }
    }
    throw new YouTubeListingError(502, "YouTube's answer held no list (it may be private or removed)");
}

// The last path segment a channel tab links to: "videos", "playlists", ...
function youtubeTabPath($tab) {
    $url = (string) ($tab['endpoint']['commandMetadata']['webCommandMetadata']['url'] ?? '');
    return substr($url, strrpos($url, '/') + 1);
}

// A channel answer: identity, the sections it has, and its first page of
// playlists. A channel's long-form uploads, most popular uploads, and past
// live streams are playlists whose ids replace the channel id's UC prefix.
function youtubeChannelPage($response) {
    $metadata = $response['metadata']['channelMetadataRenderer'] ?? [];
    $channelId = (string) ($metadata['externalId'] ?? '');
    if (!preg_match(YOUTUBE_CHANNEL_ID, $channelId)) {
        throw new YouTubeListingError(502, "YouTube's channel answer had no channel id");
    }
    $tabs = array_map(
        fn($tab) => youtubeTabPath($tab['tabRenderer'] ?? []),
        $response['contents']['twoColumnBrowseResultsRenderer']['tabs'] ?? []
    );
    $uploads = substr($channelId, 2);
    $sections = [];
    if (in_array('videos', $tabs, true)) {
        $sections[] = ['key' => 'videos', 'title' => 'Videos', 'playlistId' => "UULF$uploads"];
        $sections[] = ['key' => 'popular', 'title' => 'Popular', 'playlistId' => "UULP$uploads"];
    }
    if (in_array('streams', $tabs, true)) {
        $sections[] = ['key' => 'live', 'title' => 'Live', 'playlistId' => "UULV$uploads"];
    }
    if (in_array('releases', $tabs, true)) {
        $sections[] = ['key' => 'releases', 'title' => 'Releases'];
    }
    $listing = ['playlists' => [], 'continuation' => null];
    if (in_array('playlists', $tabs, true)) {
        $sections[] = ['key' => 'playlists', 'title' => 'Playlists'];
        $selected = youtubeSelectedTab($response);
        if (youtubeTabPath($selected) === 'playlists') {
            $listing = youtubeListing(youtubeItemArray($selected['content'] ?? []));
        }
    }
    $vanityUrl = (string) ($metadata['vanityChannelUrl'] ?? '');
    return [
        'channel' => [
            'id' => $channelId,
            'title' => (string) ($metadata['title'] ?? ''),
            'handle' => preg_match('~/(@[^/]+)$~', $vanityUrl, $match) ? rawurldecode($match[1]) : ''
        ],
        'sections' => $sections,
        'playlists' => $listing['playlists'],
        'continuation' => $listing['continuation']
    ];
}

// A channel's Releases tab: albums, EPs, and singles, each a playlist.
function youtubeReleasesPage($response) {
    $selected = youtubeSelectedTab($response);
    if (youtubeTabPath($selected) !== 'releases') {
        return ['playlists' => [], 'continuation' => null];
    }
    $listing = youtubeListing(youtubeItemArray($selected['content'] ?? []));
    return ['playlists' => $listing['playlists'], 'continuation' => $listing['continuation']];
}

// Who a playlist belongs to. A channel's playlist names the channel in the
// sidebar; an album (OLAK...) belongs to no channel, and its header
// subtitle names the artist instead ("Fleet Foxes • Album").
function youtubePlaylistOwner($response) {
    $owner = youtubeFindAll($response['sidebar'] ?? [], 'videoOwnerRenderer')[0] ?? null;
    if ($owner !== null) {
        return youtubeRunsText($owner['title'] ?? []);
    }
    $subtitle = (string) ($response['header']['playlistHeaderRenderer']['subtitle']['simpleText'] ?? '');
    return preg_match('/^(.+) \x{2022} Album$/u', $subtitle, $match) ? $match[1] : '';
}

// One playlist's first page. The sidebar carries the count in both of
// YouTube's playlist header formats.
function youtubePlaylistPage($response) {
    $listing = youtubeListing(youtubeItemArray(youtubeSelectedTab($response)['content'] ?? []));
    $primary = youtubeFindAll($response['sidebar'] ?? [], 'playlistSidebarPrimaryInfoRenderer')[0] ?? [];
    return [
        'playlist' => [
            'title' => (string) ($response['metadata']['playlistMetadataRenderer']['title'] ?? ''),
            'ownerTitle' => youtubePlaylistOwner($response),
            'videoCount' => youtubeCount(youtubeRunsText($primary['stats'][0] ?? []))
        ],
        'videos' => $listing['videos'],
        'continuation' => $listing['continuation']
    ];
}

// The page a next-page token names (videos or playlists, by list).
function youtubeNextPage($response) {
    foreach ($response['onResponseReceivedActions'] ?? [] as $action) {
        if (isset($action['appendContinuationItemsAction'])) {
            return youtubeListing($action['appendContinuationItemsAction']['continuationItems'] ?? []);
        }
    }
    throw new YouTubeListingError(502, "YouTube's next-page answer had no items");
}

// A channel link reduced to its channel part on www.youtube.com (any tab or
// query dropped), or null when the link names no channel.
function youtubeChannelUrl($url) {
    $parts = parse_url($url);
    if (!is_array($parts)
        || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true)
        || !in_array(strtolower($parts['host'] ?? ''), ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'], true)
        || !preg_match('~^/(@[^/]+|(?:channel|c|user)/[^/]+)~', $parts['path'] ?? '', $match)) {
        return null;
    }
    return 'https://www.youtube.com/' . $match[1];
}

function youtubeResolveChannelId($channelUrl) {
    if (preg_match('~/channel/(UC[A-Za-z0-9_-]{22})$~', $channelUrl, $match)) {
        return $match[1];
    }
    $answer = youtubeCached("resolve|$channelUrl", YOUTUBE_RESOLVE_TTL_SECONDS, function () use ($channelUrl) {
        $response = youtubeApi('navigation/resolve_url', ['url' => $channelUrl], "No YouTube channel at $channelUrl");
        $channelId = (string) ($response['endpoint']['browseEndpoint']['browseId'] ?? '');
        if (!preg_match(YOUTUBE_CHANNEL_ID, $channelId)) {
            throw new YouTubeListingError(404, "No YouTube channel at $channelUrl");
        }
        return ['channelId' => $channelId];
    });
    return $answer['channelId'];
}

// The answer to one youtube= request. Everything is validated before any
// cache, budget, or network work.
function youtubeListingAnswer($params) {
    foreach (['youtube', 'id', 'url', 'token'] as $name) {
        if (isset($params[$name]) && (!is_string($params[$name]) || strlen($params[$name]) > 4000)) {
            throw new YouTubeListingError(400, "The $name parameter must be text of at most 4000 characters");
        }
    }
    $id = trim($params['id'] ?? '');
    switch ($params['youtube'] ?? '') {
        case 'channel':
            if ($id === '') {
                $channelUrl = youtubeChannelUrl(trim($params['url'] ?? ''));
                if ($channelUrl === null) {
                    throw new YouTubeListingError(400, 'Not a YouTube channel link');
                }
                $id = youtubeResolveChannelId($channelUrl);
            }
            if (!preg_match(YOUTUBE_CHANNEL_ID, $id)) {
                throw new YouTubeListingError(400, 'Not a YouTube channel id');
            }
            return youtubeCached("channel|$id", YOUTUBE_LISTING_TTL_SECONDS, fn() => youtubeChannelPage(
                youtubeApi('browse', ['browseId' => $id, 'params' => YOUTUBE_TAB_PARAMS['playlists']], "No YouTube channel $id")
            ));
        case 'releases':
            if (!preg_match(YOUTUBE_CHANNEL_ID, $id)) {
                throw new YouTubeListingError(400, 'Not a YouTube channel id');
            }
            return youtubeCached("releases|$id", YOUTUBE_LISTING_TTL_SECONDS, fn() => youtubeReleasesPage(
                youtubeApi('browse', ['browseId' => $id, 'params' => YOUTUBE_TAB_PARAMS['releases']], "No YouTube channel $id")
            ));
        case 'playlist':
            if (!preg_match(YOUTUBE_PLAYLIST_ID, $id)) {
                throw new YouTubeListingError(400, 'Not a YouTube playlist id');
            }
            return youtubeCached("playlist|$id", YOUTUBE_LISTING_TTL_SECONDS, fn() => youtubePlaylistPage(
                youtubeApi('browse', ['browseId' => "VL$id"], "No YouTube playlist $id")
            ));
        case 'more':
            $token = trim($params['token'] ?? '');
            if (!preg_match(YOUTUBE_PAGE_TOKEN, $token)) {
                throw new YouTubeListingError(400, 'Not a YouTube next-page token');
            }
            return youtubeCached("more|$token", YOUTUBE_LISTING_TTL_SECONDS, fn() => youtubeNextPage(
                youtubeApi('browse', ['continuation' => $token], 'YouTube no longer accepts this next-page token; reopen the list')
            ));
    }
    throw new YouTubeListingError(400, 'Unknown YouTube operation (use channel, releases, playlist, or more)');
}

// Page-read mode: proxy.php?readUrl=https://example.com/page
if (isset($_GET['readUrl'])) {
    $requestedUrl = trim($_GET['readUrl']);
    $url = resolveReadablePageUrl($requestedUrl);
    if (!isPublicHttpUrl($url)) {
        http_response_code(400);
        echo json_encode(['error' => 'Only public http(s) page URLs can be read']);
        exit;
    }

    $result = makePageRequest($url);
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300 || !$result['response']) {
        http_response_code($result['httpCode'] === 413 ? 413 : 502);
        echo json_encode(['error' => $result['error'] ?: "Could not read page: HTTP {$result['httpCode']}"]);
        exit;
    }
    $url = $result['finalUrl'] ?? $url;

    // PDFs cannot be turned into readable text by tag stripping; tell the
    // client to fetch the bytes (via assetUrl) and parse them with PDF.js.
    $looksPdf = stripos($result['contentType'], 'application/pdf') !== false
        || substr($result['response'], 0, 5) === '%PDF-'
        || preg_match('/\.pdf($|\?)/i', $url);
    if ($looksPdf) {
        $pathName = basename(parse_url($url, PHP_URL_PATH) ?: '');
        echo json_encode([
            'url' => $url,
            'requestedUrl' => $requestedUrl,
            'title' => $pathName !== '' ? $pathName : $url,
            'kind' => 'pdf',
            'isBinary' => true,
            'contentType' => $result['contentType'] ?: 'application/pdf'
        ]);
        exit;
    }
    $readableContentType = $result['contentType'] === ''
        || stripos($result['contentType'], 'text/html') !== false
        || stripos($result['contentType'], 'application/xhtml+xml') !== false
        || stripos($result['contentType'], 'text/plain') !== false;
    if (!$readableContentType) {
        http_response_code(415);
        echo json_encode(['error' => 'Remote URL is not a readable webpage or PDF']);
        exit;
    }

    $body = strlen($result['response']) > 8000000 ? substr($result['response'], 0, 8000000) : $result['response'];
    [$status, $answer] = readablePageAnswer($url, $requestedUrl, $result['contentType'], $body);
    $json = json_encode($answer);
    if ($json === false) {
        http_response_code(502);
        echo json_encode(['error' => "Page text from $url could not be encoded as JSON: " . json_last_error_msg()]);
        exit;
    }
    http_response_code($status);
    echo $json;
    exit;
}

// Asset passthrough: proxy.php?assetUrl=https://example.com/file.pdf
// Streams raw bytes back with the upstream content type so the browser can
// parse cross-origin assets (e.g. PDFs via PDF.js) without hitting CORS.
if (isset($_GET['assetUrl'])) {
    $assetUrl = trim($_GET['assetUrl']);
    if (!isPublicHttpUrl($assetUrl)) {
        http_response_code(400);
        echo json_encode(['error' => 'Only public http(s) asset URLs can be fetched']);
        exit;
    }

    $result = requestPublicUrl($assetUrl, 'application/pdf', 60000000, 45);
    $bytes = $result['response'];
    $httpCode = $result['httpCode'];
    $contentType = $result['contentType'];
    if ($httpCode < 200 || $httpCode >= 300 || $bytes === false || $bytes === '') {
        http_response_code($httpCode === 413 ? 413 : 502);
        echo json_encode(['error' => $result['error'] ?: "Could not fetch PDF: HTTP {$httpCode}"]);
        exit;
    }
    if (stripos($contentType, 'application/pdf') === false && substr($bytes, 0, 5) !== '%PDF-') {
        http_response_code(415);
        echo json_encode(['error' => 'Remote asset is not a PDF']);
        exit;
    }

    header('Content-Type: application/pdf');
    header('Content-Length: ' . strlen($bytes));
    echo $bytes;
    exit;
}

// YouTube listing mode: proxy.php?youtube=channel&url=<channel link> (or
// &id=UC...), youtube=releases&id=UC..., youtube=playlist&id=<playlist id>,
// youtube=more&token=<next-page token>.
if (isset($_GET['youtube'])) {
    try {
        echo json_encode(youtubeListingAnswer($_GET));
    } catch (YouTubeListingError $error) {
        http_response_code($error->status);
        $body = ['error' => $error->getMessage()];
        if ($error->retryAfterSeconds > 0) {
            header('Retry-After: ' . $error->retryAfterSeconds);
            $body['retryAfterSeconds'] = $error->retryAfterSeconds;
        }
        echo json_encode($body);
    }
    exit;
}

// Fixed-provider lyrics search: proxy.php?lyrics=search&track_name=...&artist_name=...
// The browser supplies only identity fields; it cannot choose the outbound
// host, so this path adds no general-purpose SSRF surface.
if (isset($_GET['lyrics'])) {
    if ($_GET['lyrics'] !== 'search') {
        http_response_code(400);
        echo json_encode(['error' => 'Unknown lyrics operation']);
        exit;
    }

    $trackParam = $_GET['track_name'] ?? '';
    $artistParam = $_GET['artist_name'] ?? '';
    if (!is_string($trackParam) || !is_string($artistParam)) {
        http_response_code(400);
        echo json_encode(['error' => 'Lyrics search identity must be text']);
        exit;
    }
    $trackName = trim($trackParam);
    $artistName = trim($artistParam);
    if ($trackName === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Lyrics search requires track_name']);
        exit;
    }
    if (strlen($trackName) > 300 || strlen($artistName) > 300) {
        http_response_code(400);
        echo json_encode(['error' => 'Lyrics search identity is too long']);
        exit;
    }

    $query = ['track_name' => $trackName];
    if ($artistName !== '') {
        $query['artist_name'] = $artistName;
    }
    $url = 'https://lrclib.net/api/search?' . http_build_query(
        $query,
        '',
        '&',
        PHP_QUERY_RFC3986
    );
    $result = requestPublicUrl($url, 'application/json', 2000000, 12);
    $httpCode = $result['httpCode'];
    $body = $result['response'];
    if ($httpCode < 200 || $httpCode >= 300 || $body === false) {
        $timedOut = $httpCode === 504 || stripos($result['error'], 'timed out') !== false;
        http_response_code($timedOut ? 504 : 502);
        echo json_encode([
            'error' => $timedOut
                ? 'Lyrics provider timed out'
                : ($result['error'] ?: "Lyrics provider returned HTTP {$httpCode}")
        ]);
        exit;
    }

    $data = json_decode($body, true);
    if (!is_array($data)) {
        http_response_code(502);
        echo json_encode(['error' => 'Lyrics provider returned invalid JSON']);
        exit;
    }

    echo json_encode($data);
    exit;
}

// Test mode: proxy.php?test=1
// deploy/smoke-live.sh recognizes this proxy answering outside the app
// directory by the status text, so rewording it blinds that check.
if (isset($_GET['test'])) {
    echo json_encode([
        'status' => 'Search and Books URL import are working',
        'php_version' => PHP_VERSION,
        'curl_available' => function_exists('curl_init'),
        'openssl_version' => defined('OPENSSL_VERSION_TEXT') ? OPENSSL_VERSION_TEXT : 'unknown',
        'server_time' => date('Y-m-d H:i:s')
    ]);
    exit;
}

$query = trim($_GET['q'] ?? '');
if ($query !== '') {
    if (strlen($query) > 500) {
        http_response_code(400);
        echo json_encode(['error' => 'Search query is too long']);
        exit;
    }

    $pipedInstances = [
        'https://api.piped.private.coffee',
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de'
    ];
    $invidiousInstances = [
        'https://invidious.private.coffee',
        'https://inv.nadeko.net'
    ];
    $lastError = '';
    $triedInstances = [];

    // YouTube's auto-generated album tracks ("Provided to YouTube by ...",
    // uploaded under "<Artist> - Topic") are the studio recording by
    // construction. Piped strips the " - Topic" suffix from uploader names,
    // so the description prefix is the reliable signal there; Invidious
    // keeps the suffix. Detect per source and pass one normalized flag.
    $isAutoGeneratedTrack = function ($uploaderName, $description) {
        if (preg_match('/ - Topic$/', trim((string) $uploaderName))) {
            return true;
        }
        return stripos(ltrim((string) $description), 'Provided to YouTube by') === 0;
    };

    foreach ($pipedInstances as $instance) {
        $triedInstances[] = $instance;
        $result = makeSearchRequest($instance . '/search?q=' . urlencode($query) . '&filter=videos');
        if ($result['httpCode'] === 200 && $result['response']) {
            $data = json_decode($result['response'], true);
            $results = [];
            foreach (($data['items'] ?? []) as $item) {
                if (($item['type'] ?? '') !== 'stream') {
                    continue;
                }
                $videoId = str_replace('/watch?v=', '', $item['url'] ?? '');
                if ($videoId === '') {
                    continue;
                }
                $results[] = [
                    'videoId' => $videoId,
                    'title' => $item['title'] ?? 'Unknown',
                    'channelTitle' => $item['uploaderName'] ?? 'Unknown',
                    'duration' => $item['duration'] ?? 0,
                    'isAlbumTrack' => $isAutoGeneratedTrack($item['uploaderName'] ?? '', $item['shortDescription'] ?? ''),
                    'source' => 'piped',
                    'instance' => $instance
                ];
            }
            if ($results) {
                echo json_encode(['results' => $results, 'source' => 'piped', 'instance' => $instance]);
                exit;
            }
        }
        $lastError = $result['error'] ?: "HTTP {$result['httpCode']} from $instance";
    }

    foreach ($invidiousInstances as $instance) {
        $triedInstances[] = $instance;
        $result = makeSearchRequest($instance . '/api/v1/search?q=' . urlencode($query) . '&type=video');
        if ($result['httpCode'] === 200 && $result['response']) {
            $data = json_decode($result['response'], true);
            $results = [];
            foreach ((is_array($data) ? $data : []) as $item) {
                if (!isset($item['videoId'])) {
                    continue;
                }
                $results[] = [
                    'videoId' => $item['videoId'],
                    'title' => $item['title'] ?? 'Unknown',
                    'channelTitle' => $item['author'] ?? 'Unknown',
                    'duration' => $item['lengthSeconds'] ?? 0,
                    'isAlbumTrack' => $isAutoGeneratedTrack($item['author'] ?? '', $item['description'] ?? ''),
                    'source' => 'invidious',
                    'instance' => $instance
                ];
            }
            if ($results) {
                echo json_encode(['results' => $results, 'source' => 'invidious', 'instance' => $instance]);
                exit;
            }
        }
        $lastError = $result['error'] ?: "HTTP {$result['httpCode']} from $instance";
    }

    http_response_code(503);
    echo json_encode([
        'error' => 'All search instances unavailable',
        'lastError' => $lastError,
        'triedInstances' => $triedInstances,
        'suggestion' => 'Try again in a few minutes'
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Use q for music search, youtube for channel and playlist listing, lyrics for lyrics search, readUrl for webpages, or assetUrl for PDFs']);
