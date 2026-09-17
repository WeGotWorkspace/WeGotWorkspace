import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { EditorContent } from "@tiptap/react";
import { DocsCollabCommentControl } from "@/text-editor-core/docs-collab/docs-collab-comment-control";
import { docsLabels } from "@/docs-core/src/docs-labels";
import {
  TextEditorFormatBar,
  TEXT_EDITOR_FORMAT_BAR_GROUPS,
  TEXT_EDITOR_FORMAT_BAR_MAIL,
  type TextEditorFormatBarGroup,
} from "@/text-editor-core/src/text-editor-format-bar";
import {
  TEXT_EDITOR_CONTENT_FORMATS,
  type TextEditorContentFormat,
} from "@/text-editor-core/src/text-editor-content";
import { textEditorDemoContent } from "@/text-editor-core/src/text-editor-fixtures";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";

import "@/text-editor-core/src/text-editor.css";

type FormatBarStoryArgs = {
  format: TextEditorContentFormat;
  groups: TextEditorFormatBarGroup[];
  showPrint: boolean;
  editable: boolean;
};

function TextEditorFormatBarDemo({ format, groups, showPrint, editable }: FormatBarStoryArgs) {
  const editor = useTextEditor({
    format,
    editable,
    content: textEditorDemoContent(format),
  });

  return (
    <div className="text-editor text-editor--format-bar-story flex h-[min(420px,70dvh)] w-full flex-col">
      <TextEditorFormatBar editor={editor} groups={groups} showPrint={showPrint} />
      <div className="text-editor-format-bar-story__body">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

const meta = {
  title: "Shared/TextEditor/TextEditorFormatBar",
  component: TextEditorFormatBar,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Sticky formatting toolbar. Pair with a TipTap editor instance; stories use a compact inline body (not the letter sheet).",
      },
    },
  },
  render: (args: FormatBarStoryArgs) => <TextEditorFormatBarDemo {...args} />,
  argTypes: {
    format: {
      control: "select",
      options: TEXT_EDITOR_CONTENT_FORMATS,
    },
    groups: {
      control: "check",
      options: TEXT_EDITOR_FORMAT_BAR_GROUPS,
    },
    showPrint: { control: "boolean" },
    editable: { control: "boolean" },
  },
} satisfies Meta<FormatBarStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Html: Story = {
  tags: ["vitest-ci"],
  args: {
    format: "html",
    groups: [...TEXT_EDITOR_FORMAT_BAR_GROUPS],
    showPrint: true,
    editable: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bold = canvas.getByRole("button", { name: "Bold" });
    await userEvent.click(bold);
    await expect(bold).toHaveAttribute("aria-pressed", "true");
  },
};

export const MailToolbar: Story = {
  name: "Mail toolbar",
  args: {
    format: "html",
    groups: TEXT_EDITOR_FORMAT_BAR_MAIL,
    showPrint: false,
    editable: true,
  },
};

export const Markdown: Story = {
  args: {
    format: "markdown",
    groups: [...TEXT_EDITOR_FORMAT_BAR_GROUPS],
    showPrint: false,
    editable: true,
  },
};

export const ReadOnly: Story = {
  name: "Read only",
  args: {
    format: "html",
    groups: [...TEXT_EDITOR_FORMAT_BAR_GROUPS],
    showPrint: false,
    editable: false,
  },
};

function CommentControlDemo() {
  const editor = useTextEditor({
    format: "markdown",
    editable: true,
    content: "Select text to comment.",
  });

  return (
    <div className="text-editor text-editor--format-bar-story flex h-[min(420px,70dvh)] w-full flex-col">
      <TextEditorFormatBar
        editor={editor}
        groups={[...TEXT_EDITOR_FORMAT_BAR_GROUPS]}
        showPrint={false}
        commentControl={
          <DocsCollabCommentControl
            labels={docsLabels}
            canAddFromSelection
            onAddCommentFromSelection={() => {}}
          />
        }
      />
      <div className="text-editor-format-bar-story__body">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export const CommentControl: Story = {
  name: "Comment control",
  tags: ["vitest-ci"],
  render: () => <CommentControlDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: docsLabels.commentsAddFromSelection }),
    ).toBeInTheDocument();
  },
};
