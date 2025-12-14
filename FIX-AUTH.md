# Fix Repeated Password Prompts

If the username/password prompt keeps appearing, the .htpasswd file likely isn't found or the credentials don't match.

## Quick Fix

SSH to your server and run these commands:

```bash
ssh ernop@fuseki.net
cd /home/ernop/fuseki.net/public/music

# 1. Check if .htpasswd exists
ls -la .htpasswd

# 2. If it doesn't exist, create it
htpasswd -c .htpasswd jfell
# When prompted, enter: 6holzorMOOMP

# 3. Verify the file was created correctly
cat .htpasswd
# Should show: jfell:$apr1$... (a long hash)

# 4. Set correct permissions
chmod 640 .htpasswd

# 5. Verify the path in .htaccess matches
cat .htaccess | grep AuthUserFile
# Should show: AuthUserFile /home/ernop/fuseki.net/public/music/.htpasswd

# 6. Test the password file
htpasswd -v .htpasswd jfell
# Enter: 6holzorMOOMP
# Should say: Password for user jfell correct.

# 7. Check Apache error log for specific errors
tail -n 20 /var/log/apache2/error.log
```

## Common Issues

### Issue 1: .htpasswd file doesn't exist
**Fix:** Create it with `htpasswd -c .htpasswd jfell`

### Issue 2: Wrong path in .htaccess
**Fix:** Make sure `.htaccess` has:
```
AuthUserFile /home/ernop/fuseki.net/public/music/.htpasswd
```

### Issue 3: Wrong username or password
**Fix:** Verify with `htpasswd -v .htpasswd jfell`

### Issue 4: File permissions
**Fix:** Run `chmod 640 .htpasswd`

### Issue 5: Apache can't read the file
**Fix:** Check Apache error log: `tail -f /var/log/apache2/error.log`

## Verify Everything is Correct

After creating the file, verify:
1. File exists: `ls -la .htpasswd`
2. Path is correct in .htaccess: `grep AuthUserFile .htaccess`
3. Password works: `htpasswd -v .htpasswd jfell`
4. Permissions: `ls -la .htpasswd` (should be 640 or 644)

Then try accessing the page again.

