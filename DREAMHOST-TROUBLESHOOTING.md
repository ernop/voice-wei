# DreamHost VPS Troubleshooting

## Access Error Logs

On DreamHost VPS, error logs are usually in your home directory:

```bash
ssh ernop@fuseki.net

# The actual error log files are in these locations:
tail -n 50 ~/logs/fuseki.net/http/error.log
# Or:
tail -n 50 ~/logs/fuseki.net/error.log
# Or check the actual log file directory:
ls -la ~/logs/fuseki.net/http/
cat ~/logs/fuseki.net/http/error.log | tail -n 50

# For access logs:
tail -n 50 ~/logs/fuseki.net/http/access.log

# Find all actual .log files (not HTML):
find ~/logs -name "*.log" -type f 2>/dev/null

# Most recent errors:
grep -i error ~/logs/fuseki.net/http/error.log | tail -n 20
grep -i "500\|internal" ~/logs/fuseki.net/http/error.log | tail -n 20
```

## Reading HTML Log Reports

If you want to view the HTML reports:
```bash
# View in browser after downloading, or:
cat ~/logs/fuseki.net/http/html/main.html
```

But for debugging, you need the actual text log files.

## Common DreamHost Issues

### 1. File Permissions

DreamHost VPS files should be readable by the web server:
```bash
cd /home/ernop/fuseki.net/public/music
chmod 644 *.html *.css *.js *.json
chmod 644 .htaccess
chmod 640 .htpasswd
chmod 755 /home/ernop/fuseki.net/public/music
```

### 2. .htaccess Configuration

DreamHost allows .htaccess but might need specific syntax. Try this minimal version:

```
AuthType Basic
AuthName "Voice Music Control"
AuthUserFile /home/ernop/fuseki.net/public/music/.htpasswd
Require valid-user
```

### 3. PHP Error Display (if available)

If PHP is enabled, add to .htaccess:
```
php_flag display_errors on
php_value error_reporting E_ALL
```

### 4. Check if Files Were Synced

```bash
cd /home/ernop/fuseki.net/public/music
ls -la
# Should see: search.html, style.css, app.js, config.json, .htaccess, .htpasswd
```

### 5. Test Direct File Access

Try accessing these directly in browser (will prompt for password):
- https://fuseki.net/music/style.css
- https://fuseki.net/music/app.js
- https://fuseki.net/music/config.json

If these work but search.html doesn't, the issue is with search.html.

### 6. Check File Content

Verify files aren't corrupted or empty:
```bash
wc -l search.html style.css app.js
head -5 search.html
tail -5 search.html
```

### 7. DreamHost Panel

Check the DreamHost panel:
- Go to: https://panel.dreamhost.com
- Navigate to: Domains → Manage Domains
- Check fuseki.net settings
- Look for any error messages or warnings

## Most Likely Fix

1. **Check the actual error log:**
   ```bash
   tail -n 100 ~/logs/fuseki.net/http/error.log
   # Look for lines mentioning "/music" or "500"
   ```

2. **Fix permissions:**
   ```bash
   cd /home/ernop/fuseki.net/public/music
   chmod 644 search.html style.css app.js config.json .htaccess
   chmod 640 .htpasswd
   ```

3. **Verify .htpasswd exists:**
   ```bash
   ls -la .htpasswd
   htpasswd -v .htpasswd jfell
   ```

## If Still Not Working

1. Try accessing a simple test.html file
2. Check DreamHost panel for domain configuration issues
3. Contact DreamHost support with the error log output
