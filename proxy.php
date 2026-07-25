<?php
// Same-origin keyless YouTube search and Books URL importer. Every network hop
// is resolved and pinned before cURL connects so redirects and DNS rebinding
// cannot reach private hosts.
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

function requestPublicUrl($url, $accept, $maxBytes, $timeoutSeconds) {
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
            CURLOPT_USERAGENT => 'Voice-Wei URL Import/1.0',
            CURLOPT_HTTPHEADER => [
                'Accept: ' . $accept,
                'Accept-Language: en-US,en;q=0.9'
            ],
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

function extractPageTitle($html) {
    if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $matches)) {
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
    if (preg_match($pattern, $source, $matches, PREG_OFFSET_CAPTURE)) {
        return substr($source, 0, $matches[0][1]);
    }
    if (preg_match('/<[^>]+id=["\']comments["\'][^>]*>/i', $source, $matches, PREG_OFFSET_CAPTURE)) {
        return substr($source, 0, $matches[0][1]);
    }
    return $source;
}

function narrowToReadable($body) {
    if (preg_match('/<div[^>]+id=["\']mw-content-text["\'][^>]*>(.*?)(?:<div[^>]+class=["\']printfooter|<div[^>]+id=["\']catlinks|<\/main>|<\/body>)/is', $body, $matches)) {
        return $matches[1];
    }
    if (preg_match('/<article\b[^>]*>(.*?)<\/article>/is', $body, $matches)) {
        return $matches[1];
    }
    if (preg_match('/<div[^>]+class=["\'][^"\']*(?:entry-content|post-content|postcontent|article-content|post-body|markdown-body)[^"\']*["\'][^>]*>(.*?)(?:<footer\b|<div[^>]+(?:id|class)=["\'][^"\']*comment|<\/main>|<\/body>)/is', $body, $matches)) {
        return $matches[1];
    }
    if (preg_match('/<main\b[^>]*>(.*?)(?:<\/main>|<\/body>)/is', $body, $matches)) {
        return $matches[1];
    }
    return $body;
}

function extractReadableText($body) {
    $source = stripTrailingComments(narrowToReadable($body));
    $text = preg_replace('/<(script|style|svg|noscript|template)[^>]*>.*?<\/\1>/is', ' ', $source);
    $text = preg_replace('/<!--.*?-->/s', ' ', $text);
    $text = strip_tags($text);
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = preg_replace('/[ \t\r\n]+/', ' ', $text);
    return trim($text);
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
    $source = preg_replace('/<(script|style|svg|noscript|template)[^>]*>.*?<\/\1>/is', ' ', $source);
    $source = preg_replace('/<(nav|header|footer)\b[^>]*>.*?<\/\1>/is', ' ', $source);

    if (!preg_match_all('/<a\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*>(.*?)<\/a>/is', $source, $matches, PREG_SET_ORDER)) {
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

        $text = preg_replace('/<[^>]+>/', ' ', $match[2]);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = trim(preg_replace('/\s+/', ' ', $text));
        if (strlen($text) > 300) {
            $text = substr($text, 0, 300);
        }

        $links[] = ['text' => $text, 'url' => $canonical];
        if (count($links) >= 400) {
            break;
        }
    }
    return $links;
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
    $title = extractPageTitle($body);
    $text = extractReadableText($body);
    $links = extractOutboundLinks($body, $url);
    $originalCharCount = strlen($text);
    $truncated = $originalCharCount > 800000;
    if ($truncated) {
        $text = substr($text, 0, 800000);
    }

    if ($text === '') {
        http_response_code(422);
        echo json_encode(['error' => 'No readable text found on linked page']);
        exit;
    }

    echo json_encode([
        'url' => $url,
        'requestedUrl' => $requestedUrl,
        'title' => $title,
        'text' => $text,
        'charCount' => strlen($text),
        'originalCharCount' => $originalCharCount,
        'truncated' => $truncated,
        'contentType' => $result['contentType'],
        'links' => $links
    ]);
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

// Test mode: proxy.php?test=1
if (isset($_GET['test'])) {
    echo json_encode([
        'ok' => true,
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
echo json_encode(['error' => 'Use q for music search, readUrl for webpages, or assetUrl for PDFs']);
