import { useEffect } from "react";
import { EditorContent } from "@tiptap/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextEditorTableControls } from "@/text-editor-core/src/text-editor-table-controls";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";

import "@/text-editor-core/src/text-editor.css";

const TABLE_MARKDOWN = [
  "| Product | Status |",
  "| --- | --- |",
  "| Drive sync | Ready |",
  "| Mail compose | Draft |",
  "| Meet lobby | Review |",
].join("\n");

function TableControlsHarness() {
  const editor = useTextEditor({
    format: "markdown",
    content: TABLE_MARKDOWN,
    editable: true,
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.focus(8);
  }, [editor]);

  return (
    <div className="text-editor flex min-h-[min(900px,90dvh)] w-full max-w-3xl flex-col p-8">
      <p className="mb-4 text-sm text-muted-foreground">
        Hover row/column edges for insert handles; drag grips to reorder; click a grip to select a
        row or column.
      </p>
      <div className="text-editor-sheet text-editor-sheet--inline min-h-[320px] flex-1">
        <EditorContent editor={editor} className="text-editor-sheet__surface paper-sheet" />
      </div>
      <TextEditorTableControls editor={editor} />
    </div>
  );
}

const meta = {
  title: "Shared/TextEditor/TableControls",
  component: TextEditorTableControls,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Floating table chrome: insert row/column, drag reorder, delete, and header toggles when the selection is inside a table.",
      },
    },
  },
} satisfies Meta<typeof TextEditorTableControls>;

export default meta;
type Story = StoryObj<typeof TextEditorTableControls>;

export const Default: Story = {
  render: () => <TableControlsHarness />,
};
