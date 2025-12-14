#!/usr/bin/env python3
"""
Local dev server for voice-music-control.
Serves static files, proxies YouTube searches, and auto-reloads on changes.

Usage: python dev-server.py
Then open: http://localhost:8000/player.html
"""

import http.server
import urllib.request
import urllib.parse
import json
import ssl
import os
import threading
import time

PORT = 8000
WATCH_EXTENSIONS = {'.html', '.js', '.css', '.php'}
WATCH_INTERVAL = 0.5  # seconds

PIPED_INSTANCES = [
    'https://api.piped.private.coffee',
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
]

INVIDIOUS_INSTANCES = [
    'https://invidious.private.coffee',
    'https://inv.nadeko.net',
]

# Global state for file watching
file_versions = {}
last_change_time = time.time()


def get_watched_files():
    """Get all watchable files with their modification times."""
    files = {}
    for f in os.listdir('.'):
        if os.path.isfile(f) and os.path.splitext(f)[1] in WATCH_EXTENSIONS:
            try:
                files[f] = os.path.getmtime(f)
            except OSError:
                pass
    return files


def watch_files():
    """Background thread that watches for file changes."""
    global file_versions, last_change_time
    file_versions = get_watched_files()
    
    while True:
        time.sleep(WATCH_INTERVAL)
        current = get_watched_files()
        
        for f, mtime in current.items():
            if f not in file_versions or file_versions[f] != mtime:
                print(f"  [reload] {f} changed")
                last_change_time = time.time()
                file_versions = current
                break


# Injected script for auto-reload
RELOAD_SCRIPT = '''
<script>
(function() {
    let lastCheck = Date.now();
    setInterval(async () => {
        try {
            const resp = await fetch('/__livereload?since=' + lastCheck);
            const data = await resp.json();
            if (data.changed) {
                console.log('[dev] Reloading...');
                location.reload();
            }
            lastCheck = Date.now();
        } catch (e) {}
    }, 500);
})();
</script>
'''


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Handle livereload check
        if self.path.startswith('/__livereload'):
            self.handle_livereload()
        # Handle proxy requests
        elif self.path.startswith('/proxy.php'):
            self.handle_proxy()
        # Serve HTML with reload script injected
        elif self.path.endswith('.html') or self.path == '/':
            self.serve_html_with_reload()
        else:
            super().do_GET()

    def handle_livereload(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        since = float(params.get('since', [0])[0]) / 1000  # JS timestamp to Python
        changed = last_change_time > since
        self.send_json({'changed': changed, 'time': last_change_time})

    def serve_html_with_reload(self):
        # Determine file path
        path = self.path
        if path == '/':
            path = '/index.html'
        filepath = '.' + path
        
        if not os.path.isfile(filepath):
            self.send_error(404)
            return
        
        try:
            with open(filepath, 'rb') as f:
                content = f.read().decode('utf-8')
            
            # Inject reload script before </body>
            if '</body>' in content:
                content = content.replace('</body>', RELOAD_SCRIPT + '</body>')
            else:
                content += RELOAD_SCRIPT
            
            encoded = content.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', len(encoded))
            self.end_headers()
            self.wfile.write(encoded)
        except Exception as e:
            self.send_error(500, str(e))

    def handle_proxy(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        # Test mode
        if 'test' in params:
            self.send_json({'status': 'Proxy is working', 'server': 'Python dev server'})
            return

        query = params.get('q', [''])[0]
        if not query:
            self.send_json({'error': 'No query provided'}, 400)
            return

        # Try Piped instances
        for instance in PIPED_INSTANCES:
            url = f"{instance}/search?q={urllib.parse.quote(query)}&filter=videos"
            result = self.fetch_url(url)
            if result:
                try:
                    data = json.loads(result)
                    items = data.get('items', [])
                    if items:
                        videos = []
                        for item in items[:10]:
                            if item.get('type') == 'stream':
                                vid = item.get('url', '').replace('/watch?v=', '')
                                videos.append({
                                    'videoId': vid,
                                    'title': item.get('title', ''),
                                    'channelTitle': item.get('uploaderName', ''),
                                    'thumbnail': item.get('thumbnail', ''),
                                })
                        if videos:
                            self.send_json({'videos': videos, 'source': 'piped', 'instance': instance})
                            return
                except json.JSONDecodeError:
                    continue

        # Try Invidious instances
        for instance in INVIDIOUS_INSTANCES:
            url = f"{instance}/api/v1/search?q={urllib.parse.quote(query)}&type=video"
            result = self.fetch_url(url)
            if result:
                try:
                    data = json.loads(result)
                    if isinstance(data, list) and data:
                        videos = []
                        for item in data[:10]:
                            if item.get('type') == 'video':
                                videos.append({
                                    'videoId': item.get('videoId', ''),
                                    'title': item.get('title', ''),
                                    'channelTitle': item.get('author', ''),
                                    'thumbnail': item.get('videoThumbnails', [{}])[0].get('url', ''),
                                })
                        if videos:
                            self.send_json({'videos': videos, 'source': 'invidious', 'instance': instance})
                            return
                except json.JSONDecodeError:
                    continue

        self.send_json({'error': 'All instances failed'}, 502)

    def fetch_url(self, url):
        try:
            ctx = ssl.create_default_context()
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                return resp.read().decode('utf-8')
        except Exception as e:
            print(f"  Failed: {url} - {e}")
            return None

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def log_message(self, format, *args):
        # Cleaner logging
        print(f"[{self.log_date_time_string()}] {args[0]}")


if __name__ == '__main__':
    print(f"Starting dev server at http://localhost:{PORT}")
    print(f"Open: http://localhost:{PORT}/player.html")
    print(f"Watching: {', '.join(sorted(WATCH_EXTENSIONS))}")
    print("Press Ctrl+C to stop\n")
    
    # Start file watcher in background
    watcher = threading.Thread(target=watch_files, daemon=True)
    watcher.start()
    
    with http.server.HTTPServer(('', PORT), DevHandler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
