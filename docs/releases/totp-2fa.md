# Two-factor authentication release note

An installed PWA keeps its previous service worker until every tab for that site is closed. Production workers do not call `skipWaiting`.

Until those tabs close, an old client treats `POST /api/v1/auth/token` responses that do not include tokens as a generic sign-in error. That happens when the server returns `mfa_required` or `mfa_setup_required` (HTTP 200 without `access_token`). Closing the site's tabs loads the client that can show the authenticator step and the setup screen.

Do not flip `skipWaiting` to force that update.
