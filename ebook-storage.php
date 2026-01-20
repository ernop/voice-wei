<?php
/**
 * Ebook Storage API
 * 
 * Handles persistent storage for ebook-to-audiobook conversions.
 * Uses API key hash as user namespace for isolation.
 * 
 * Endpoints:
 *   GET  ?action=list&userHash=xxx           - List user's books
 *   GET  ?action=get&userHash=xxx&bookHash=xxx  - Get book metadata
 *   GET  ?action=audio&userHash=xxx&bookHash=xxx - Get audio file
 *   POST ?action=save                        - Save book metadata
 *   POST ?action=saveAudio                   - Save audio chunk/file
 *   POST ?action=delete&userHash=xxx&bookHash=xxx - Delete a book
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Storage directory (gitignored, created if needed)
define('STORAGE_DIR', __DIR__ . '/ebook-data');

// Ensure storage directory exists
if (!is_dir(STORAGE_DIR)) {
    mkdir(STORAGE_DIR, 0755, true);
}

// Validate hash format (16 hex chars)
function isValidHash($hash) {
    return preg_match('/^[a-f0-9]{16}$/i', $hash);
}

// Get user directory path
function getUserDir($userHash) {
    if (!isValidHash($userHash)) {
        return null;
    }
    $dir = STORAGE_DIR . '/' . strtolower($userHash);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

// Prevent directory traversal
function safePath($userHash, $bookHash = null) {
    $userDir = getUserDir($userHash);
    if (!$userDir) return null;
    
    if ($bookHash !== null) {
        if (!isValidHash($bookHash)) return null;
        return $userDir . '/' . strtolower($bookHash);
    }
    return $userDir;
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$userHash = $_GET['userHash'] ?? $_POST['userHash'] ?? '';
$bookHash = $_GET['bookHash'] ?? $_POST['bookHash'] ?? '';

try {
    switch ($action) {
        case 'list':
            // List all books for a user
            $userDir = safePath($userHash);
            if (!$userDir) {
                throw new Exception('Invalid user hash');
            }
            
            $books = [];
            $indexFile = $userDir . '/index.json';
            if (file_exists($indexFile)) {
                $books = json_decode(file_get_contents($indexFile), true) ?? [];
            }
            
            echo json_encode([
                'success' => true,
                'books' => $books
            ]);
            break;
            
        case 'get':
            // Get specific book metadata
            $basePath = safePath($userHash, $bookHash);
            if (!$basePath) {
                throw new Exception('Invalid hash');
            }
            
            $metaFile = $basePath . '.json';
            if (!file_exists($metaFile)) {
                throw new Exception('Book not found');
            }
            
            $metadata = json_decode(file_get_contents($metaFile), true);
            $audioFile = $basePath . '.mp3';
            $metadata['hasAudio'] = file_exists($audioFile);
            if ($metadata['hasAudio']) {
                $metadata['audioSize'] = filesize($audioFile);
            }
            
            echo json_encode([
                'success' => true,
                'book' => $metadata
            ]);
            break;
            
        case 'audio':
            // Stream audio file
            $basePath = safePath($userHash, $bookHash);
            if (!$basePath) {
                http_response_code(400);
                echo json_encode(['error' => 'Invalid hash']);
                exit;
            }
            
            $audioFile = $basePath . '.mp3';
            if (!file_exists($audioFile)) {
                http_response_code(404);
                echo json_encode(['error' => 'Audio not found']);
                exit;
            }
            
            // Stream the audio file
            header('Content-Type: audio/mpeg');
            header('Content-Length: ' . filesize($audioFile));
            header('Accept-Ranges: bytes');
            readfile($audioFile);
            exit;
            
        case 'save':
            // Save book metadata
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                throw new Exception('POST required');
            }
            
            $input = json_decode(file_get_contents('php://input'), true);
            $userHash = $input['userHash'] ?? '';
            $bookHash = $input['bookHash'] ?? '';
            $metadata = $input['metadata'] ?? [];
            
            $basePath = safePath($userHash, $bookHash);
            if (!$basePath) {
                throw new Exception('Invalid hash');
            }
            
            // Save metadata
            $metadata['updatedAt'] = time();
            file_put_contents($basePath . '.json', json_encode($metadata, JSON_PRETTY_PRINT));
            
            // Update index
            $userDir = safePath($userHash);
            $indexFile = $userDir . '/index.json';
            $index = [];
            if (file_exists($indexFile)) {
                $index = json_decode(file_get_contents($indexFile), true) ?? [];
            }
            
            // Add or update book in index
            $found = false;
            foreach ($index as &$book) {
                if ($book['bookHash'] === $bookHash) {
                    $book['title'] = $metadata['title'] ?? $book['title'];
                    $book['updatedAt'] = $metadata['updatedAt'];
                    $found = true;
                    break;
                }
            }
            if (!$found) {
                $index[] = [
                    'bookHash' => $bookHash,
                    'title' => $metadata['title'] ?? 'Untitled',
                    'createdAt' => time(),
                    'updatedAt' => $metadata['updatedAt']
                ];
            }
            
            file_put_contents($indexFile, json_encode($index, JSON_PRETTY_PRINT));
            
            echo json_encode([
                'success' => true,
                'message' => 'Book saved'
            ]);
            break;
            
        case 'saveAudio':
            // Save audio file (binary upload)
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                throw new Exception('POST required');
            }
            
            $userHash = $_POST['userHash'] ?? '';
            $bookHash = $_POST['bookHash'] ?? '';
            
            $basePath = safePath($userHash, $bookHash);
            if (!$basePath) {
                throw new Exception('Invalid hash');
            }
            
            // Handle file upload
            if (isset($_FILES['audio'])) {
                move_uploaded_file($_FILES['audio']['tmp_name'], $basePath . '.mp3');
            } else {
                // Raw binary in request body
                $audioData = file_get_contents('php://input');
                if (strlen($audioData) > 0) {
                    file_put_contents($basePath . '.mp3', $audioData);
                } else {
                    throw new Exception('No audio data received');
                }
            }
            
            echo json_encode([
                'success' => true,
                'message' => 'Audio saved',
                'size' => filesize($basePath . '.mp3')
            ]);
            break;
            
        case 'delete':
            // Delete a book and its audio
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                throw new Exception('POST required');
            }
            
            $input = json_decode(file_get_contents('php://input'), true);
            $userHash = $input['userHash'] ?? '';
            $bookHash = $input['bookHash'] ?? '';
            
            $basePath = safePath($userHash, $bookHash);
            if (!$basePath) {
                throw new Exception('Invalid hash');
            }
            
            // Delete files
            @unlink($basePath . '.json');
            @unlink($basePath . '.mp3');
            
            // Update index
            $userDir = safePath($userHash);
            $indexFile = $userDir . '/index.json';
            if (file_exists($indexFile)) {
                $index = json_decode(file_get_contents($indexFile), true) ?? [];
                $index = array_filter($index, fn($b) => $b['bookHash'] !== $bookHash);
                file_put_contents($indexFile, json_encode(array_values($index), JSON_PRETTY_PRINT));
            }
            
            echo json_encode([
                'success' => true,
                'message' => 'Book deleted'
            ]);
            break;
            
        case 'stats':
            // Get storage stats for a user
            $userDir = safePath($userHash);
            if (!$userDir) {
                throw new Exception('Invalid user hash');
            }
            
            $totalSize = 0;
            $fileCount = 0;
            foreach (glob($userDir . '/*') as $file) {
                $totalSize += filesize($file);
                $fileCount++;
            }
            
            echo json_encode([
                'success' => true,
                'totalSize' => $totalSize,
                'totalSizeMB' => round($totalSize / (1024 * 1024), 2),
                'fileCount' => $fileCount
            ]);
            break;
            
        default:
            throw new Exception('Unknown action: ' . $action);
    }
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
