import type { WorkspaceAppId } from "@/lib/workspace-app-icons";

/**
 * Where the user last was inside each app (path + parsed search), so switching back
 * from the app rail returns to that spot instead of the app's start screen.
 * Per tab (sessionStorage), with an in-memory copy for when storage is blocked.
 */
const STORAGE_KEY = "wgw.app-rail.last-locations";

export type LastAppLocation = { pathname: string; search: Record<string, unknown> };

type LastLocations = Partial<Record<WorkspaceAppId, LastAppLocation>>;

let memory: LastLocations | null = null;

function load(): LastLocations {
  if (memory) return memory;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    memory = raw ? (JSON.parse(raw) as LastLocations) : {};
  } catch {
    memory = {};
  }
  return memory;
}

export function rememberAppLocation(appId: WorkspaceAppId, location: LastAppLocation): void {
  const all = load();
  const known = all[appId];
  if (
    known?.pathname === location.pathname &&
    JSON.stringify(known.search) === JSON.stringify(location.search)
  ) {
    return;
  }
  all[appId] = location;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Private mode or blocked storage: the in-memory copy still serves this page load.
  }
}

/** Forget every remembered spot (sign-out: the next account must not inherit them). */
export function clearLastAppLocations(): void {
  memory = {};
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the in-memory copy is already empty.
  }
}

/** The remembered spot inside `appId`, if it still belongs to that app. */
export function lastAppLocation(appId: WorkspaceAppId): LastAppLocation | null {
  const known = load()[appId];
  if (!known || typeof known.pathname !== "string") return null;
  const root = `/${appId}`;
  if (known.pathname !== root && !known.pathname.startsWith(`${root}/`)) return null;
  // An entry from before the search was stored parsed, or a hand-edited one: no search.
  const search = known.search && typeof known.search === "object" ? known.search : {};
  return { pathname: known.pathname, search };
}
