import type { DocsSuggestionWithThread } from "@/text-editor-core/docs-collab/docs-suggestions-types";
import {
  UNKNOWN_SUGGESTION_AUTHOR,
  suggestionAuthorFromThread,
} from "@/text-editor-core/docs-collab/docs-suggestions/docs-suggestion-author";
import type { TrackedChangeInfo } from "tiptap-track-changes";

const TIMESTAMP = "2026-06-01T09:05:00.000Z";

type ThreadAuthor = { id: string; name: string };

/** Editor parts carry only an opaque session id; the thread root carries the person. */
function sessionPart(sessionId: string) {
  return { authorId: sessionId, authorName: "", authorColor: "" };
}

const threadAuthors: Record<string, ThreadAuthor> = {
  tc_story_alex: { id: "u-alex", name: "Alex Example" },
  tc_story_sam: { id: "u-sam", name: "Sam Lee" },
};

function buildSuggestion(
  changeId: string,
  parts: TrackedChangeInfo[],
  anchorText: string,
  summary: string,
): DocsSuggestionWithThread {
  const primary = parts[0]!;
  const from = Math.min(...parts.map((part) => part.from));
  const to = Math.max(...parts.map((part) => part.to));

  return {
    changeId,
    ...suggestionAuthorFromThread(threadAuthors[primary.authorId]),
    timestamp: primary.timestamp,
    from,
    to,
    anchorText,
    summary,
    parts,
    messages: [],
  };
}

const alex = sessionPart("tc_story_alex");
const sam = sessionPart("tc_story_sam");

export const insertSuggestion = buildSuggestion(
  "change-insert-1",
  [
    {
      changeId: "change-insert-1",
      type: "insertion",
      ...alex,
      timestamp: TIMESTAMP,
      from: 58,
      to: 65,
      text: "QA pass",
    },
  ],
  "…acceptance criteria before Friday",
  "Insert “QA pass”",
);

export const deleteSuggestion = buildSuggestion(
  "change-delete-1",
  [
    {
      changeId: "change-delete-1",
      type: "deletion",
      ...sam,
      timestamp: "2026-06-01T10:30:00.000Z",
      from: 10,
      to: 15,
      text: "draft",
    },
  ],
  "…the launch checklist for the release",
  "Delete “draft”",
);

export const replaceSuggestion = buildSuggestion(
  "change-replace-1",
  [
    {
      changeId: "change-replace-1",
      type: "deletion",
      ...alex,
      timestamp: TIMESTAMP,
      from: 10,
      to: 15,
      text: "draft",
    },
    {
      changeId: "change-replace-1",
      type: "insertion",
      ...alex,
      timestamp: TIMESTAMP,
      from: 10,
      to: 15,
      text: "final",
    },
  ],
  "…the launch checklist for the release",
  "Replace “draft” with “final”",
);

/** Long replace diff for verifying inactive two-line clamp in Storybook. */
export const longReplaceSuggestion = buildSuggestion(
  "change-replace-long-1",
  [
    {
      changeId: "change-replace-long-1",
      type: "deletion",
      ...alex,
      timestamp: TIMESTAMP,
      from: 10,
      to: 80,
      text: "the original paragraph that spans multiple lines when rendered inside a narrow suggestion card panel",
    },
    {
      changeId: "change-replace-long-1",
      type: "insertion",
      ...alex,
      timestamp: TIMESTAMP,
      from: 10,
      to: 80,
      text: "the revised paragraph with substantially different wording that also wraps across several lines in the sidebar",
    },
  ],
  "…the launch checklist for the release",
  "Replace long paragraph text",
);

export const formatChangeSuggestion = buildSuggestion(
  "change-format-1",
  [
    {
      changeId: "change-format-1",
      type: "formatChange",
      ...sam,
      timestamp: "2026-06-01T11:00:00.000Z",
      from: 20,
      to: 28,
      text: "headline",
      formatAdded: "bold",
      formatRemoved: "italic",
    },
  ],
  "…update the headline before review",
  "Change formatting of “headline”: italic → bold",
);

const replyAuthorSam = { id: "u-sam", name: "Sam Lee" };
const replyAuthorAlex = { id: "u-alex", name: "Alex Example" };

export const insertSuggestionWithThread = {
  ...insertSuggestion,
  messages: [
    {
      id: "reply-1",
      body: "Can we clarify this before Friday?",
      createdAt: "2026-06-01T09:10:00.000Z",
      author: replyAuthorSam,
    },
    {
      id: "reply-2",
      body: "Added during the last review pass.",
      createdAt: "2026-06-01T09:15:00.000Z",
      author: replyAuthorAlex,
    },
  ],
  reactions: [
    { emoji: "👍", userIds: ["u-alex", "u-sam"] },
    { emoji: "💡", userIds: ["u-sam"] },
  ],
};

export const replaceSuggestionWithReactions = {
  ...replaceSuggestion,
  messages: [],
  reactions: [{ emoji: "👀", userIds: ["u-alex"] }],
};

/** Older document: the suggestion has no thread, so author and time are unknown. */
export const unknownAuthorSuggestion: DocsSuggestionWithThread = {
  ...deleteSuggestion,
  changeId: "change-delete-legacy-1",
  ...UNKNOWN_SUGGESTION_AUTHOR,
  timestamp: "",
  parts: deleteSuggestion.parts.map((part) => ({
    ...part,
    changeId: "change-delete-legacy-1",
    authorId: "",
    timestamp: "",
  })),
};
