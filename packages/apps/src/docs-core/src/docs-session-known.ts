/**
 * Whether the signed-in account is known yet. The workspace paints while the
 * bootstrap still loads, with a placeholder session that has no user. A Doc
 * opened then would join its room under a fallback name and join again a
 * moment later under the real one, which replaces the editor under the
 * person's hands: keys typed in that moment are dropped (#2056).
 */
export function docsSessionKnown(
  phase: "loading" | "ready" | "error",
  username: string | null | undefined,
): boolean {
  return phase === "ready" || Boolean(username?.trim());
}
