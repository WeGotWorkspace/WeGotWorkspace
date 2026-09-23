Source: #805 (body-hash: a1c1730b)
Goal: #804

# Installer first-run flow

Technical translation of Epic #805. Product context: Goal #804 (set up a workspace in a few screens). Storybook first-run screens are the visual contract; this spec is the live `/install` swap.

## Goal

Mount live `/install` on the signed-off first-run chrome (Custom / header-first, login-like) instead of the eight-step Split wizard. Keep existing installer API actions (`welcome`, `requirements`, `database`, `site`, `install`). Auto-submit site with all DAV on; skip the Database screen when `WGW_INSTALL_*` already supplies a database; default the Database UI to MySQL / MariaDB.

## Non-goals

- Headless `WGW_INSTALL_HEADLESS` key changes
- Email-as-login or email-as-username
- Admin Mail / Meet / Email delivery redesign
- Installer email-delivery form
- Per-user SMTP

## Affected packages

- `packages/apps` — first-run workspace, controller, `/install` route, Storybook remains the contract
- `packages/api` — expose `db_from_env` on installer runtime state; optional checks stay non-blocking
- `docs` / `INSTALL.md` / `packages/apps/docs/workspace-shells.md` — installer is Custom/first-run

## Technical constraints

- Do not invent a new installer protocol. Reuse `welcomeNext`, `requirementsCheck` / `requirementsNext`, `databaseTest` / `databaseNext`, `siteNext`, `install`.
- Account payload requires a valid admin email; `display_name` still falls back to username; username is still not email.
- Install payload: `mail_enabled: false`; `meet_enabled: true` with `DEFAULT_PUBLIC_STUN_URLS_CSV`; empty TURN.
- Site payload: `enable_files`, `enable_calendars`, `enable_contacts` all true.
- Server interrupt renders only `status === "error"` rows. API `optional: true` checks (IMAP) map to `warn` and are not shown.
- First-run chrome: `AuthenticationPage` with step dots above the headline. No logo, no copyright footer.
- Navigation stays in `InstallerApp` (`onOpenWorkspace`). Workspace must not `window.location.assign`.

## Edge cases

- Env already has `WGW_INSTALL_DB_DRIVER` → skip Database UI; still persist database via `databaseNext` before install.
- Required check failure after Get started → interrupt; Re-run checks; do not continue.
- Mid-wizard backend step (`database` / `account` / `done`) maps onto first-run screens.
- Username invalid or taken stays on Account with the existing copy.
- Already installed → Ready (Open workspace only), not the old Done-to-admin pane.
- Open workspace after a successful install in this session signs in with that account and opens `/`. A later visit (credentials no longer in memory) still sends Open workspace to login.
