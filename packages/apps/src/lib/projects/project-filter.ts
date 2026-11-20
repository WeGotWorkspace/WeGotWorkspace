/**
 * The Project filter (#818): one choice for the whole suite, kept on this browser.
 * `all` shows everything; `p:<id>` narrows each app to that Project's collection.
 * Other tabs follow through the `storage` event; this tab through a custom event.
 */
export type ProjectFilterValue = "all" | `p:${string}`;

export const PROJECT_FILTER_STORAGE_KEY = "wgw.ui.projectFilter";
const CHANGE_EVENT = "wgw-project-filter";

export function parseProjectFilter(raw: string | null | undefined): ProjectFilterValue {
  if (typeof raw === "string" && raw.startsWith("p:") && raw.length > 2) {
    return raw as ProjectFilterValue;
  }
  return "all";
}

export function projectFilterValue(projectId: string | null): ProjectFilterValue {
  return projectId ? `p:${projectId}` : "all";
}

/** The Project id the filter narrows to, or null for "All Projects". */
export function projectIdOfFilter(value: ProjectFilterValue): string | null {
  return value === "all" ? null : value.slice(2);
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
 * `knownIds` null means the list has not loaded yet; the choice stays until it has.
 */
export function effectiveProjectFilter(
  value: ProjectFilterValue,
  knownIds: ReadonlySet<string> | null,
): ProjectFilterValue {
  if (value === "all" || knownIds === null) return value;
  return knownIds.has(value.slice(2)) ? value : "all";
}
