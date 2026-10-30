/**
 * Collection-level write gates for notebooks — same shape as
 * `calendar-collection-write` / Tasks `canChangeTaskListOwner`.
 *
 * API source of truth: `isDefault`, `role`, `myRights.mayDelete`, and the
 * provisioned group id `group-{slug}` (Administrators, etc.).
 */

export type NotebookWriteInfo = {
  id?: string;
  isDefault?: boolean;
  isSharee?: boolean;
  role?: string | null;
  scope?: "personal" | "group" | null;
  groupSlug?: string | null;
  myRights?: { mayDelete?: boolean; mayWriteAll?: boolean } | null;
};

/** Sidebar key → collection. REST id wins; a display-name key still matches. */
export function findNotebookCollection<T extends { id: string; name: string }>(
  collections: readonly T[],
  key: string,
): T | undefined {
  return (
    collections.find((item) => item.id === key) ?? collections.find((item) => item.name === key)
  );
}

/**
 * New note in this notebook. Missing `mayWriteAll` stays writable
 * (same rule as `isViewOnlyNotebook`).
 */
export function canCreateInNotebook(notebook?: NotebookWriteInfo | null): boolean {
  return notebook?.myRights?.mayWriteAll !== false;
}

/** Owned personal General — API `role: "general"` and/or `isDefault`. */
export function isDefaultNotebook(notebook?: NotebookWriteInfo): boolean {
  if (!notebook) return false;
  if (notebook.isDefault === true) return true;
  return notebook.role === "general";
}

/**
 * Provisioned group home (e.g. Administrators) — API `role: "group"` or
 * `id === group-{slug}`. Same lock as Calendar / Tasks.
 */
export function isProvisionedGroupNotebook(notebook?: NotebookWriteInfo): boolean {
  if (!notebook) return false;
  if (notebook.role === "group") return true;
  const slug = notebook.groupSlug?.trim();
  return notebook.scope === "group" && Boolean(slug) && notebook.id === `group-${slug}`;
}

/**
 * Owner delete in the notebook dialog — same gate as Calendar `mayDelete`.
 * Sharees use remove-shared; General and provisioned group homes cannot be
 * destroyed (`myRights.mayDelete: false` on the API).
 */
export function canDeleteNotebook(notebook?: NotebookWriteInfo): boolean {
  if (!notebook) return false;
  if (notebook.isSharee === true) return false;
  if (isDefaultNotebook(notebook)) return false;
  if (isProvisionedGroupNotebook(notebook)) return false;
  if (notebook.myRights?.mayDelete === false) return false;
  return true;
}

/**
 * Move Owner between personal and group (same options as create).
 * Default, provisioned group, and inbound sharees stay locked. Moving a group
 * notebook out of its group needs the delete right (`myRights.mayDelete`).
 */
export function canChangeNotebookOwner(notebook?: NotebookWriteInfo): boolean {
  if (!notebook) return false;
  if (notebook.isSharee === true) return false;
  if (isDefaultNotebook(notebook)) return false;
  if (notebook.scope === "group" && notebook.myRights?.mayDelete === false) return false;
  return !isProvisionedGroupNotebook(notebook);
}
