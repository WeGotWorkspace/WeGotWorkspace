/**
 * Pure helpers backing the Docs home sidebar "My Drives" section and the
 * "Create new document" action.
 *
 * Shared group-root discovery / display labels live in
 * {@link drive-group-roots}; Docs re-exports them under Docs names.
 */
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import { suggestNewMarkdownFileName } from "@/drive-core/src/drive-file-utils";
import {
  applyDriveGroupDisplayNames,
  buildDriveFolderPickerRootLabels,
  collectDriveGroupRoots,
  collectDriveGroupRootsFromDirectory,
  DRIVE_UI_PERSONAL_PATH,
  driveGroupRootsEqual,
  driveGroupSlugFromPrincipalId,
  fetchDriveGroupRoots,
  mergeDriveGroupRoots,
  resolveDriveRootDisplayLabel,
  type DriveGroupRoot,
} from "@/drive-core/src/drive-group-roots";

const NEW_DOCUMENT_BASE = "Untitled";

/**
 * Drive UI path key for the viewer's personal drive.
 * Used by Drive path utils (`apiPathFromUiPath`) — **not** a Docs display label.
 * Display label is {@link docsLabels.homeMyDrive} ("Personal") via
 * {@link resolveDocsDriveLabel} / {@link buildDocsFolderPickerRootLabels}.
 */
export const DOCS_DRIVE_UI_PERSONAL_PATH = DRIVE_UI_PERSONAL_PATH;

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
export type DocsHomeGroupRoot = DriveGroupRoot;

/** Slug from a settings/group principal id (`principals/groups/…` or `groups/…`). */
export const docsHomeGroupSlugFromPrincipalId = driveGroupSlugFromPrincipalId;

/** True when both lists have the same slug/label pairs in order. */
export const docsHomeGroupRootsEqual = driveGroupRootsEqual;

/**
 * Overlay principal display names onto discovered group roots (slug stays the
 * storage id; label becomes e.g. "Administrators" instead of "administrators").
 * Returns `roots` unchanged when no label updates apply (stable reference).
 */
export const applyDocsHomeGroupDisplayNames = applyDriveGroupDisplayNames;

/** Extract sorted, unique group roots from a `/groups` directory listing. */
export const collectGroupRootsFromDirectory = collectDriveGroupRootsFromDirectory;

/**
 * Load shared-drive roots from the live `/groups` listing (mirrors Drive bootstrap).
 * Falls back to an empty list when operations are unavailable or the request fails.
 */
export const fetchGroupRootsFromDrive = fetchDriveGroupRoots;

/** Extract sorted, unique group roots from loaded files' `/groups/{root}/…` api paths. */
export const collectGroupRoots = collectDriveGroupRoots;

/**
 * Union two group-root lists (keeps the set growing as more pages load).
 * Returns `previous` when the merge is a no-op so React setState can bail out
 * and avoid files → merge → labeledRoots → remap-files loops.
 */
export const mergeGroupRoots = mergeDriveGroupRoots;

/**
 * Resolve a Docs-owned **display** label for a browse path prefix or Drive UI path.
 * Path keys stay Drive-canonical (`My Drive`, `Groups/{slug}`); only the label changes.
 */
export function resolveDocsDriveLabel(
  pathOrPrefix: string,
  options: {
    personalDriveLabel: string;
    groupRoots?: readonly DocsHomeGroupRoot[];
  },
): string {
  return resolveDriveRootDisplayLabel(pathOrPrefix, options);
}

/**
 * Drive UI path → Docs display label map for folder pickers (Move / New document).
 * Keys are Drive path keys (`My Drive`, `Groups/{slug}`); values are SST labels.
 */
export function buildDocsFolderPickerRootLabels(
  groupRoots: readonly DocsHomeGroupRoot[],
  personalDriveLabel: string,
): Record<string, string> {
  return buildDriveFolderPickerRootLabels(groupRoots, personalDriveLabel);
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
