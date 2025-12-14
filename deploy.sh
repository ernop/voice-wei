#!/bin/bash
# Deploy Voice Music Control to fuseki.net
# Usage: ./deploy.sh

USER="ernop"
HOST="fuseki.net"
REMOTE_DIR="home/ernop/fuseki.net/public/music"
LOCAL_DIR="projects/voice-music-control"

echo "Deploying Voice Music Control to $USER@$HOST:$REMOTE_DIR"

rsync -avz --delete \
  --exclude='.git' \
  --exclude='.gitignore' \
  --exclude='config.json' \
  --exclude='server.py' \
  --exclude='voice-music-control.service' \
  --exclude='setup-service.sh' \
  --exclude='requirements.txt' \
  --exclude='*.md' \
  --exclude='*.txt' \
  --exclude='*.conf' \
  --exclude='.htpasswd' \
  --exclude='app-direct.js' \
  --exclude='index.html' \
  "$LOCAL_DIR/" "$USER@$HOST:$REMOTE_DIR/"

echo ""
echo "Files deployed!"
echo ""
echo "Next steps:"
echo "1. Upload config.json separately (not synced for security)"
echo "2. Create .htpasswd on server: htpasswd -c $REMOTE_DIR/.htpasswd yourusername"
echo "3. Make sure search.html exists (it should be synced)"
