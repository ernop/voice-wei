#!/bin/bash
# Check file permissions on server

echo "=== Checking File Permissions ==="
echo ""

cd /home/ernop/fuseki.net/public/music

echo "Directory permissions:"
ls -ld .

echo ""
echo "File permissions:"
ls -la

echo ""
echo "=== Fix Permissions ==="
echo "Run these commands to fix:"
echo "chmod 755 /home/ernop/fuseki.net/public/music"
echo "chmod 644 *.html *.css *.js *.json"
echo "chmod 644 .htaccess"
echo "chmod 640 .htpasswd"

