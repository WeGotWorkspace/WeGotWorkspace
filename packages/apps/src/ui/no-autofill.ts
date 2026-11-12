/**
 * Spread on a field that names a thing, not a person (a calendar, a list, a tag, a
 * file): a "Name" field otherwise makes the browser and password managers offer the
 * user's own name. Fields for a person's name (a display name) keep autofill.
 */
export const NO_AUTOFILL = {
  autoComplete: "off",
  // Password managers that ignore `autocomplete="off"`: 1Password, LastPass,
  // Bitwarden, Dashlane.
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;
