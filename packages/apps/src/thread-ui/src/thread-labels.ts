/** Copy for the shared thread panel (#2173). App-specific text comes from the adapter. */
export const threadUiLabels = {
  heading: "Comments",
  count: (count: number) => (count === 1 ? "1 comment" : `${count} comments`),
  empty: "No comments yet",
  loading: "Loading comments…",
  loadFailed: "Comments could not load.",
  retryLoad: "Try again",
  offline: "Connect to load the conversation",
  placeholder: "Write a comment… (@ to mention)",
  replyPlaceholder: "Write a reply…",
  comment: "Comment",
  reply: "Reply",
  readOnly: "You can read this conversation but not comment.",
  notSent: "Not sent",
  notSaved: "Not saved",
  retry: "Try again",
  copyText: "Copy text",
  discard: "Discard",
  failure: {
    gone: "This item is gone or you lost access to it.",
    forbidden: "You can no longer comment here.",
    moved: "It moved to another place while you were writing.",
    invalid: "The server did not accept it.",
    network: "No connection.",
  },
} as const;

export type ThreadUiLabels = typeof threadUiLabels;
