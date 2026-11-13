/**
 * The app is turned off in this account's settings (`/settings/state`
 * `apps.<app> === false`), so its bootstrap stops before loading data. The
 * message is the marker the Contacts and Tasks app shells check for
 * (`CONTACTS_SETTINGS_MISSING`, `TASKS_SETTINGS_MISSING`), so it stays as is.
 *
 * Sets no `name`, so `String(error)` stays the same as when this was a bare
 * `Error`.
 */
export class WgwAppDisabledError extends Error {}
