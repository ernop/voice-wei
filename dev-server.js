#!/usr/bin/env node
// @ts-nocheck
//-----------------------------------------------------------------------
// DEV SERVER
// Static file server plus frontend error sink for local manual testing.
//-----------------------------------------------------------------------

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || 8765);
const ERROR_DIR = path.join(ROOT, '.dev');
const ERROR_LOG = path.join(ERROR_DIR, 'frontend-errors.jsonl');

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
};

function ensureErrorDir() {
    fs.mkdirSync(ERROR_DIR, { recursive: true });
}

/** @param {http.IncomingMessage} req */
function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 64 * 1024) {
                reject(new Error('error report too large'));
                req.destroy();
            }
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

/** @param {unknown} raw */
function normalizeError(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    return {
        at: new Date().toISOString(),
        type: typeof data.type === 'string' ? data.type : 'unknown',
        message: typeof data.message === 'string' ? data.message : JSON.stringify(data),
        source: typeof data.source === 'string' ? data.source : '',
        userAgent: typeof data.userAgent === 'string' ? data.userAgent : ''
    };
}

/** @param {http.ServerResponse} res @param {number} status @param {string} text */
function sendText(res, status, text) {
    res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(text);
}

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
async function handleErrorReport(req, res) {
    try {
        const body = await readBody(req);
        const parsed = body ? JSON.parse(body) : {};
        const entry = normalizeError(parsed);
        ensureErrorDir();
        fs.appendFileSync(ERROR_LOG, `${JSON.stringify(entry)}\n`);
        console.error(`VOICE_WEI_FRONTEND_ERROR ${entry.type}: ${entry.message} (${entry.source})`);
        sendText(res, 204, '');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendText(res, 400, message);
    }
}

/** @param {string} requestPath */
function resolveStaticPath(requestPath) {
    const decoded = decodeURIComponent(requestPath);
    const relative = decoded === '/' ? '/index.html' : decoded;
    const resolved = path.resolve(ROOT, `.${relative}`);
    if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) return null;
    return resolved;
}

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
function serveStatic(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const filePath = resolveStaticPath(url.pathname);
    if (!filePath) {
        sendText(res, 403, 'Forbidden');
        return;
    }

    fs.stat(filePath, (statErr, stat) => {
        if (statErr || !stat.isFile()) {
            sendText(res, 404, 'Not found');
            return;
        }
        const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': stat.size,
            'Cache-Control': 'no-store'
        });
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        fs.createReadStream(filePath).pipe(res);
    });
}

const server = http.createServer((req, res) => {
    if (req.url && req.url.startsWith('/__voice-wei-errors')) {
        if (req.method !== 'POST') {
            sendText(res, 405, 'Method not allowed');
            return;
        }
        handleErrorReport(req, res);
        return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method not allowed');
        return;
    }
    serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
    ensureErrorDir();
    console.log(`Voice-Wei dev server: http://127.0.0.1:${PORT}/`);
    console.log(`Frontend errors: ${ERROR_LOG}`);
});
