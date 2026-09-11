import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { DocsCollabEditor } from "@/text-editor-core/docs-collab/docs-collab-editor";
import { DocsCollabSuggestControls } from "@/text-editor-core/docs-collab/docs-collab-suggest-controls";
import { ViewHeader } from "@/view-header/src/view-header";
import { useMockDocsCollabEditorSession } from "@/text-editor-core/stories/text-editor-collab-stories.harness";

import "@/text-editor-core/src/text-editor.css";
import "@/docs-core/src/docs-workspace.css";

function SuggestModeHarness() {
  const session = useMockDocsCollabEditorSession("Alex");
  const [editor, setEditor] = useState<Editor | null>(null);
  return (
    <div className="docs-workspace flex min-h-[min(900px,90dvh)] flex-col p-6">
      <p className="mb-3 text-sm text-muted-foreground">
        Switch to <strong>Suggest</strong> in the header, edit the document, then accept or reject
        proposals from the suggestions sidebar.
      </p>
      <ViewHeader
        title="together.md"
        hideSidebarToggle
        actions={<DocsCollabSuggestControls editor={editor} />}
      />
      <DocsCollabEditor
        ydoc={session.ydoc}
        awareness={session.awareness}
        user={session.user}
        format="markdown"
        sheetFill
        formatBar={{ showPrint: false }}
        onContentChange={() => {}}
        onEditorReady={setEditor}
      />
    </div>
  );
}

const meta = {
  title: "Shared/TextEditor/Docs collab/Suggest mode",
  component: DocsCollabEditor,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Offline Yjs-backed Docs editor with MIT `tiptap-track-changes` — Suggest-mode header toggle and suggestion cards in the sidebar.",
      },
    },
  },
} satisfies Meta<typeof DocsCollabEditor>;

export default meta;
type Story = StoryObj<typeof DocsCollabEditor>;

export const Default: Story = {
  render: () => <SuggestModeHarness />,
};
