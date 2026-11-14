import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";

export const sampleThread: DocsCommentThread = {
  id: "thread-1",
  anchorText: "launch checklist",
  anchorFrom: 1,
  createdAt: "2026-06-01T09:00:00.000Z",
  createdBy: { id: "u-1", name: "Alex Example" },
  resolved: false,
  messages: [
    {
      id: "thread-1-m",
      body: "Can we tighten the acceptance criteria before Friday?",
      createdAt: "2026-06-01T09:05:00.000Z",
      author: { id: "u-1", name: "Alex Example" },
    },
  ],
  reactions: [{ emoji: "👍", userIds: ["u-2"] }],
};

export const threadWithReplies: DocsCommentThread = {
  ...sampleThread,
  id: "thread-2",
  messages: [
    sampleThread.messages[0]!,
    {
      id: "thread-2-r1",
      body: "Yes — I'll add the QA pass to the doc.",
      createdAt: "2026-06-01T10:15:00.000Z",
      author: { id: "u-2", name: "Sam Lee" },
    },
  ],
};

export const draftThread: DocsCommentThread = {
  id: "draft-1",
  anchorText: "selected phrase",
  anchorFrom: 1,
  anchorTo: 16,
  createdAt: "2026-06-01T11:00:00.000Z",
  createdBy: { id: "u-1", name: "Alex Example" },
  resolved: false,
  messages: [],
};
