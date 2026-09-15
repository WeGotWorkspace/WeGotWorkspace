/**
 * Shared Drive / Docs group-drive discovery and display labels.
 * Path keys stay Drive-canonical (`My Drive`, `Groups/{slug}`); only labels change.
 */
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";

const SETTINGS_GROUP_URI_PREFIX = "principals/groups/";

/** Drive UI path key for the viewer's personal drive (not a display label). */
export const DRIVE_UI_PERSONAL_PATH = "My Drive";

/** Discovered group drive root: storage slug + UI label. */
export type DriveGroupRoot = {
  /** Path segment under `/groups/` (storage / API id). */
  slug: string;
  /** Sidebar / picker label — prefer principal display name when known. */
  label: string;
};

/** Slug from a settings/group principal id (`principals/groups/…` or `groups/…`). */
export function driveGroupSlugFromPrincipalId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith(SETTINGS_GROUP_URI_PREFIX)) {
    return trimmed.slice(SETTINGS_GROUP_URI_PREFIX.length);
  }
  if (trimmed.startsWith("groups/")) {
    return trimmed.slice("groups/".length);
  }
  return trimmed;
}

/** True when both lists have the same slug/label pairs in order. */
export function driveGroupRootsEqual(
  a: readonly DriveGroupRoot[],
  b: readonly DriveGroupRoot[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].slug !== b[i].slug || a[i].label !== b[i].label) return false;
  }
  return true;
}

/**
 * Overlay principal display names onto discovered group roots (slug stays the
 * storage id; label becomes e.g. "Administrators" instead of "administrators").
 * Returns `roots` unchanged when no label updates apply (stable reference).
 */
export function applyDriveGroupDisplayNames(
  roots: readonly DriveGroupRoot[],
  groups: readonly { id: string; displayName: string }[],
): DriveGroupRoot[] {
  if (roots.length === 0) return roots as DriveGroupRoot[];
  const bySlug = new Map<string, string>();
  for (const group of groups) {
    const slug = driveGroupSlugFromPrincipalId(group.id);
    const name = group.displayName?.trim();
    if (slug && name) bySlug.set(slug, name);
  }
  let changed = false;
  const next = roots.map((root) => {
    const labeled = bySlug.get(root.slug);
    if (labeled && labeled !== root.label) {
      changed = true;
      return { ...root, label: labeled };
    }
    return root;
  });
  return changed ? next : (roots as DriveGroupRoot[]);
}

function upsertGroupRoot(bySlug: Map<string, string>, slug: string, label: string): void {
  const trimmedSlug = slug.trim();
  if (!trimmedSlug) return;
  const nextLabel = label.trim() || trimmedSlug;
  const prev = bySlug.get(trimmedSlug);
  // Prefer a label that is not just the raw slug when upgrading path-only discoveries.
  if (!prev || (prev === trimmedSlug && nextLabel !== trimmedSlug)) {
    bySlug.set(trimmedSlug, nextLabel);
  }
}

function sortedGroupRoots(bySlug: Map<string, string>): DriveGroupRoot[] {
  return Array.from(bySlug.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, label]) => ({ slug, label }));
}

/** Extract sorted, unique group roots from a `/groups` directory listing. */
export function collectDriveGroupRootsFromDirectory(
  entries: readonly { path: string; type?: string; name?: string }[],
): DriveGroupRoot[] {
  const bySlug = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type && entry.type !== "dir") continue;
    const apiPath = normalizeApiVirtualPath(entry.path);
    if (apiPath === "/groups") {
      const name = entry.name?.trim();
      if (name) upsertGroupRoot(bySlug, name, name);
      continue;
    }
    if (!apiPath.startsWith("/groups/")) continue;
    const [slug] = apiPath.slice("/groups/".length).split("/");
    if (!slug) continue;
    const label = entry.name?.trim() || slug;
    upsertGroupRoot(bySlug, slug, label);
  }
  return sortedGroupRoots(bySlug);
}

/** Load shared-drive roots from the live `/groups` listing. */
export async function fetchDriveGroupRoots(
  operations: Pick<DriveAPIOperations, "listDirectory"> | undefined,
  opts?: { signal?: AbortSignal },
): Promise<DriveGroupRoot[]> {
  if (!operations) return [];
  try {
    const state = await operations.listDirectory("/groups", opts);
    return collectDriveGroupRootsFromDirectory(state.directory.files);
  } catch {
    return [];
  }
}

/** Extract sorted, unique group roots from loaded files' `/groups/{root}/…` api paths. */
export function collectDriveGroupRoots(files: readonly DriveFile[]): DriveGroupRoot[] {
  const bySlug = new Map<string, string>();
  for (const file of files) {
    const apiPath = file.apiPath;
    if (!apiPath || !apiPath.startsWith("/groups/")) continue;
    const [slug] = apiPath.slice("/groups/".length).split("/");
    if (slug) upsertGroupRoot(bySlug, slug, slug);
  }
  return sortedGroupRoots(bySlug);
}

/**
 * Union two group-root lists (keeps the set growing as more pages load).
 * Returns `previous` when the merge is a no-op so React setState can bail out.
 */
export function mergeDriveGroupRoots(
  previous: readonly DriveGroupRoot[],
  next: readonly DriveGroupRoot[],
): DriveGroupRoot[] {
  if (next.length === 0) return previous as DriveGroupRoot[];
  const bySlug = new Map<string, string>();
  for (const root of previous) upsertGroupRoot(bySlug, root.slug, root.label);
  for (const root of next) upsertGroupRoot(bySlug, root.slug, root.label);
  const merged = sortedGroupRoots(bySlug);
  return driveGroupRootsEqual(previous, merged) ? (previous as DriveGroupRoot[]) : merged;
}

/**
 * Resolve a display label for a browse path prefix or Drive UI path.
 * Path keys stay Drive-canonical (`My Drive`, `Groups/{slug}`); only the label changes.
 */
export function resolveDriveRootDisplayLabel(
  pathOrPrefix: string,
  options: {
    personalDriveLabel: string;
    groupRoots?: readonly DriveGroupRoot[];
  },
): string {
  const raw = pathOrPrefix.trim();
  if (!raw || raw === DRIVE_UI_PERSONAL_PATH || raw.startsWith(`${DRIVE_UI_PERSONAL_PATH}/`)) {
    return options.personalDriveLabel;
  }
  if (raw.startsWith("users/")) {
    return options.personalDriveLabel;
  }

  let slug: string | undefined;
  if (raw.startsWith("groups/")) {
    slug = raw.slice("groups/".length).split("/")[0];
  } else if (raw.startsWith("Groups/")) {
    slug = raw.slice("Groups/".length).split("/")[0];
  }
  if (slug) {
    const labeled = options.groupRoots?.find((root) => root.slug === slug)?.label?.trim();
    return labeled || slug;
  }
  return raw;
}

/**
 * Drive UI path → display label map for folder pickers (Move / New document).
 * Keys are Drive path keys (`My Drive`, `Groups/{slug}`); values are SST labels.
 */
export function buildDriveFolderPickerRootLabels(
  groupRoots: readonly DriveGroupRoot[],
  personalDriveLabel: string,
): Record<string, string> {
  const map: Record<string, string> = {
    [DRIVE_UI_PERSONAL_PATH]: personalDriveLabel,
  };
  for (const root of groupRoots) {
    map[`Groups/${root.slug}`] = root.label;
  }
  return map;
}
