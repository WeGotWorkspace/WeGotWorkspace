/** Subset of drive `myRights` that Docs collab UI enforces. */
export type DocsCollabShareRights = {
  mayEditContent: boolean;
  mayComment: boolean;
  mayReview: boolean;
};

export type DocsCollabUiPermissions = {
  /** TipTap editable — content edit or suggest/review typing. */
  editable: boolean;
  /** Create/reply/resolve comments and reactions. */
  canComment: boolean;
  /** Suggest mode + accept/reject suggestions. */
  canReview: boolean;
};

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
 * - explicit rights → view < comment < review < edit
 */
export function resolveDocsCollabPermissions(
  rights: DocsCollabShareRights | null | undefined,
): DocsCollabUiPermissions {
  if (rights == null) return FULL_ACCESS;

  const canComment = rights.mayComment === true;
  const canReview = rights.mayReview === true;
  const mayEdit = rights.mayEditContent === true;

  return {
    // Review needs typing for suggestions; comment-only stays non-editable (selection still works).
    editable: mayEdit || canReview,
    canComment,
    canReview,
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
