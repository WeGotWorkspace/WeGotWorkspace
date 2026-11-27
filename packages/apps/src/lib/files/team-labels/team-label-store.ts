import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";

/** One team's display name, as `/settings/state` lists it under `groups`. */
export type TeamDisplayName = { id: string; displayName: string };

/** Meta-store key for the cached team display names (#2063). */
export const TEAM_DISPLAY_NAMES_META_KEY = "files:team-display-names";

/** Keeps the entries with a non-empty id and display name; drops anything else. */
export function sanitizeTeamDisplayNames(value: unknown): TeamDisplayName[] {
  if (!Array.isArray(value)) return [];
  const out: TeamDisplayName[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { id, displayName } = item as Partial<TeamDisplayName>;
    if (typeof id !== "string" || typeof displayName !== "string") continue;
    if (!id.trim() || !displayName.trim()) continue;
    out.push({ id, displayName });
  }
  return out;
}

/** The team display names this device saw last, so team drives keep their name offline. */
export async function readCachedTeamDisplayNames(username: string): Promise<TeamDisplayName[]> {
  try {
    const raw = await readMeta(username, TEAM_DISPLAY_NAMES_META_KEY);
    return raw ? sanitizeTeamDisplayNames(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Stores the latest team display names. A failed write only costs the offline label. */
export async function writeCachedTeamDisplayNames(
  username: string,
  names: readonly TeamDisplayName[],
): Promise<void> {
  try {
    await writeMeta(username, TEAM_DISPLAY_NAMES_META_KEY, JSON.stringify(names));
  } catch {
    // Labels fall back to the slug offline.
  }
}
