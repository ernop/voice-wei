# Fix Internal Server Error After Authentication

If you can log in (username/password works) but get an internal server error, check:

## 1. Check Apache Error Log

SSH to server and check the actual error:
```bash
ssh ernop@fuseki.net
tail -n 50 /var/log/apache2/error.log
# Look for the most recent error messages
```

## 2. Common Causes

### Cause 1: .htaccess Path Issue
The path might be wrong or Apache can't verify it after auth. Try using a relative path:

```bash
cd /home/ernop/fuseki.net/public/music
cat .htaccess
```

If it shows absolute path, try changing to relative:
```
AuthUserFile .htpasswd
```

### Cause 2: Directory Permissions
Apache might not be able to read files in the directory:
```bash
chmod 755 /home/ernop/fuseki.net/public/music
chmod 644 search.html style.css app.js config.json
chmod 644 .htaccess
```

### Cause 3: .htaccess Syntax Error
Check for syntax issues:
```bash
apache2ctl configtest
# Or:
httpd -t
```

### Cause 4: Missing Files
Make sure all files exist:
```bash
ls -la
# Should see: search.html, style.css, app.js, config.json, .htaccess, .htpasswd
```

### Cause 5: Apache AllowOverride
Make sure the parent directory allows .htaccess:
```bash
# Check Apache config for:
# AllowOverride All
```

## Quick Test

Try accessing a file directly:
```bash
# From browser, try:
https://fuseki.net/music/style.css
```

If that works, the issue is with search.html or app.js loading.

