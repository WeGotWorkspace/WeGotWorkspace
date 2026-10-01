const NOTE_TAG_PATTERN = /^[a-z-]+$/;

/** Trim and lowercase. Comparing and removing use this; it does not reject characters. */
export function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

/** A tag being added may only be letters a-z and hyphen. */
export function isValidNewTag(value: string): boolean {
  const normalized = normalizeTag(value);
  return normalized !== "" && NOTE_TAG_PATTERN.test(normalized);
}

/**
 * Toggle result. Null when a new tag is rejected.
 * Removal matches the raw trimmed label, or the same tag ignoring case.
 */
export function noteTagsAfterToggle(tags: readonly string[], rawTag: string): string[] | null {
  const trimmed = rawTag.trim();
  if (!trimmed) return null;
  const normalized = normalizeTag(trimmed);
  const existing = tags.find(
    (current) => current === trimmed || normalizeTag(current) === normalized,
  );
  if (existing !== undefined) {
    return tags.filter((current) => current !== existing);
  }
  if (!isValidNewTag(trimmed)) return null;
  return [...tags, normalized];
}

/** Toggle plus the label used in toasts. Null when a new tag is rejected. */
export function noteTagToggle(
  tags: readonly string[],
  rawTag: string,
): { tags: string[]; added: boolean; label: string } | null {
  const nextTags = noteTagsAfterToggle(tags, rawTag);
  if (!nextTags) return null;
  const added = nextTags.length > tags.length;
  const label = added ? (nextTags[nextTags.length - 1] ?? rawTag.trim()) : rawTag.trim();
  return { tags: nextTags, added, label };
}
