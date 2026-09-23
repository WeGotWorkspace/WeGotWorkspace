import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import * as Y from "yjs";
import { CommentMark } from "@/text-editor-core/src/text-editor-comment-commands";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import { DocsCommentsFloatingLayer } from "@/text-editor-core/docs-collab/docs-comments";
import { useDocsComments } from "@/text-editor-core/docs-collab/use-docs-comments";
import { docsLabels } from "@/docs-core/src/docs-labels";

import "@/text-editor-core/src/text-editor.css";

function DocsCommentsCollabDemo() {
  const [ydoc] = useState(() => new Y.Doc());
  const [commentsOpen, setCommentsOpen] = useState(true);
  const editor = useEditor({
    extensions: [StarterKit.configure({ undoRedo: false }), CommentMark],
    content: "<p>Select this phrase to comment.</p>",
    editorProps: {
      attributes: { class: "text-editor-prose focus:outline-none" },
    },
    immediatelyRender: false,
  });
  const comments = useDocsComments({
    ydoc,
    editor,
    currentUser: { id: "story-user", name: "Story User" },
    commentsVisible: commentsOpen,
  });
  const {
    draftThread,
    selectionQualifiesForComment,
    createThreadFromSelection,
    selectThread,
    ...commentActions
  } = comments;

  useEffect(() => {
    if (!editor) return;
    editor.commands.setTextSelection({ from: 8, to: 19 });
  }, [editor]);

  const addCommentFromSelection = () => {
    setCommentsOpen(true);
    if (draftThread) {
      selectThread(draftThread.id);
      return;
    }
    if (selectionQualifiesForComment) {
      createThreadFromSelection();
    }
  };

  return (
    <div className="docs-workspace flex min-h-[480px] flex-col border">
      <div className="flex items-center justify-end gap-2 border-b px-3 py-2">
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-sm"
          disabled={!selectionQualifiesForComment}
          onClick={addCommentFromSelection}
        >
          {docsLabels.commentsAddFromSelection}
        </button>
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-sm"
          aria-pressed={commentsOpen}
          onClick={() => setCommentsOpen((open) => !open)}
        >
          {commentsOpen ? "Hide comments" : "Show comments"}
        </button>
      </div>
      <div className="relative min-h-0 flex-1 p-6">
        <TextEditorSheet
          editor={editor}
          variant="sheet"
          fill
          overlay={
            <DocsCommentsFloatingLayer
              editor={editor}
              visible={commentsOpen || draftThread != null}
              labels={docsLabels}
              threads={commentActions.openThreads}
              draftThread={draftThread}
              currentUserId="story-user"
              activeThreadId={commentActions.activeThreadId}
              onSelectThread={commentActions.selectThread}
              onAddReply={commentActions.addReply}
              onToggleReaction={commentActions.toggleReaction}
              onResolveThread={commentActions.resolveThread}
              onCancelDraft={commentActions.cancelDraft}
            />
          }
        />
      </div>
    </div>
  );
}

const meta = {
  title: "UI/Patterns/TextEditor/Marks",
  component: DocsCommentsCollabDemo,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Comment marks in the editor with margin comment cards.",
      },
    },
  },
} satisfies Meta<typeof DocsCommentsCollabDemo>;

export default meta;

type Story = StoryObj<typeof DocsCommentsCollabDemo>;

export const CommentMarkStory: Story = {
  name: "CommentMark",
  render: () => (
    <div className="text-editor p-6">
      <div
        className="text-editor-prose"
        dangerouslySetInnerHTML={{
          __html:
            '<p>Review this <span data-comment-id="c-1" class="comment-mark">commented phrase</span> before publishing.</p>',
        }}
      />
    </div>
  ),
};

export const DocsCommentsCollab: Story = {
  name: "Docs comments collab",
  tags: ["vitest-ci"],
  render: () => <DocsCommentsCollabDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: docsLabels.commentsAddFromSelection }),
    );
    const composeField = await canvas.findByPlaceholderText(docsLabels.commentsComposePlaceholder);
    await userEvent.type(composeField, "Looks good");
    const composer = composeField.closest(".docs-comments-thread-card__composer");
    if (!composer) throw new Error("expected comment composer");
    await userEvent.click(
      within(composer as HTMLElement).getByRole("button", { name: docsLabels.commentsAdd }),
    );
    await expect(
      canvas.getByPlaceholderText(docsLabels.commentsReplyPlaceholder),
    ).toBeInTheDocument();
  },
};

export const LegacySuggestionMarkStory: Story = {
  name: "LegacySuggestionMark",
  render: () => (
    <div className="text-editor p-6">
      <div
        className="text-editor-prose"
        dangerouslySetInnerHTML={{
          __html:
            '<p>Accept this <span data-suggestion-id="s-1" class="legacy-suggestion-mark">suggested edit</span> before publishing.</p>',
        }}
      />
    </div>
  ),
};

export const BothMarks: Story = {
  name: "Comment and legacy suggestion marks",
  render: () => (
    <div className="text-editor p-6">
      <div
        className="text-editor-prose"
        dangerouslySetInnerHTML={{
          __html:
            '<p><span data-comment-id="c-1" class="comment-mark">Comment</span> and <span data-suggestion-id="s-1" class="legacy-suggestion-mark">suggestion</span> marks together.</p>',
        }}
      />
    </div>
  ),
};
