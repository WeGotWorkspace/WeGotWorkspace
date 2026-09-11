/**
 * Pure helpers backing the Docs home sidebar "My Drives" section and the
 * "Create new document" action.
 *
 * The browse API has no path filter of its own beyond an optional `path_prefix`
 * scope (see `useDocsHomeList`), so the *list* of shared drives shown in the
 * sidebar is derived from whatever results have loaded — mirroring how Drive
 * discovers `knownGroupRoots` from loaded files. Selecting a drive then scopes
 * the browse server-side via its `pathPrefix`, which keeps pagination correct.
 */
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { suggestNewMarkdownFileName } from "@/drive-core/src/drive-file-utils";
import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";

const NEW_DOCUMENT_BASE = "Untitled";
const SETTINGS_GROUP_URI_PREFIX = "principals/groups/";

/**
 * Drive UI path key for the viewer's personal drive.
 * Used by Drive path utils (`apiPathFromUiPath`) — **not** a Docs display label.
 * Display label is {@link docsLabels.homeMyDrive} ("Personal") via
 * {@link resolveDocsDriveLabel} / {@link buildDocsFolderPickerRootLabels}.
 */
export const DOCS_DRIVE_UI_PERSONAL_PATH = "My Drive";

/** A selectable drive in the Docs home sidebar. `pathPrefix` scopes the browse. */
export type DocsHomeDrive = {
  /** Stable selection key; equal to `pathPrefix`. */
  key: string;
  /** Sidebar / header display label (e.g. "Personal" or the group display name). */
  label: string;
  /** Storage-key prefix passed to the browse API (e.g. `users/alice`, `groups/team`). */
  pathPrefix: string;
};

/** Discovered group drive root: storage slug + UI label. */
export type DocsHomeGroupRoot = {
  /** Path segment under `/groups/` (storage / API id). */
  slug: string;
  /** Sidebar label — prefer principal display name when known. */
  label: string;
};

