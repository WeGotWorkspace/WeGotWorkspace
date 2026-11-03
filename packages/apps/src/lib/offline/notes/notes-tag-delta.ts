/** Tag adds and removes a metadata write carries instead of a full tag list. */
export type NoteTagDelta = {
  tagsAdd?: string[];
  tagsRemove?: string[];
};

function normalizedTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags ?? []) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function hasTagDelta(metadata: NoteTagDelta): boolean {
  return (metadata.tagsAdd?.length ?? 0) > 0 || (metadata.tagsRemove?.length ?? 0) > 0;
}

/**
 * Later operation wins for one tag. Adding or removing the same tag twice
 * matches doing it once. An add followed by a remove of that tag ends removed.
 */
export function mergeNoteTagDeltas(existing: NoteTagDelta, incoming: NoteTagDelta): NoteTagDelta {
  let tagsAdd = normalizedTags(existing.tagsAdd);
  let tagsRemove = normalizedTags(existing.tagsRemove);
  const without = (tags: string[], tag: string) => tags.filter((item) => item !== tag);
  for (const tag of normalizedTags(incoming.tagsRemove)) {
    tagsAdd = without(tagsAdd, tag);
    if (!tagsRemove.includes(tag)) tagsRemove = [...tagsRemove, tag];
  }
  for (const tag of normalizedTags(incoming.tagsAdd)) {
    tagsRemove = without(tagsRemove, tag);
    if (!tagsAdd.includes(tag)) tagsAdd = [...tagsAdd, tag];
  }
  return {
    ...(tagsAdd.length > 0 ? { tagsAdd } : {}),
    ...(tagsRemove.length > 0 ? { tagsRemove } : {}),
  };
}
