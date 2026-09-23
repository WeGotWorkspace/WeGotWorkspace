import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocsCollabEditor } from "@/text-editor-core/docs-collab/docs-collab-editor";
import { useMockDocsCollabEditorSession } from "@/text-editor-core/stories/text-editor-collab-stories.harness";

import "@/text-editor-core/src/text-editor.css";
import "@/docs-core/src/docs-workspace.css";

function DocsCollabEditorHarness() {
  const session = useMockDocsCollabEditorSession("Alex");
  return (
    <div className="docs-workspace flex min-h-[min(900px,90dvh)] flex-col p-6">
      <DocsCollabEditor
        ydoc={session.ydoc}
        awareness={session.awareness}
        user={session.user}
        format="markdown"
        sheetFill
        formatBar={{ showPrint: false }}
        onContentChange={() => {}}
      />
    </div>
  );
}

const meta = {
  title: "Features/Docs/TextEditor/Docs collab/Editor",
  component: DocsCollabEditor,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Offline Yjs-backed collaborative editor surface — no signaling or REST persistence required.",
      },
    },
  },
} satisfies Meta<typeof DocsCollabEditor>;

export default meta;
type Story = StoryObj<typeof DocsCollabEditor>;

export const Default: Story = {
  render: () => <DocsCollabEditorHarness />,
};