/** Slug from a settings/group principal id (`principals/groups/…` or `groups/…`). */
export function docsHomeGroupSlugFromPrincipalId(id: string): string {
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
export function docsHomeGroupRootsEqual(
  a: readonly DocsHomeGroupRoot[],
  b: readonly DocsHomeGroupRoot[],
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
export function applyDocsHomeGroupDisplayNames(
  roots: readonly DocsHomeGroupRoot[],
  groups: readonly { id: string; displayName: string }[],
): DocsHomeGroupRoot[] {
  if (roots.length === 0) return roots as DocsHomeGroupRoot[];
  const bySlug = new Map<string, string>();
  for (const group of groups) {
    const slug = docsHomeGroupSlugFromPrincipalId(group.id);
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
  return changed ? next : (roots as DocsHomeGroupRoot[]);
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

function sortedGroupRoots(bySlug: Map<string, string>): DocsHomeGroupRoot[] {
  return Array.from(bySlug.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, label]) => ({ slug, label }));
}

/** Extract sorted, unique group roots from a `/groups` directory listing. */
export function collectGroupRootsFromDirectory(
  entries: readonly { path: string; type?: string; name?: string }[],
): DocsHomeGroupRoot[] {
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

/**
 * Load shared-drive roots from the live `/groups` listing (mirrors Drive bootstrap).
 * Falls back to an empty list when operations are unavailable or the request fails.
 */
export async function fetchGroupRootsFromDrive(
  operations: Pick<DriveAPIOperations, "listDirectory"> | undefined,
  opts?: { signal?: AbortSignal },
): Promise<DocsHomeGroupRoot[]> {
  if (!operations) return [];
  try {
    const state = await operations.listDirectory("/groups", opts);
    return collectGroupRootsFromDirectory(state.directory.files);
  } catch {
    return [];
  }
}

/** Extract sorted, unique group roots from loaded files' `/groups/{root}/…` api paths. */
export function collectGroupRoots(files: readonly DriveFile[]): DocsHomeGroupRoot[] {
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
 * Returns `previous` when the merge is a no-op so React setState can bail out
 * and avoid files → merge → labeledRoots → remap-files loops.
 */
export function mergeGroupRoots(
  previous: readonly DocsHomeGroupRoot[],
  next: readonly DocsHomeGroupRoot[],
): DocsHomeGroupRoot[] {
  if (next.length === 0) return previous as DocsHomeGroupRoot[];
  const bySlug = new Map<string, string>();
  for (const root of previous) upsertGroupRoot(bySlug, root.slug, root.label);
  for (const root of next) upsertGroupRoot(bySlug, root.slug, root.label);
  const merged = sortedGroupRoots(bySlug);
  return docsHomeGroupRootsEqual(previous, merged) ? (previous as DocsHomeGroupRoot[]) : merged;
}

/**
 * Resolve a Docs-owned **display** label for a browse path prefix or Drive UI path.
 * Path keys stay Drive-canonical (`My Drive`, `Groups/{slug}`); only the label changes.
 *
 * - `users/…` or `My Drive` → `personalDriveLabel` (typically `docsLabels.homeMyDrive`)
 * - `groups/{slug}` or `Groups/{slug}` → group root label, else slug
 * - unknown → trimmed input (or personal label when empty)
 */
export function resolveDocsDriveLabel(
  pathOrPrefix: string,
  options: {
    personalDriveLabel: string;
    groupRoots?: readonly DocsHomeGroupRoot[];
  },
): string {
  const raw = pathOrPrefix.trim();
  if (
    !raw ||
    raw === DOCS_DRIVE_UI_PERSONAL_PATH ||
    raw.startsWith(`${DOCS_DRIVE_UI_PERSONAL_PATH}/`)
  ) {
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
 * Drive UI path → Docs display label map for folder pickers (Move / New document).
 * Keys are Drive path keys (`My Drive`, `Groups/{slug}`); values are SST labels.
 */
export function buildDocsFolderPickerRootLabels(
  groupRoots: readonly DocsHomeGroupRoot[],
  personalDriveLabel: string,
): Record<string, string> {
  const map: Record<string, string> = {
    [DOCS_DRIVE_UI_PERSONAL_PATH]: personalDriveLabel,
  };
  for (const root of groupRoots) {
    map[`Groups/${root.slug}`] = root.label;
  }
  return map;
}

/**
 * Build the My Drives list: personal drive (when the user is known) followed by
 * each discovered shared (group) drive. Labels come from {@link resolveDocsDriveLabel}.
 */
export function buildDocsHomeDrives(
  username: string,
  groupRoots: readonly DocsHomeGroupRoot[],
  myDriveLabel: string,
): DocsHomeDrive[] {
  const drives: DocsHomeDrive[] = [];
  const handle = username.trim();
  if (handle) {
    const pathPrefix = `users/${handle}`;
    drives.push({
      key: pathPrefix,
      label: resolveDocsDriveLabel(pathPrefix, {
        personalDriveLabel: myDriveLabel,
        groupRoots,
      }),
      pathPrefix,
    });
  }
  for (const root of groupRoots) {
    const pathPrefix = `groups/${root.slug}`;
    drives.push({
      key: pathPrefix,
      label: resolveDocsDriveLabel(pathPrefix, {
        personalDriveLabel: myDriveLabel,
        groupRoots,
      }),
      pathPrefix,
    });
  }
  return drives;
}

export function resolveDocsHomeCreateDialogBrowsePath(selectedDrivePrefix: string | null): string {
  if (selectedDrivePrefix?.startsWith("groups/")) {
    // Only the group root — Docs sidebar scopes by drive, not nested folders.
    const slug = selectedDrivePrefix.slice("groups/".length).split("/").filter(Boolean)[0];
    // Drive UI path root remains "My Drive" / "Groups/…" for apiPathFromUiPath.
    return slug ? `Groups/${slug}` : DOCS_DRIVE_UI_PERSONAL_PATH;
  }
  // users/…, empty, or unknown → personal Drive UI path key (display: Personal).
  return DOCS_DRIVE_UI_PERSONAL_PATH;
}

/**
 * API path for a brand-new Markdown document in the user's My Drive, using a
 * unique `Untitled.md`-style name against the currently loaded files.
 *
 * Note: this only checks the *loaded* results, so it can collide with an
 * existing `Untitled.md` that hasn't been paged in. Prefer
 * {@link resolveNewDocumentName} which checks the live directory listing.
 */
export function newDocumentApiPath(username: string, files: readonly DriveFile[]): string | null {
  const handle = username.trim();
  if (!handle) return null;
  const name = suggestNewMarkdownFileName(files);
  return `/users/${handle}/${name}`;
}

/**
 * First free `Untitled.md` / `Untitled N.md` (then `Untitled 2.md`, `Untitled
 * 3.md`, …) name not present in `existingNames`. Matches the increment used by
 * Drive's {@link suggestNewMarkdownFileName} so the two flows stay consistent.
 */
export function nextUntitledMarkdownName(existingNames: Iterable<string>): string {
  const taken = new Set<string>();
  for (const name of existingNames) {
    if (typeof name === "string" && name.trim()) taken.add(name.trim().toLowerCase());
  }
  let candidate = `${NEW_DOCUMENT_BASE}.md`;
  let index = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${NEW_DOCUMENT_BASE} ${index}.md`;
    index += 1;
  }
  return candidate;
}

/**
 * Timestamp-suffixed name used only when the live directory listing fails — it
 * is effectively guaranteed not to clobber an existing file, so we never
 * overwrite even when we cannot enumerate the directory.
 */
export function fallbackUntitledMarkdownName(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-");
  return `${NEW_DOCUMENT_BASE} ${stamp}.md`;
}

/**
 * Resolve a collision-free file name for a new document in `userRoot`.
 *
 * With live drive operations, lists the actual directory and picks the next
 * free `Untitled` name (never overwriting an existing file); if that listing
 * throws, falls back to a timestamped name. Without operations (mock/Storybook),
 * derives the name from the already-loaded files.
 */
export async function resolveNewDocumentName(
  operations: Pick<DriveAPIOperations, "listDirectory"> | undefined,
  userRoot: string,
  loadedFiles: readonly DriveFile[],
): Promise<string> {
  if (operations) {
    try {
      const state = await operations.listDirectory(userRoot);
      const names = state.directory.files.map((entry) => entry.name);
      return nextUntitledMarkdownName(names);
    } catch {
      return fallbackUntitledMarkdownName();
    }
  }
  return nextUntitledMarkdownName(
    loadedFiles.filter((file) => file.kind !== "folder").map((file) => file.title),
  );
}
