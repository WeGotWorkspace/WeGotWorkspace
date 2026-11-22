/**
 * The Project filter (#818): one choice for the whole suite, kept on this browser.
 * `all` shows everything; `p:<id>` narrows each app to that Project's collection;
 * `t:<teamSlug>` narrows to everything of one Team: its default Project and all others.
 * Other tabs follow through the `storage` event; this tab through a custom event.
 */
export type ProjectFilterValue = "all" | "personal" | `p:${string}` | `t:${string}`;

/**
 * `personal` keeps what belongs to no Project: the user's own calendars, lists, notebooks,
 * chats and drive. In a scope list it is the empty project id, which a collection without
 * a Project carries ({@link PERSONAL_PROJECT_ID}).
 */
export const PERSONAL_PROJECT_ID = "";

export const PROJECT_FILTER_STORAGE_KEY = "wgw.ui.projectFilter";
const CHANGE_EVENT = "wgw-project-filter";

export function parseProjectFilter(raw: string | null | undefined): ProjectFilterValue {
  if (raw === "personal") return "personal";
  if (typeof raw === "string" && (raw.startsWith("p:") || raw.startsWith("t:")) && raw.length > 2) {
    return raw as ProjectFilterValue;
  }
  return "all";
}

export function projectFilterValue(projectId: string | null): ProjectFilterValue {
  return projectId ? `p:${projectId}` : "all";
}

export function teamFilterValue(teamSlug: string): ProjectFilterValue {
  return `t:${teamSlug}`;
}

export function isPersonalFilter(value: ProjectFilterValue): boolean {
  return value === "personal";
}

/** True for the scope list `personal` produces: what belongs to no Project. */
export function isPersonalScope(scope: string | readonly string[] | null): boolean {
  return (
    scope !== null && (typeof scope === "string" ? [scope] : scope).includes(PERSONAL_PROJECT_ID)
  );
}

/** The Project id a single-Project filter narrows to; null for "All Projects" and for a Team. */
export function projectIdOfFilter(value: ProjectFilterValue): string | null {
  return value.startsWith("p:") ? value.slice(2) : null;
}

/** The Team slug a Team filter narrows to; null for "All Projects" and for a single Project. */
export function teamSlugOfFilter(value: ProjectFilterValue): string | null {
  return value.startsWith("t:") ? value.slice(2) : null;
}

export function readProjectFilter(): ProjectFilterValue {
  if (typeof localStorage === "undefined") return "all";
  try {
    return parseProjectFilter(localStorage.getItem(PROJECT_FILTER_STORAGE_KEY));
  } catch {
    return "all";
  }
}

export function writeProjectFilter(value: ProjectFilterValue): void {
  if (typeof localStorage !== "undefined") {
    try {
      if (value === "all") localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
      else localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, value);
    } catch {
      // Private mode can reject the write; this tab still follows the event.
    }
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeProjectFilter(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === PROJECT_FILTER_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The stored choice, checked against the Projects the user can see now: a Project that
 * was archived, purged or left (Team removed) falls back to "All Projects".
 * `knownIds` null means the list has not loaded yet; the choice stays until it has. A Team
 * filter holds while the Team still has a Project (`knownTeamSlugs`).
 */
export function effectiveProjectFilter(
  value: ProjectFilterValue,
  knownIds: ReadonlySet<string> | null,
  knownTeamSlugs: ReadonlySet<string> | null = null,
): ProjectFilterValue {
  if (value === "all" || value === "personal" || knownIds === null) return value;
  if (value.startsWith("t:")) {
    return knownTeamSlugs === null || knownTeamSlugs.has(value.slice(2)) ? value : "all";
  }
  return knownIds.has(value.slice(2)) ? value : "all";
}
