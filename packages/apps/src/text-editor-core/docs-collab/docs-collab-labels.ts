/**
 * Strings the shared collaborative editor shows itself: the comment button in
 * its format bar, the connecting status and the presence chrome. Docs spreads
 * them into `docsLabels`, so Docs and Notes show the same words and the engine
 * does not import the Docs app (#2116).
 */
export const docsCollabLabels = {
  commentsAddFromSelection: "Comment",
  commentsAddFromSelectionDisabledNoSelection: "Select text to comment",
  commentsAddFromSelectionDisabledViewSource: "Comments are disabled in source view",
  commentsAddFromSelectionDisabledReadOnly: "View-only access cannot add comments",
  /** Transient phase, only ever shown after a 1.5 s hold. */
  statusConnecting: "Connecting…",
  /** Presence chrome, in people terms rather than connection terms. */
  presenceConnectingOne: "Connecting to 1 person",
  presenceConnectingMany: (count: number) => `Connecting to ${count} people`,
  presenceWithNames: (summary: string, names: string) => `${summary}: ${names}`,
  presenceConnectingAvatar: "Connecting",
  presenceUnreachableOne: "Could not reach 1 person",
  presenceUnreachableMany: (count: number) => `Could not reach ${count} people`,
  presenceUnreachableAvatar: "Connection warning",
} as const;

export type DocsCollabLabels = typeof docsCollabLabels;

/** The labels `DocsCollabCommentControl` reads. */
export type DocsCollabCommentControlLabels = Pick<
  DocsCollabLabels,
  | "commentsAddFromSelection"
  | "commentsAddFromSelectionDisabledNoSelection"
  | "commentsAddFromSelectionDisabledViewSource"
  | "commentsAddFromSelectionDisabledReadOnly"
>;
