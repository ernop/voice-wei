#!/usr/bin/env python3
"""
Local dev server for voice-music-control.
Serves static files and proxies YouTube searches to Piped/Invidious.

Usage: python dev-server.py
Then open: http://localhost:8000/player.html
"""

import http.server
import urllib.request
import urllib.parse
import json
import ssl

PORT = 8000

PIPED_INSTANCES = [
    'https://api.piped.private.coffee',
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
]

INVIDIOUS_INSTANCES = [
    'https://invidious.private.coffee',
    'https://inv.nadeko.net',
]


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Handle proxy requests
        if self.path.startswith('/proxy.php'):
            self.handle_proxy()
        else:
            super().do_GET()

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
    print("Press Ctrl+C to stop\n")
    
    with http.server.HTTPServer(('', PORT), DevHandler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
