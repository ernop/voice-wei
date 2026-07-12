#!/usr/bin/env python3
"""
Local dev server for voice-music-control.
Serves static files and auto-reloads on changes.

Usage: python dev-server.py
Then open: http://localhost:8000/player.html
"""

import http.server
import urllib.parse
import json
import os
import threading
import time

PORT = 8000
WATCH_EXTENSIONS = {'.html', '.js', '.css', '.php'}
WATCH_INTERVAL = 0.5  # seconds

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
