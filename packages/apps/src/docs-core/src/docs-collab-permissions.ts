/** Subset of drive `myRights` that Docs collab UI enforces. */
export type DocsCollabShareRights = {
  mayEditContent: boolean;
  mayComment: boolean;
  mayReview: boolean;
};

export type DocsCollabUiPermissions = {
  /** TipTap editable — content editing (includes suggest-mode typing). */
  editable: boolean;
  /** Create/reply/resolve comments and reactions. */
  canComment: boolean;
  /** Suggest mode + accept/reject suggestions (part of edit access). */
  canReview: boolean;
};

/**
 * How the Docs formatting bar should behave for the current share capabilities.
 *
 * - `hidden` — view access (no edit, no comment)
 * - `commentOnly` — comment access: bar visible, formatting disabled, comment control active
 * - `full` — edit/full access
 */
export type DocsCollabFormatBarMode = "hidden" | "commentOnly" | "full";

const FULL_ACCESS: DocsCollabUiPermissions = {
  editable: true,
  canComment: true,
  canReview: true,
};

const LOCKED: DocsCollabUiPermissions = {
  editable: false,
  canComment: false,
  canReview: false,
};

/**
 * Maps share `myRights` to collab editor capabilities.
 *
 * - `undefined` rights → full access (Storybook / no share fetch)
 * - explicit rights → view < comment < edit (suggest is a Docs UI mode within edit, not a share ACL)
 */
export function resolveDocsCollabPermissions(
  rights: DocsCollabShareRights | null | undefined,
): DocsCollabUiPermissions {
  if (rights == null) return FULL_ACCESS;

  const canComment = rights.mayComment === true;
  const mayEdit = rights.mayEditContent === true;

  return {
    // View/comment stay non-editable for the body; only edit/full unlock typing.
    editable: mayEdit,
    canComment,
    // Suggest/review mode is included with edit access (not a separate share level).
    canReview: mayEdit,
  };
}

/** While at-path is loading, deny mutations so view-only never flashes as editable. */
export function resolveDocsCollabPermissionsWhileLoading(
  rights: DocsCollabShareRights | null | undefined,
  loading: boolean,
): DocsCollabUiPermissions {
  if (rights != null) return resolveDocsCollabPermissions(rights);
  if (loading) return LOCKED;
  return FULL_ACCESS;
}

/** Derive formatting-bar visibility/disabled mode from resolved collab capabilities. */
export function resolveDocsCollabFormatBarMode(
  permissions: DocsCollabUiPermissions,
): DocsCollabFormatBarMode {
  if (permissions.editable) return "full";
  if (permissions.canComment) return "commentOnly";
  return "hidden";
}
