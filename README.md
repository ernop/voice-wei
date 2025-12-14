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

### Step 1: Configure

Copy `config.example.json` to `config.json` and fill in your settings:

```json
{
  "claudeApiKey": "sk-ant-api03-YOUR_KEY_HERE",

  "deploy": {
    "user": "youruser",
    "host": "yourserver.com",
    "remotePath": "/path/to/public/music",
    "publicUrl": "https://yourserver.com/music/player.html"
  }
}
```

### Step 2: Deploy

```bash
./deploy.sh           # Deploy to server
./deploy.sh --dry-run # Preview what would be transferred
```

The script reads your settings from `config.json` and syncs files via rsync.
`proxy.php` is included automatically (it handles YouTube search).

### Step 3: Server Config

Create `config.json` on the server with just the Claude API key:

```json
{
  "claudeApiKey": "sk-ant-api03-YOUR_KEY_HERE"
}
```

Then visit your `publicUrl`.

**Security:** Obscure URL only. API keys visible in browser dev tools to anyone who finds the page.


## Usage

1. Open the page on your phone (or desktop browser)
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
- **AI:** Claude Opus 4.5 or Haiku 4.5 (Anthropic)
- **Music Search:** Server-side proxy (proxy.php) via Piped/Invidious
- **Music Playback:** YouTube IFrame API
- **Text-to-Speech:** Browser native speechSynthesis API

## Browser Support

- ✅ Chrome/Edge - Full support
- ✅ Safari - Full support  
- ❌ Firefox - No Web Speech API support

**HTTPS required** for microphone access in all browsers.

## File Structure

```
voice-music-control/
├── player.html              # Main music player app
├── app.js                   # Main application logic
├── style.css                # Styling
├── proxy.php                # YouTube search proxy (Piped/Invidious)
├── voice-output.js          # Text-to-speech library
├── voice-command-core.js    # Voice recognition utilities
├── config.example.json      # Config template
│
├── scales.html/js/css       # Music scales practice tool
├── pitch-meter.html/js/css  # Pitch detection tool
│
├── index.html               # Blank (prevents indexing)
├── deploy.sh                # Deployment script
├── PRODUCT.md               # Product vision
├── SCALES.md                # Scales feature documentation
└── README.md                # This file
```


## Security

- **API keys** - Keep `config.json` secure, never commit to git
- **HTTPS required** - For microphone access
- **Monitor usage** - Check Anthropic dashboard for unexpected API usage

## Troubleshooting

### "Speech recognition not supported"
- Use Chrome, Edge, or Safari (Firefox doesn't support Web Speech API)

### Microphone access denied
- HTTPS is required for microphone access
- Check browser permissions and clear cache

### No songs in playlist
- Check Claude API key in `config.json`
- Test proxy: `proxy.php?test=1` should show "Proxy is working"
- Test search: `proxy.php?q=test` should return JSON results
- Check browser console (F12) and Log panel for errors


## Development

### Cursor Rules
This project uses Cursor's multi-rule format in `.cursor/rules/`:
- `00-absolute-rules.mdc` - Core rules (communication, anti-fallback, config patterns)
- `01-code-style.mdc` - JavaScript/CSS/PHP conventions
- `02-performance.mdc` - Event handler and DOM performance patterns
- `03-project.mdc` - Project-specific architecture and patterns

## License

Personal use project. API usage subject to Anthropic API terms and pricing.