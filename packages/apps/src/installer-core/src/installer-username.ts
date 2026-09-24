/** Principal slug: `^[a-z0-9][a-z0-9_-]{1,62}$` (2–63 chars). */
const INSTALL_USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/;

/**
 * Same rule as PHP `InstallerAdminEmail`: a normal address with a dotted
 * domain whose last label starts with a letter, at most 320 octets.
 */
const INSTALL_EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/i;
const INSTALL_EMAIL_MAX_OCTETS = 320;

export function isInstallerUsernameValid(username: string): boolean {
  return INSTALL_USERNAME_PATTERN.test(username);
}

export function isInstallerEmailValid(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed === "" || new TextEncoder().encode(trimmed).length > INSTALL_EMAIL_MAX_OCTETS) {
    return false;
  }
  return INSTALL_EMAIL_PATTERN.test(trimmed);
}
