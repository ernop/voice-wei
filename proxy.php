<?php
// Server-side YouTube search proxy - NO CORS PROXY NEEDED (server-to-server)
// This proxy allows the browser to search YouTube via Piped/Invidious without API keys
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

function isPublicHttpUrl($url) {
    $parts = parse_url($url);
    if (!$parts || !isset($parts['scheme']) || !isset($parts['host'])) {
        return false;
    }

    $scheme = strtolower($parts['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') {
        return false;
    }

    $host = strtolower($parts['host']);
    if ($host === 'localhost' || substr($host, -6) === '.local') {
        return false;
    }

    $ips = gethostbynamel($host);
    if (!$ips || count($ips) === 0) {
        return false;
    }

    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return false;
        }
    }

    return true;
}

function resolveReadablePageUrl($url) {
    $parts = parse_url($url);
    if (!$parts || !isset($parts['host']) || !isset($parts['path'])) {
        return $url;
    }

    $host = strtolower($parts['host']);
    $path = $parts['path'];
    if (($host === 'tvtropes.org' || $host === 'www.tvtropes.org')
        && preg_match('/\/RegionalRiffs?$/i', $path)) {
        return 'https://allthetropes.org/wiki/Regional_Riff';
    }

    return $url;
}

function makePageRequest($url) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Accept: text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        'Accept-Language: en-US,en;q=0.9'
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_SSLVERSION, CURL_SSLVERSION_TLSv1_2);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $error = curl_error($ch);
    curl_close($ch);

    return [
        'response' => $response,
        'httpCode' => $httpCode,
        'contentType' => $contentType ?: '',
        'error' => $error
    ];
}

function extractPageTitle($html) {
    if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $matches)) {
        return trim(html_entity_decode(strip_tags($matches[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }
    return '';
}

function narrowToReadable($body) {
    if (preg_match('/<div[^>]+id=["\']mw-content-text["\'][^>]*>(.*?)(?:<div[^>]+class=["\']printfooter|<div[^>]+id=["\']catlinks|<\/main>|<\/body>)/is', $body, $matches)) {
        return $matches[1];
    }
    if (preg_match('/<main\b[^>]*>(.*?)(?:<\/main>|<\/body>)/is', $body, $matches)) {
        return $matches[1];
    }
    return $body;
}

function extractReadableText($body) {
    $source = narrowToReadable($body);
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
    $source = narrowToReadable($body);
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
        http_response_code(502);
        echo json_encode(['error' => $result['error'] ?: "Could not read page: HTTP {$result['httpCode']}"]);
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

// Test mode: proxy.php?test=1
if (isset($_GET['test'])) {
    echo json_encode([
        'status' => 'Proxy is working',
        'php_version' => PHP_VERSION,
        'curl_available' => function_exists('curl_init'),
        'openssl_version' => defined('OPENSSL_VERSION_TEXT') ? OPENSSL_VERSION_TEXT : 'unknown',
        'server_time' => date('Y-m-d H:i:s')
    ]);
    exit;
}

$query = isset($_GET['q']) ? $_GET['q'] : '';
if (empty($query)) {
    http_response_code(400);
    echo json_encode(['error' => 'No query provided. Use ?q=search+term']);
    exit;
}

// Piped instances - tested and working as of Dec 2024
// IMPORTANT: api.piped.private.coffee is CONFIRMED WORKING - put it first!
$pipedInstances = [
    'https://api.piped.private.coffee',  // Confirmed working Dec 2024
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de'
];

// Invidious instances as backup  
$invidiousInstances = [
    'https://invidious.private.coffee',
    'https://inv.nadeko.net'
];

$lastError = '';
$triedInstances = [];

// Helper function to make curl request with SSL fixes for DreamHost
function makeCurlRequest($url) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 3);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Accept: application/json',
        'Accept-Language: en-US,en;q=0.9'
    ]);
    
    // SSL options to fix TLS handshake issues on older servers
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);  // Disable for compatibility
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_SSLVERSION, CURL_SSLVERSION_TLSv1_2);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    return ['response' => $response, 'httpCode' => $httpCode, 'error' => $error];
}

// Try Piped instances first (better API format)
foreach ($pipedInstances as $instance) {
    $url = $instance . '/search?q=' . urlencode($query) . '&filter=videos';
    $triedInstances[] = $instance;
    
    $result = makeCurlRequest($url);
    
    if ($result['httpCode'] === 200 && $result['response']) {
        $data = json_decode($result['response'], true);
        if (isset($data['items']) && count($data['items']) > 0) {
            // Convert Piped format to our standard format
            $results = [];
            foreach ($data['items'] as $item) {
                if (isset($item['type']) && $item['type'] === 'stream') {
                    $videoId = isset($item['url']) ? str_replace('/watch?v=', '', $item['url']) : '';
                    if ($videoId) {
                        $results[] = [
                            'videoId' => $videoId,
                            'title' => $item['title'] ?? 'Unknown',
                            'channelTitle' => $item['uploaderName'] ?? 'Unknown',
                            'duration' => $item['duration'] ?? 0,
                            'source' => 'piped',
                            'instance' => $instance
                        ];
                    }
                }
            }
            if (count($results) > 0) {
                echo json_encode(['results' => $results, 'source' => 'piped', 'instance' => $instance]);
                exit;
            }
        }
    }
    $lastError = $result['error'] ?: "HTTP {$result['httpCode']} from $instance";
}

// Try Invidious instances as backup
foreach ($invidiousInstances as $instance) {
    $url = $instance . '/api/v1/search?q=' . urlencode($query) . '&type=video';
    $triedInstances[] = $instance;
    
    $result = makeCurlRequest($url);
    
    if ($result['httpCode'] === 200 && $result['response']) {
        $data = json_decode($result['response'], true);
        if (is_array($data) && count($data) > 0) {
            // Convert Invidious format to our standard format
            $results = [];
            foreach ($data as $item) {
                if (isset($item['videoId'])) {
                    $results[] = [
                        'videoId' => $item['videoId'],
                        'title' => $item['title'] ?? 'Unknown',
                        'channelTitle' => $item['author'] ?? 'Unknown',
                        'duration' => $item['lengthSeconds'] ?? 0,
                        'source' => 'invidious',
                        'instance' => $instance
                    ];
                }
            }
            if (count($results) > 0) {
                echo json_encode(['results' => $results, 'source' => 'invidious', 'instance' => $instance]);
                exit;
            }
        }
    }
    $lastError = $result['error'] ?: "HTTP {$result['httpCode']} from $instance";
}

// All instances failed
http_response_code(503);
echo json_encode([
    'error' => 'All search instances unavailable',
    'lastError' => $lastError,
    'triedInstances' => $triedInstances,
    'suggestion' => 'Try again in a few minutes'
]);
