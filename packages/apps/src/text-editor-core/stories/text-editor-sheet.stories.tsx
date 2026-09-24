import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import {
  TEXT_EDITOR_CONTENT_FORMATS,
  type TextEditorContentFormat,
} from "@/text-editor-core/src/text-editor-content";
import { textEditorDemoContent } from "@/text-editor-core/src/text-editor-fixtures";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";

import "@/text-editor-core/src/text-editor.css";

type SheetStoryArgs = {
  format: TextEditorContentFormat;
  editable: boolean;
  placeholder?: string;
  content?: string;
};

function TextEditorSheetDemo({ format, editable, placeholder, content }: SheetStoryArgs) {
  const editor = useTextEditor({
    format,
    editable,
    placeholder,
    content: content ?? textEditorDemoContent(format),
  });

  return (
    <div className="text-editor flex min-h-[min(900px,90dvh)] w-full">
      <TextEditorSheet editor={editor} className="flex-1" />
    </div>
  );
}

const meta = {
  title: "UI/Patterns/TextEditor/TextEditorSheet",
  component: TextEditorSheet,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Letter-sized sheet with inline editing, slash commands, and table controls (no formatting toolbar).",
      },
    },
  },
  render: (args: SheetStoryArgs) => <TextEditorSheetDemo {...args} />,
  argTypes: {
    format: {
      control: "select",
      options: TEXT_EDITOR_CONTENT_FORMATS,
    },
    editable: { control: "boolean" },
    placeholder: { control: "text" },
  },
} satisfies Meta<SheetStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Html: Story = {
  args: {
    format: "html",
    editable: true,
  },
};

export const Markdown: Story = {
  args: {
    format: "markdown",
    editable: true,
  },
};

export const EmptyMarkdown: Story = {
  name: "Empty markdown",
  args: {
    format: "markdown",
    editable: true,
    placeholder: "Press '/' for commands…",
    content: "",
  },
};

export const ReadOnlyHtml: Story = {
  name: "Read only HTML",
  args: {
    format: "html",
    editable: false,
  },
};
