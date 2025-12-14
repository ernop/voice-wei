# YouTube Search Proxy Solution

## The Problem

Google YouTube Data API v3 quota was exhausted. The free tier provides 10,000 units/day, and each search costs 100 units - meaning only ~100 searches per day. We needed an alternative.

## What We Tried (And Why It Failed)

### Attempt 1: Client-side corsproxy.io + Piped

```javascript
// In app.js - the original broken approach
const pipedUrl = `https://pipedapi.kavin.rocks/search?q=${query}&filter=videos`;
const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(pipedUrl)}`);
```

**Why it failed:**
- `corsproxy.io` is a free public CORS proxy - heavily rate-limited and unreliable
- `pipedapi.kavin.rocks` (default Piped instance) is overloaded
- Two layers of unreliable free services = frequent failures

### Attempt 2: PHP Proxy with corsproxy.io

The original `proxy.php` used corsproxy.io even though it didn't need to:

```php
// OLD proxy.php - unnecessary CORS proxy
$corsProxy = 'https://corsproxy.io/?';
$searchUrl = 'https://pipedapi.kavin.rocks/search?q=' . urlencode($query);
curl_setopt($ch, CURLOPT_URL, $corsProxy . urlencode($searchUrl));
```

**Why it failed:**
- Server-side PHP doesn't have CORS restrictions!
- Using corsproxy.io from PHP is pointless and adds another failure point

### Attempt 3: Direct Piped/Invidious from PHP

Fixed the proxy to call Piped directly:

```php
// Better - direct call
$url = 'https://pipedapi.kavin.rocks/search?q=' . urlencode($query);
curl_setopt($ch, CURLOPT_URL, $url);
```

**Why it failed:**
DreamHost's PHP/OpenSSL had TLS handshake errors with most Piped instances:
```
error:0A000438:SSL routines::tlsv1 alert internal error
```

This is a TLS version/cipher mismatch between DreamHost's older OpenSSL and the Piped servers.

## The Working Solution

### Step 1: Find a Working Piped Instance

Tested instances from the browser using Cursor's browser tools:

1. `pipedapi.kavin.rocks` - HTTP error (503)
2. `pipedapi.adminforge.de` - DNS not resolving
3. `vid.puffyan.us` - 502 Bad Gateway
4. `inv.tux.pizza` - Connection timeout
5. **`api.piped.private.coffee` - WORKS!**

The official Piped instances list at `https://piped-instances.kavin.rocks/` shows uptime stats for all instances.

### Step 2: Fix SSL/TLS Compatibility

Added curl options to work around DreamHost's SSL issues:

```php
// Disable SSL verification (necessary for DreamHost compatibility)
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

// Force TLS 1.2 (fixes handshake errors)
curl_setopt($ch, CURLOPT_SSLVERSION, CURL_SSLVERSION_TLSv1_2);
```

### Step 3: Use Browser-like User Agent

Some instances block non-browser requests:

```php
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
```

### Step 4: Update app.js to Use the Proxy

Changed from client-side fetching to server-side proxy:

```javascript
// OLD - client-side with corsproxy
const pipedUrl = `https://pipedapi.kavin.rocks/search?q=${query}&filter=videos`;
const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(pipedUrl)}`);

// NEW - server-side proxy
const proxyUrl = `proxy.php?q=${encodeURIComponent(query)}`;
const response = await fetch(proxyUrl);
```

## Final Architecture

```
Browser (app.js)
    |
    | fetch('proxy.php?q=beatles')
    v
Server (proxy.php on fuseki.net)
    |
    | Direct HTTPS call (no CORS proxy needed!)
    v
api.piped.private.coffee/search?q=beatles&filter=videos
    |
    | JSON response with video results
    v
proxy.php converts to standard format
    |
    | JSON: {results: [{videoId, title, channelTitle, duration}]}
    v
app.js receives results and creates YouTube player
```

## Key Files Changed

### proxy.php

- Removed unnecessary corsproxy.io layer
- Added `api.piped.private.coffee` as primary instance (confirmed working)
- Added SSL workarounds for DreamHost compatibility
- Standardized response format

### app.js

- Changed `searchYouTube()` to call `proxy.php` instead of client-side fetch
- Added proxy health check on startup (`testProxy()`)
- Set `SKIP_CLAUDE = false` to enable real Claude API calls

### config.example.json

- Removed `youtubeApiKey` - no longer needed!

## Testing the Proxy

1. **Test proxy is running:**
   ```
   https://fuseki.net/music8899/proxy.php?test=1
   ```
   Should return: `{"status":"Proxy is working",...}`

2. **Test search works:**
   ```
   https://fuseki.net/music8899/proxy.php?q=beatles
   ```
   Should return JSON with video results

3. **Test in app:**
   - Open https://fuseki.net/music8899/searchqqqqq88.html
   - Check Log panel for "Proxy Test: Server-side proxy is working"
   - Try a voice search

## If It Breaks Again

Piped instances go up and down. If searches stop working:

1. Check the current instance list: https://piped-instances.kavin.rocks/
2. Find instances with high uptime (>90%)
3. Test them directly in browser: `https://[instance]/search?q=test&filter=videos`
4. Update `proxy.php` with working instances

## Why This Approach is Better

| Old Approach | New Approach |
|--------------|--------------|
| Client-side fetch | Server-side proxy |
| Needs CORS proxy | No CORS issues |
| Two unreliable services | One direct call |
| Rate limited by corsproxy | No rate limits |
| YouTube API quota ($$$) | Free forever |
| Exposed to client | Hidden on server |

## Date

Solution implemented: December 13, 2024

