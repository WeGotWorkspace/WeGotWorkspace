# Install WeGotWorkspace

This is the quickest way to install on a normal Apache/PHP host.

## 1) Upload files

Upload the deploy package contents to your website folder so these files are in place:
- `index.php`
- `bootstrap/` (front controller bootstrap before Laravel loads)
- `.htaccess` (or at least `example.htaccess` — see below)
- `packages/api/` (includes Laravel `vendor/` in production releases)
- `packages/apps/` (includes built web app bundles, for example `packages/apps/drive/dist/`)

Configure runtime bootstrap in **`packages/api/.env`** (`WGW_DATA_DIR`, `WGW_DB_*`). The web installer writes these keys on success. Upgrades from older installs auto-migrate legacy `wgw-config.php` into `.env` (backup kept).

Your site document root must point to this folder.

Upload with **SFTP** (binary-safe). After upload, confirm the installer UI is present:

```bash
head -c 40 packages/apps/install/dist/index.html
# should start with <!doctype html> or <html
```

If that file is missing or empty, re-upload the full deploy ZIP — do not upload a git checkout without built `dist/` folders.

### nginx / Plesk

Apache `.htaccess` rewrite rules are included for typical shared Apache hosts. On **nginx** (common on Plesk), ensure requests are routed to `index.php` (Plesk often sets this automatically when PHP is enabled for the domain). Without that, `/install/` may 404 even when files are on disk. Also set `client_max_body_size 32m;` so uploads are not rejected before PHP (`post_max_size` / `upload_max_filesize` are aligned to 32M; lockstep-tested in `UploadLimitParityTest`). `.user.ini` / `.htaccess` also set `display_errors=0` so PHP's line-0 `post_max_size` warning cannot leak HTML before the JSON 413.

## 2) First request bootstrap

On the first HTTP request, the install bootstrap automatically:

- creates `packages/api/.env` from `.env.example` and generates `APP_KEY` when missing
- creates `.htaccess` from `example.htaccess` when missing (common when SFTP drops dotfiles)

Existing installs are not overwritten: a present `.env` or `.htaccess` is left as-is (including custom `RewriteBase` rules).

Set `APP_ENV=production` and `APP_DEBUG=false` on a live host after install.  
Default drivers use files under `packages/api/storage/` so you do not need `packages/api/database/database.sqlite`.  
In-place updates preserve `.env`, `.htaccess`, session files, and logs, and copy `.env` into the update backup folder as `packages-api.env`.

Manual fallback if something still fails:

```bash
cp packages/api/.env.example packages/api/.env
php artisan key:generate --working-dir packages/api
cp example.htaccess .htaccess
```

## 3) Open the installer

Visit:

- `https://your-domain/install/`

Then follow the wizard:
- Check requirements
- Choose SQLite (quickest) or MySQL
- Create the first account

### Optional: PHP `imap` extension (Mail app)

The requirements check lists **Extension: imap (optional)**. It is not required to install or run WeGotWorkspace — only the Mail app (IMAP mailbox access) needs it, and it is missing on many shared hosts. Without it, mail endpoints answer `503` with `imap_extension_required` and `/api/v1/mail/status` reports `extImap: false` so the web app can explain the limitation; everything else (files, calendars, contacts, tasks, meet, …) works normally. Enable `php-imap` in your hosting control panel (or `apt install php8.3-imap`) to activate Mail.

## 4) Done

After setup, sign in with your new account and connect clients using the same site URL.

If your install is in a subfolder, set `RewriteBase` in `.htaccess` to that subfolder path.

### Apache PWA icons (Debian/Ubuntu)

Debian and Ubuntu Apache enable `Alias /icons/` to Apache’s built-in icon directory (`alias.conf`). That path shadows PWA manifest icons if the app serves them at `/icons/`. WeGotWorkspace publishes PWA icons under **`/pwa-icons/`** instead so offline/PWA works on shared Apache hosts without server config changes.

For local smoke tests with PHP’s built-in server (no Apache rewrites):

```bash
php -S localhost:8080 -t . index.php
```
