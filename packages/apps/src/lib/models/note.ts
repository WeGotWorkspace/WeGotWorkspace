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
};
