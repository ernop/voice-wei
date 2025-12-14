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
