import { workspaceLabels } from "@/lib/workspace/workspace-labels";

export const chatUiLabels = {
  empty: "No messages yet",
  deleted: "This message was deleted",
  edited: "Edited",
  reply: "Reply",
  react: "Add reaction",
  edit: workspaceLabels.dialog.edit,
  delete: workspaceLabels.dialog.delete,
  send: "Send",
  cancel: workspaceLabels.dialog.cancel,
  mentionList: "Mention someone",
  mentionEmpty: "No matches",
  previewMissing: "Preview unavailable",
  previewExternal: "External link",
  composerPlaceholder: "Write a message…",
  sendHint: "Return to send · Shift + Return for new line",
  today: "Today",
  yesterday: "Yesterday",
  newMessages: "New messages",
} as const;
