/** Unique authors in a thread root + its replies (one-level). */
export function meetThreadPeopleCount(
  parent: { authorId: string } | null | undefined,
  replies: readonly { authorId: string }[] = [],
): number {
  if (!parent) return 0;
  const ids = new Set<string>([parent.authorId]);
  for (const reply of replies) {
    ids.add(reply.authorId);
  }
  return ids.size;
}
