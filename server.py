#!/usr/bin/env python3
"""
Backend proxy server for voice-music-control
Keeps API keys secure on the server side
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
from pathlib import Path

app = Flask(__name__)
CORS(app)

CONFIG_PATH = Path(__file__).parent / "config.json"

def load_config():
    """Load API keys from config.json"""
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config file not found at {CONFIG_PATH}")
    
    with open(CONFIG_PATH) as f:
        return json.load(f)


@app.route('/api/claude', methods=['POST'])
def proxy_claude():
    """Proxy requests to Claude API"""
    try:
        config = load_config()
        api_key = config.get('claudeApiKey')
        
        if not api_key:
            return jsonify({'error': 'Claude API key not configured'}), 500
        
        data = request.get_json()
        transcript = data.get('transcript', '')
        
        import requests
        response = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'Content-Type': 'application/json',
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01'
            },
            json={
                'model': 'claude-3-5-haiku-20241022',
                'max_tokens': 1000,
                'messages': [{
                    'role': 'user',
                    'content': f'''Interpret this music request: "{transcript}"

Return a JSON array of song objects. Each object should have:
- "comment": A brief comment about why this song matches the request
- "searchTerm": The full search term to use (artist name + song title)

Examples:
- "play some jazz" → [{{"comment": "Classic smooth jazz piece", "searchTerm": "Miles Davis Kind of Blue"}}, {{"comment": "Uplifting jazz standard", "searchTerm": "Take Five Dave Brubeck"}}]
- "Hotel California" → [{{"comment": "The classic Eagles rock anthem", "searchTerm": "Hotel California Eagles"}}]

Return ONLY valid JSON array, no other text. If the request is not about music, return [].'''
                }]
            },
            timeout=30
        )
        
        if response.status_code != 200:
            error_data = response.json() if response.content else {}
            return jsonify({'error': error_data.get('error', {}).get('message', 'API request failed')}), response.status_code
        
        result = response.json()
        response_text = result['content'][0]['text'].strip()
        
        # Extract JSON from response (handle markdown code blocks)
        json_text = response_text
        import re
        json_match = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', response_text, re.DOTALL)
        if json_match:
            json_text = json_match.group(1)
        else:
            # Try to find JSON array directly
            array_match = re.search(r'\[.*\]', response_text, re.DOTALL)
            if array_match:
                json_text = array_match.group(0)
        
        song_list = json.loads(json_text)
        
        if not isinstance(song_list, list) or len(song_list) == 0:
            return jsonify({'error': 'No songs found or invalid response'}), 400
        
        return jsonify({'songs': song_list})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
