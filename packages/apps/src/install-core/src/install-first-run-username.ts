/** Principal slug: `^[a-z0-9][a-z0-9_-]{1,62}$` (2–63 chars). */
const INSTALL_USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/;

/** Matches the previous Split wizard: something@something.something. */
const INSTALL_EMAIL_PATTERN = /.+@.+\..+/;

export function isInstallUsernameValid(username: string): boolean {
  return INSTALL_USERNAME_PATTERN.test(username);
}

export function isInstallEmailValid(email: string): boolean {
  return INSTALL_EMAIL_PATTERN.test(email.trim());
}
