#!/bin/bash
# Setup script for Voice Music Control backend service

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="$SCRIPT_DIR/voice-music-control.service"
SYSTEMD_DIR="/etc/systemd/system"

echo "Setting up Voice Music Control backend service..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Update service file with actual paths
sed -i "s|/path/to/projects/voice-music-control|$SCRIPT_DIR|g" "$SERVICE_FILE"

# Copy service file to systemd
cp "$SERVICE_FILE" "$SYSTEMD_DIR/voice-music-control.service"

# Reload systemd
systemctl daemon-reload

# Enable service to start on boot
systemctl enable voice-music-control.service

# Start the service
systemctl start voice-music-control.service

echo ""
echo "Service installed and started!"
echo ""
echo "Useful commands:"
echo "  Check status:   sudo systemctl status voice-music-control"
echo "  View logs:      sudo journalctl -u voice-music-control -f"
echo "  Restart:        sudo systemctl restart voice-music-control"
echo "  Stop:           sudo systemctl stop voice-music-control"
echo ""
