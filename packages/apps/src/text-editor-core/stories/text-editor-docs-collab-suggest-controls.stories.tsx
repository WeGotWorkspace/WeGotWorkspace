import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEditor } from "@tiptap/react";
import { DocsCollabCommentControl } from "@/text-editor-core/docs-collab/docs-collab-comment-control";
import { DocsCollabSuggestControls } from "@/text-editor-core/docs-collab/docs-collab-suggest-controls";
import { docsLabels } from "@/docs-core/src/docs-labels";
import {
  TextEditorFormatBar,
  TEXT_EDITOR_FORMAT_BAR_FULL,
} from "@/text-editor-core/src/text-editor-format-bar";
import { createCollaborativeTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import { ViewHeader } from "@/view-header/src/view-header";
import { useMockDocsCollabEditorSession } from "@/text-editor-core/stories/text-editor-collab-stories.harness";

import "@/text-editor-core/src/text-editor.css";
import "@/docs-core/src/docs-workspace.css";

function SuggestControlsHarness() {
  const session = useMockDocsCollabEditorSession("Alex");
  const editor = useEditor(
    {
      immediatelyRender: false,
      autofocus: "end",
      extensions: createCollaborativeTextEditorExtensions({
        format: "markdown",
        placeholder: "Press '/' for commands…",
        document: session.ydoc,
        awareness: session.awareness,
        user: session.user,
      }),
      editorProps: {
        attributes: { class: "text-editor-prose focus:outline-none" },
      },
    },
    [session.ydoc, session.awareness],
  );

  return (
    <div className="docs-workspace flex min-h-[min(640px,90dvh)] w-full flex-col p-6">
      <p className="mb-3 text-sm text-muted-foreground">
        Use the header <strong>Suggest</strong> toggle to track edits, then review and accept or
        reject proposals in the suggestions sidebar.
      </p>
      <ViewHeader
        title="together.md"
        hideSidebarToggle
        actions={<DocsCollabSuggestControls editor={editor} />}
      />
      <TextEditorFormatBar
        editor={editor}
        groups={TEXT_EDITOR_FORMAT_BAR_FULL}
        showPrint={false}
        commentControl={
          <DocsCollabCommentControl
            labels={docsLabels}
            canAddFromSelection
            onAddCommentFromSelection={() => {}}
          />
        }
      />
      <TextEditorSheet editor={editor} variant="sheet" fill className="min-h-0 flex-1" />
    </div>
  );
}

const meta = {
  title: "Shared/TextEditor/Docs collab/Suggest controls",
  component: DocsCollabSuggestControls,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Suggest-mode outline state Button (always Pencil; Tasks show-completed pattern) for the Docs collab ViewHeader, backed by MIT `tiptap-track-changes`. Accept/reject live in the suggestions sidebar.",
      },
    },
  },
} satisfies Meta<typeof DocsCollabSuggestControls>;

export default meta;
type Story = StoryObj<typeof DocsCollabSuggestControls>;

export const Default: Story = {
  render: () => <SuggestControlsHarness />,
};
