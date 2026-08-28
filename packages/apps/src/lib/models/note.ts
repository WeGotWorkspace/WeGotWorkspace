export type Note = {
  id: string;
  /** VJOURNAL SUMMARY when known. List title prefers this over excerpt. */
  title?: string;
  /** REST notebook id (CalDAV collection uri / group- API id). */
  notebookId?: string;
  /** If-Match token from REST `etag`. */
  etag?: string;
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
  /** From REST `note.starred` (`note_stars` for the caller). */
  starred?: boolean;
  /** From REST `status === CANCELLED`. */
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
   * @deprecated Personal ACL notebook-directory grants were removed. Unused.
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
   * its notebook. Owner affordance only. FileNode bootstrap does not currently
   * project `hasShares` — leftover REST rows may still set this.
   */
  isShared?: boolean;
};
