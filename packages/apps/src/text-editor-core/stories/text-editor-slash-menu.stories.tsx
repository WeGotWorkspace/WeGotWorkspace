import { useEffect } from "react";
import { EditorContent } from "@tiptap/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { TextEditorSlashMenu } from "@/text-editor-core/src/text-editor-slash-menu";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";

import "@/text-editor-core/src/text-editor.css";

function SlashMenuHarness({ query = "" }: { query?: string }) {
  const editor = useTextEditor({
    format: "markdown",
    content: query ? `Start typing\n/${query}` : "/",
    editable: true,
    placeholder: "Press '/' for commands…",
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.focus("end");
  }, [editor]);

  return (
    <div className="text-editor flex min-h-[min(900px,90dvh)] w-full max-w-3xl flex-col p-8">
      <div className="text-editor-sheet text-editor-sheet--inline min-h-[320px] flex-1">
        <EditorContent editor={editor} className="text-editor-sheet__surface paper-sheet" />
      </div>
      <TextEditorSlashMenu editor={editor} />
    </div>
  );
}

const meta = {
  title: "Shared/TextEditor/SlashMenu",
  component: TextEditorSlashMenu,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Block picker opened when the caret follows `/`. Type to filter; arrow keys and Enter select a command.",
      },
    },
  },
} satisfies Meta<typeof TextEditorSlashMenu>;

export default meta;
type Story = StoryObj<typeof TextEditorSlashMenu>;

export const Default: Story = {
  render: () => <SlashMenuHarness />,
};

export const Filtered: Story = {
  name: "Filtered query",
  tags: ["vitest-ci"],
  render: () => <SlashMenuHarness query="head" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const headingOption = await screen.findByRole("option", { name: /Heading 1/i });
    await userEvent.click(headingOption);
    await expect(canvas.getByRole("heading", { level: 1 })).toBeInTheDocument();
  },
};
