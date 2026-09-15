import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditorContent } from "@tiptap/react";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";
import { TextEditorFormatBar } from "@/text-editor-core/src/text-editor-format-bar";
import { TextEditorSlashMenu } from "@/text-editor-core/src/text-editor-slash-menu";

import "@/text-editor-core/src/text-editor.css";

const FIXTURE_NODE_ID = "fn-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const PIXEL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PIXEL_PNG_BYTES = Uint8Array.from(atob(PIXEL_PNG_B64), (c) => c.charCodeAt(0));

async function fetchFixtureImage(): Promise<Blob> {
  return new Blob([PIXEL_PNG_BYTES], { type: "image/png" });
}

function DocsImageFixtureEditor() {
  const editor = useTextEditor({
    format: "markdown",
    content: `A Drive FileNode image resolved through an authenticated blob URL.\n\n![Team photo](drive:${FIXTURE_NODE_ID})\n\n![Badge](drive:${FIXTURE_NODE_ID})`,
    fetchImageContent: fetchFixtureImage,
  });

  return (
    <div className="text-editor flex min-h-[min(640px,80dvh)] w-full max-w-3xl flex-col p-6">
      <TextEditorFormatBar editor={editor} showPrint={false} onInsertImage={() => undefined} />
      <div className="text-editor-sheet text-editor-sheet--inline min-h-[320px] flex-1">
        <EditorContent editor={editor} className="text-editor-sheet__surface paper-sheet" />
      </div>
      <TextEditorSlashMenu editor={editor} onInsertImage={() => undefined} />
    </div>
  );
}

const meta = {
  title: "Shared/TextEditor/Docs image",
  component: DocsImageFixtureEditor,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Markdown/Yjs store `drive:fn-` references. The node view fetches GET /files/content?id= with the session token and displays a blob URL. This story uses a fixture fetcher.",
      },
    },
  },
} satisfies Meta<typeof DocsImageFixtureEditor>;

export default meta;
type Story = StoryObj<typeof DocsImageFixtureEditor>;

export const DriveFnAndHttps: Story = {
  tags: ["vitest-ci"],
  render: () => <DocsImageFixtureEditor />,
};
