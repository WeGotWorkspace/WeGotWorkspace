import {
  readOfflineUsername,
  rememberOfflineUsername,
  resolveOfflineUsername,
} from "@/lib/offline/core/offline-account";

const CALENDARS_DOMAIN = "calendars";
const CONTACTS_DOMAIN = "contacts";
const DOCS_DOMAIN = "docs";
const DRIVE_DOMAIN = "drive";
const NOTES_DOMAIN = "notes";

/** Calendars-domain wrapper over the generic offline account session helpers. */
export function rememberOfflineCalendarsUsername(username: string): void {
  rememberOfflineUsername(CALENDARS_DOMAIN, username);
}

export function readOfflineCalendarsUsername(): string | null {
  return readOfflineUsername(CALENDARS_DOMAIN);
}

/** Session username first, then the last cached calendars account from localStorage. */
export function resolveCalendarsOfflineUsername(
  sessionUsername: string | undefined,
): string | null {
  return resolveOfflineUsername(CALENDARS_DOMAIN, sessionUsername);
}

/** Contacts-domain wrapper over the generic offline account session helpers. */
export function rememberOfflineContactsUsername(username: string): void {
  rememberOfflineUsername(CONTACTS_DOMAIN, username);
}

export function readOfflineContactsUsername(): string | null {
  return readOfflineUsername(CONTACTS_DOMAIN);
}

/** Session username first, then the last cached contacts account from localStorage. */
export function resolveContactsOfflineUsername(sessionUsername: string | undefined): string | null {
  return resolveOfflineUsername(CONTACTS_DOMAIN, sessionUsername);
}

/** Docs-domain wrapper over the generic offline account session helpers. */
export function rememberOfflineDocsUsername(username: string): void {
  rememberOfflineUsername(DOCS_DOMAIN, username);
}

export function readOfflineDocsUsername(): string | null {
  return readOfflineUsername(DOCS_DOMAIN);
}

/** Session username first, then the last cached docs account from localStorage. */
export function resolveDocsOfflineUsername(sessionUsername: string | undefined): string | null {
  return resolveOfflineUsername(DOCS_DOMAIN, sessionUsername);
}

/** Notes-domain wrapper over the generic offline account session helpers. */
export function rememberOfflineNotesUsername(username: string): void {
  rememberOfflineUsername(NOTES_DOMAIN, username);
}

export function readOfflineNotesUsername(): string | null {
  return readOfflineUsername(NOTES_DOMAIN);
}

/** Session username first, then the last cached notes account from localStorage. */
export function resolveNotesOfflineUsername(sessionUsername: string | undefined): string | null {
  return resolveOfflineUsername(NOTES_DOMAIN, sessionUsername);
}

/** Drive-domain wrapper over the generic offline account session helpers. */
export function rememberOfflineDriveUsername(username: string): void {
  rememberOfflineUsername(DRIVE_DOMAIN, username);
}

export function readOfflineDriveUsername(): string | null {
  return readOfflineUsername(DRIVE_DOMAIN);
}

/** Session username first, then the last cached drive account from localStorage. */
export function resolveDriveOfflineUsername(sessionUsername: string | undefined): string | null {
  return resolveOfflineUsername(DRIVE_DOMAIN, sessionUsername);
}

const TASKS_DOMAIN = "tasks";

/** Tasks-domain wrapper over the generic offline account session helpers. */
export function rememberOfflineTasksUsername(username: string): void {
  rememberOfflineUsername(TASKS_DOMAIN, username);
}

export function readOfflineTasksUsername(): string | null {
  return readOfflineUsername(TASKS_DOMAIN);
}

/** Session username first, then the last cached tasks account from localStorage. */
export function resolveTasksOfflineUsername(sessionUsername: string | undefined): string | null {
  return resolveOfflineUsername(TASKS_DOMAIN, sessionUsername);
}
