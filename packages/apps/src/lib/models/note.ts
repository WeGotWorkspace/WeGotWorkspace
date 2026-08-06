export type Note = {
  id: string;
  category: string;
  /**
   * Display timestamp for list + “Edited” footer. Prefer API `contentUpdatedAt`
   * (file mtime, advances on body collab saves) when present; otherwise metadata
   * `updatedAt`. Optimistic body edits bump this locally without touching
   * {@link updatedAt}.
   */
  date: string;
  /**
   * Metadata concurrency token from API `updatedAt` (frontmatter marker).
   * Body-only collab saves intentionally leave this unchanged so offline
   * `ifInState` guards never false-conflict. Prefer this over {@link date} when
   * enqueueing metadata outbox rows.
   */
  updatedAt?: string;
  excerpt: string;
  body: string[];
  pullQuote?: string;
  notebook: string;
  tags: string[];
  wordCount: number;
  /** From `GET /notes/items` — seeds local starred state. */
  starred?: boolean;
  /** From `GET /notes/items` — seeds archive view. */
  archived?: boolean;
  /** Personal vs group home; from Notes API / shared listings. */
  scope?: "personal" | "group";
  /** Present when {@link scope} is `group`. */
  groupSlug?: string | null;
  /**
   * Virtual drive path when known (collab / share). Shared-with-me stubs set this
   * from the listing `path`; owned notes may omit it and rebuild via `noteCollabPath`.
   */
  apiPath?: string;
  /** True for Shared-with-me file-grant stubs (excluded from All / personal notebooks). */
  sharedInbox?: boolean;
  /**
   * True for notes loaded via an ACL notebook-directory grant (Shared notebooks).
   * Kept out of All / owned notebook views; shown when opening that shared notebook.
   */
  sharedNotebookGrant?: boolean;
  /**
   * Grantor display name for Shared-with-me file grants (API `owner`).
   * Used for list/detail username location labeling.
   */
  sharedBy?: string;
  /**
   * Effective share rights for the current user when known from list payloads
   * (shared-with-me / shared-notebook notes). Owned notes omit this.
   */
  myRights?: {
    mayEditContent: boolean;
  };
  /**
   * True when the current user has outgoing share grants on this note file or
   * its notebook (from `GET /notes/items` `hasShares`). Owner affordance only.
   */
  isShared?: boolean;
};
