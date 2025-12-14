# Apache Internal Server Error Troubleshooting

If you get an "Internal Server Error" after deploying, check these:

## 1. Check Apache Error Log

SSH to your server and check the error log:
```bash
ssh ernop@fuseki.net
tail -n 50 /var/log/apache2/error.log
# Or if using a different location:
tail -n 50 /var/log/httpd/error_log
```

Common errors you might see:
- `.htpasswd: No such file or directory` - File doesn't exist
- `AuthUserFile: file is writable by others` - Wrong permissions
- `AuthType Basic: could not verify user/password pair` - Module not enabled

## 2. Verify .htpasswd File Exists

```bash
cd /home/ernop/fuseki.net/public/music
ls -la .htpasswd
```

If it doesn't exist, create it:
```bash
htpasswd -c .htpasswd jfell
# Enter password: 6holzorMOOMP
```

## 3. Fix File Permissions

The .htpasswd file should NOT be world-readable:
```bash
chmod 640 .htpasswd
chown www-data:www-data .htpasswd
# Or if Apache runs as different user:
chown apache:apache .htpasswd
```

## 4. Verify .htaccess Path

Check that `.htaccess` has the correct path:
```bash
cat .htaccess | grep AuthUserFile
```

Should show:
```
AuthUserFile /home/ernop/fuseki.net/public/music/.htpasswd
```

## 5. Enable Apache Modules

Make sure auth_basic module is enabled:
```bash
sudo a2enmod auth_basic
sudo systemctl restart apache2
```

## 6. Check Apache AllowOverride

The directory needs `AllowOverride All` in Apache config. Check your site's Apache config:
```bash
grep -A 5 "/home/ernop/fuseki.net/public" /etc/apache2/sites-available/*.conf
```

Should have:
```apache
<Directory "/home/ernop/fuseki.net/public">
    AllowOverride All
</Directory>
```

## 7. Test .htaccess Syntax

You can test if Apache can read the .htaccess:
```bash
apache2ctl -t
# Or:
httpd -t
```

## 8. Temporary Disable Auth

To test if .htaccess is the problem, temporarily rename it:
```bash
mv .htaccess .htaccess.bak
```

If the page loads without auth, the issue is with .htaccess. Restore it and check the error log for specific messages.

