# Voice Music Control

A voice-controlled music player web app designed for hands-free music control while driving. Speak your music requests, and the app intelligently finds multiple matching songs from YouTube, displaying them in a playlist with AI-generated comments.

## What It Does

1. **Speak your request** - "Play some jazz" or "I want Hotel California"
2. **AI interprets** - Claude understands your request and finds multiple matching songs
3. **Playlist created** - Each song comes with a comment explaining why it matches
4. **Browse and play** - All songs displayed in a playlist you can browse and play

## Features

- **Hands-free operation** - Large touch-friendly button optimized for mobile use
- **AI-powered discovery** - Claude (Opus 4.5 or Haiku 4.5) interprets natural language and finds multiple matching songs
- **Smart playlists** - Multiple results with comments explaining each match
- **Voice recognition** - Browser's built-in Web Speech API (no external service needed)
- **YouTube integration** - Searches and plays music from YouTube
- **Favorites** - Star songs to save them locally; load favorites into playlist anytime
- **Secure deployment** - Optional backend proxy keeps API keys secure

## How It Works

1. **Voice Input** → Browser's Web Speech API converts speech to text (local, no external service)
2. **AI Processing** → Claude interprets the request and returns a JSON array:
   ```json
   [
     {
       "comment": "Classic smooth jazz piece",
       "searchTerm": "Miles Davis Kind of Blue"
     },
     {
       "comment": "Uplifting jazz standard",
       "searchTerm": "Take Five Dave Brubeck"
     }
   ]
   ```
3. **YouTube Search** → Each song's searchTerm is used to find the video
4. **Playlist Display** → All results shown with title, artist, and Claude's comment
5. **Play** → Click any song to play it in an embedded YouTube player

## Quick Start

### 1. Get Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an account (may require credit card)
3. Create an API key in the API Keys section

YouTube search uses `proxy.php` which queries Piped/Invidious - no YouTube API key needed.

### 2. Configure

Copy `config.example.json` to `config.json` and add your Claude key:
```json
{
  "claudeApiKey": "sk-ant-your-key-here"
}
```

### 3. Run Locally

Use a local server:
```bash
python -m http.server 8000
# Visit http://localhost:8000/player.html
```

### 4. Test

- Click "Listen"
- Allow microphone access
- Say "play some jazz" or "Hotel California"
- See the playlist appear with multiple songs and comments

## Deployment

### Step 1: Create config.json

Create `config.json` on the server:

```json
{
  "claudeApiKey": "sk-ant-api03-YOUR_KEY_HERE"
}
```

### Step 2: Sync Files to Server

```bash
rsync -avz \
  --exclude='.git' \
  --exclude='.gitignore' \
  --exclude='.cursor' \
  --exclude='config.json' \
  --exclude='server.py' \
  --exclude='*.md' \
  --exclude='*.txt' \
  --exclude='*.conf' \
  --exclude='*.service' \
  --exclude='*.sh' \
  --exclude='*.ps1' \
  ./ \
  ernop@fuseki.net:/home/ernop/fuseki.net/public/music/
```

`proxy.php` must be included - it handles YouTube search.

### Step 3: Done!

Visit `https://fuseki.net/music/player.html`

**Security:** Obscure URL only. API keys visible in browser dev tools to anyone who finds the page.


## Usage

1. Open the page on your phone: `https://fuseki.net/music/player.html`
2. Tap "Listen" button
3. Allow microphone access
4. Speak: "play some jazz", "Hotel California", "something upbeat"
5. Songs appear in playlist with AI comments
6. Tap "Play" or say "play" to start
7. Voice commands: "next", "pause", "shuffle", "help"
8. Star songs to save to Favorites (stored in browser localStorage)

## Technology

- **Frontend:** HTML, CSS, JavaScript
- **Voice Recognition:** Web Speech API (browser native)
- **AI:** Claude Opus 4.5 or Haiku 4.5 (Anthropic) - interprets requests and generates comments
- **Music Search:** Server-side proxy (proxy.php) querying Piped/Invidious
- **Music Playback:** YouTube IFrame API
- **Text-to-Speech:** Browser native speechSynthesis API
- **Authentication:** HTTP Basic Auth (.htaccess) on server

## Browser Support

- ✅ Chrome/Edge - Full support
- ✅ Safari - Full support  
- ❌ Firefox - No Web Speech API support

**HTTPS required** for microphone access in all browsers.

## File Structure

```
voice-music-control/
├── .cursor/rules/           # Cursor AI rules
│
├── player.html              # Main app page
├── index.html               # Blank (prevents direct indexing)
├── style.css                # Styling
├── app.js                   # Main frontend application
├── voice-output.js          # Text-to-speech library
├── voice-command-core.js    # Voice recognition utilities
├── proxy.php                # Server-side YouTube search proxy
├── config.json              # API keys (gitignored)
├── config.example.json      # Example config
│
├── scales.html/css/js       # Music scales practice tool
├── pitch-meter.html/css/js  # Pitch detection tool
│
├── server.py                # Backend proxy server (optional, for Claude API)
├── deploy.sh                # Deployment script
│
├── PRODUCT.md               # Product vision and goals
└── README.md                # This file
```


## Security

- **Password protection** - HTTP Basic Auth via .htaccess
- **API keys** - Keep secure, never commit to git
- **HTTPS required** - For microphone access
- **Monitor usage** - Check API dashboards for unexpected usage

## Troubleshooting

### "Speech recognition not supported"
- Use Chrome, Edge, or Safari
- Firefox doesn't support Web Speech API

### Microphone access denied
- HTTPS is required
- Check browser permissions
- Clear cache and try again

### No songs in playlist
- Check Claude API key in `config.json`
- Test the search proxy: visit `proxy.php?test=1` - should show "Proxy is working"
- Test a search: visit `proxy.php?q=test` - should return JSON with video results
- Check browser console (F12) for errors
- Check the Log panel in the app for detailed error messages

### Can't access the page
- Check Apache error logs: `sudo tail -f /var/log/apache2/error.log`
- Verify .htaccess path to .htpasswd is correct
- Make sure .htpasswd file exists and has correct permissions
- Check that .htaccess file was uploaded correctly


## Development

### Cursor Rules
This project uses Cursor's multi-rule format in `.cursor/rules/`:
- `00-absolute-rules.mdc` - Core rules (communication, anti-fallback, config patterns)
- `01-code-style.mdc` - JavaScript/CSS/PHP conventions
- `02-performance.mdc` - Event handler and DOM performance patterns
- `03-project.mdc` - Project-specific architecture and patterns

## License

Personal use project. API usage subject to Anthropic API terms and pricing.