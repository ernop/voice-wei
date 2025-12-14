#!/bin/bash
# Debug script to check .htaccess authentication setup

echo "=== Checking .htaccess Authentication Setup ==="
echo ""

# Check if .htpasswd exists
if [ -f ".htpasswd" ]; then
    echo "✓ .htpasswd file exists"
    ls -la .htpasswd
    echo ""
    
    # Check file contents (first few characters only)
    echo "File contents (first line, masked):"
    head -1 .htpasswd | sed 's/:.*/:***/'
    echo ""
    
    # Check permissions
    PERMS=$(stat -c "%a" .htpasswd 2>/dev/null || stat -f "%OLp" .htpasswd 2>/dev/null)
    echo "Permissions: $PERMS"
    if [ "$PERMS" = "640" ] || [ "$PERMS" = "600" ] || [ "$PERMS" = "644" ]; then
        echo "✓ Permissions look okay"
    else
        echo "⚠ Permissions might need to be 640 or 600"
    fi
else
    echo "✗ .htpasswd file does NOT exist!"
    echo "Create it with: htpasswd -c .htpasswd jfell"
fi

echo ""
echo "=== Checking .htaccess ==="
if [ -f ".htaccess" ]; then
    echo "✓ .htaccess file exists"
    echo ""
    echo "AuthUserFile path:"
    grep "AuthUserFile" .htaccess
    echo ""
    echo "Full .htaccess contents:"
    cat .htaccess
else
    echo "✗ .htaccess file does NOT exist!"
fi

echo ""
echo "=== Testing credentials ==="
if [ -f ".htpasswd" ]; then
    echo "Test if password file works:"
    echo "Run: htpasswd -v .htpasswd jfell"
    echo "Then enter: 6holzorMOOMP"
fi

echo ""
echo "=== Common fixes ==="
echo "1. Make sure .htpasswd path in .htaccess matches actual file location"
echo "2. Check file permissions: chmod 640 .htpasswd"
echo "3. Verify username/password: htpasswd -v .htpasswd jfell"
echo "4. Check Apache error log: tail -f /var/log/apache2/error.log"

