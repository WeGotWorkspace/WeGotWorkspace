# Install WeGotWorkspace

This is the quickest way to install on a normal Apache/PHP host.

**Requirement: https.** Serve the site over `https://`. On a plain `http://` address the browser turns off live editing of documents together, push notifications, offline use, and large uploads. Most hosts offer a free certificate (for example from Let's Encrypt) with one switch in the control panel. The installer warns you when it is opened over `http://`. Details: [docs/getting-started.md § Requirement: https](docs/getting-started.md#requirement-https).

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

Nginx does not read `.htaccess`. Deny the private trees, the same sensitive dotfiles, and legacy `wgw-config.php` backups. Leave other `/.` segments alone so WebDAV can serve `.attachments`, `.notes`, `.Trash`, and AppleDouble files:

```nginx
location ~ ^/(wgw-content|wgw-plugins|packages)(/|$) { deny all; }
location ~ ^/\.(?:git|svn|hg|env|htaccess|htpasswd|user\.ini)(?:[/.]|$) { deny all; }
location ~ ^/wgw-config\.php\.bak(?:\.|$) { deny all; }
```

## 2) First request bootstrap

On the first HTTP request, the install bootstrap automatically:

- creates `packages/api/.env` from `.env.example` and generates `APP_KEY` when missing
- creates `.htaccess` from `example.htaccess` when missing (common when SFTP drops dotfiles)

`APP_URL` is not taken from the request `Host` header. The installer sends the address the admin's browser has open (`app_url`: the browser origin plus the install base path, such as `https://example.org/office`) with the install request, and the server writes only that. On an existing install where `APP_URL` is unset, Administration shows "APP_URL is not set…"; when it is a loopback address such as `http://localhost:8080`, it shows "APP_URL is a local address…". Opened on the public address, Administration offers a **Use this address** button that saves that address, including the install base path, to `packages/api/.env`. When the server does not write that file (it is missing, marked read-only, in a read-only folder, or the config is cached), the button shows the reason and the exact `APP_URL=` line to add by hand. Opened on a local address, it shows an info note instead, because a loopback `APP_URL` is ignored: set `APP_URL` in `packages/api/.env` (Docker: `api.env` on the config volume), or open Administration on the public address. Password-reset mail stays off until `APP_URL` is public, because reset links must point at the site's real address.

`WGW_TRUSTED_HOSTS` is a comma-separated list of extra hosts trusted in addition to the `APP_URL` host: a LAN IP, both www and apex, or a reverse proxy that rewrites the `Host` header or sends `X-Original-Host`. MCP metadata uses that name only when it is the `APP_URL` host or listed here. A different name falls back to the request `Host` until it is added.

Existing installs are not overwritten: a present `.env` or `.htaccess` is left as-is (including custom `RewriteBase` rules).

The shipped `.env.example` already sets `APP_ENV=production` and `APP_DEBUG=false`. Existing ZIP and Docker installs are rewritten to those values on the next schema migration.  
Default drivers use files under `packages/api/storage/` so you do not need `packages/api/database/database.sqlite`.  
In-place updates preserve `.env`, `.htaccess`, session files, and logs, and copy `.env` into the update backup folder as `packages-api.env`.

Manual fallback if something still fails:

```bash
cp packages/api/.env.example packages/api/.env
php artisan key:generate --working-dir packages/api
cp example.htaccess .htaccess
```

## 3) Open the installer

Run the installer right after uploading.

Visit:

- `https://your-domain/install/`

Opened over `http://`, the installer first shows a **Not secure** page that lists what will not work and asks you to confirm before setup goes on. Turn on a certificate and open the `https://` address instead, or choose **Continue without https** for a first look.

Then follow first-run setup:
- Welcome
- Database (MySQL / MariaDB by default, or SQLite). Skipped when `WGW_INSTALL_*` already has a database
- First account (username and password)

Required server failures interrupt setup. The Mail client is not in the v0.9 suite — see [packages/api/docs/mail/README.md](packages/api/docs/mail/README.md).

## 4) Done

After setup, sign in with your new account and connect clients using the same site URL.

If your install is in a subfolder, set `RewriteBase` in `.htaccess` to that subfolder path.

### Calendar and contacts client discovery

CalDAV and CardDAV clients discover this server with `GET /.well-known/caldav` and `GET /.well-known/carddav` (RFC 6764). Both redirect to the DAV root. Check a running install with `php artisan wgw:check-dav-discovery --working-dir packages/api`.

For automatic client discovery, install WeGotWorkspace on its own (sub)domain. In a subdirectory installation, users must enter the full DAV URL manually when setting up a calendar or contacts client.

### Cron (reminders and Web Push)

Due Calendar/Task reminders and Web Push fallback need Laravel’s scheduler **every minute**. Add a host crontab entry (adjust the path to this install):

```cron
* * * * * php /path/to/packages/api/artisan schedule:run >> /dev/null 2>&1
```

Do **not** run `queue:work` as a long-lived daemon. `QUEUE_CONNECTION=sync` is the supported LAMP layout.

VAPID keys are created on first use into `wgw-content/keys/` (`php artisan wgw:vapid-keys --working-dir packages/api`), or set `WGW_VAPID_PUBLIC_KEY` / `WGW_VAPID_PRIVATE_KEY` / `WGW_VAPID_SUBJECT` in `packages/api/.env`.

The Docker install stack includes a `scheduler` sidecar that loops `schedule:run` every 60 seconds (same contract as cron, not a queue worker). See [docs/architecture/suite-notify.md](docs/architecture/suite-notify.md).

### MCP / OAuth discovery (origin root)

Assistants discover this instance at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` on the **same origin** users open in the browser. The ZIP layout already rewrites those paths to Laravel via `index.php`. If you only expose Laravel under `Alias /api` (or another prefix) and the document root is not this install shell, add rewrite or alias rules so those two `.well-known` paths (and `/.well-known/oauth-protected-resource/<path>`) still reach Laravel. Do not tell clients to use `/api/.well-known/…`. Details: [docs/mcp-connect.md](docs/mcp-connect.md).

### Apache PWA icons (Debian/Ubuntu)

Debian and Ubuntu Apache enable `Alias /icons/` to Apache’s built-in icon directory (`alias.conf`). That path shadows PWA manifest icons if the app serves them at `/icons/`. WeGotWorkspace publishes PWA icons under **`/pwa-icons/`** instead so offline/PWA works on shared Apache hosts without server config changes.

For local smoke tests with PHP’s built-in server (no Apache rewrites):

```bash
php -S localhost:8080 -t . index.php
```

### TURN relay credentials

`WGW_RTC_TURN_TTL_SECONDS` in `packages/api/.env` is how long a minted TURN credential stays valid. The default is 3600 seconds. Values below 300 are raised to 300, and values above 86400 are lowered to 86400. An empty or non-numeric value uses the default.

`WGW_RTC_RELAY_REQUESTS_PER_MINUTE` caps relay credential requests for one signed-in actor. The default is 6.

## Update channels

**Admin → Updates** checks one release feed. Pick the channel there:

- **Stable** (default): every `vX.Y.Z` release.
- **Beta**: prereleases (`-beta.N`, `-rc.N`) and stable releases, whichever is newer.
- **Edge**: a build of every merge to `main`. For testing only, not for data you need.

The choice is saved in the database, so `packages/api/.env` does not need to be writable. Until you pick one, `WGW_UPDATE_CHANNEL` in `packages/api/.env` applies (default `stable`). Updates never downgrade: schema migrations only go forward, so after a switch to an older channel the install stays on its version until that channel catches up. A `WGW_UPDATE_FEED_URL` other than the stable default overrides the channel.

## Move an existing data directory out of the web root

A fresh install puts the database, signing keys, and backups in a `wgw-content` directory next to the published folder when that parent is writable. Installs created before that change keep their data inside the published folder. Nothing moves them automatically. Administration shows a standing warning until you move the directory yourself.

Do these steps in this order:

1. Turn on maintenance mode. SQLite must not be moved while a connection is open.
2. Create the target directory outside the published folder and confirm the web-server user can write to it. Two installs that share a parent must not share one `wgw-content` directory; pick a separate target for the second install.
3. Copy the directory. Do not move it yet. Check that the copy is complete. A rename is atomic only on the same filesystem. Across filesystems the copy needs room for both copies at once.
4. Update **both** of these keys in `packages/api/.env`:
   - `WGW_DATA_DIR` — the new directory.
   - `WGW_DB_DATABASE` — for SQLite installs. This path is resolved from the install root, not from `WGW_DATA_DIR`. Changing only `WGW_DATA_DIR` leaves the app pointed at the old database file.
5. Boot the site, confirm you can sign in and open a file, and only then delete the old directory.

### Docker

New Docker installs mount content at `/var/wgw/content` (`WGW_DATA_DIR`) and Laravel storage at `/var/wgw/storage` (`WGW_STORAGE_PATH`). An existing stack keeps its current mounts until you change the compose file. Use the same five steps: maintenance mode, a writable target, copy and verify, then set both `WGW_DATA_DIR` and `WGW_DB_DATABASE` (and point the storage volume at `/var/wgw/storage`) before deleting the old directory. Do not expect the new image to move the volumes for you.
