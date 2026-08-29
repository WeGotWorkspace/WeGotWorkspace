import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { TextEditor } from "@/text-editor-core/src/text-editor";
import { TEXT_EDITOR_CONTENT_FORMATS } from "@/text-editor-core/src/text-editor-content";
import { textEditorDemoContent } from "@/text-editor-core/src/text-editor-fixtures";
import { TEXT_EDITOR_FORMAT_BAR_MAIL } from "@/text-editor-core/src/text-editor-format-bar-config";
import { TextEditorWithSourceToggle } from "@/text-editor-core/stories/text-editor-source-stories.harness";

import "@/text-editor-core/src/text-editor.css";

const meta = {
  title: "Shared/TextEditor/TextEditor",
  component: TextEditor,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          'Full rich-text editor: formatting toolbar, letter sheet, slash menu, and table controls. Use `format="html"` for mail bodies or `format="markdown"` for notes. Set `viewSource` externally for split (wide landscape) or source-only (narrow / portrait) layouts.',
      },
    },
  },
  render: (args) => <TextEditor {...args} />,
  argTypes: {
    format: {
      control: "select",
      options: TEXT_EDITOR_CONTENT_FORMATS,
    },
    editable: { control: "boolean" },
    showPrint: { control: "boolean" },
    viewSource: { control: "boolean" },
    placeholder: { control: "text" },
  },
} satisfies Meta<typeof TextEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Html: Story = {
  args: {
    format: "html",
    content: textEditorDemoContent("html"),
    editable: true,
    showPrint: true,
  },
};

export const Markdown: Story = {
  args: {
    format: "markdown",
    content: textEditorDemoContent("markdown"),
    editable: true,
    showPrint: true,
  },
};

export const ReadOnlyMarkdown: Story = {
  name: "Read only markdown",
  args: {
    format: "markdown",
    content: textEditorDemoContent("markdown"),
    editable: false,
    showPrint: false,
  },
};

export const EmptyMarkdown: Story = {
  name: "Empty markdown",
  args: {
    format: "markdown",
    content: "",
    editable: true,
    placeholder: "Start writing, or type / for blocks…",
    showPrint: false,
  },
};

export const TaskList: Story = {
  name: "Task list",
  tags: ["vitest-ci"],
  args: {
    format: "markdown",
    content: "## Task list\n\n- [ ] Unchecked item\n- [x] Checked item\n",
    editable: true,
    showPrint: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const boxes = await canvas.findAllByRole("checkbox");
    await expect(boxes).toHaveLength(2);
    await expect(boxes[0]).not.toBeChecked();
    await expect(boxes[1]).toBeChecked();
    await userEvent.click(boxes[0]);
    await expect(boxes[0]).toBeChecked();
  },
};

export const MailHtml: Story = {
  name: "Mail HTML toolbar",
  args: {
    format: "html",
    content: "<p>Hello — use the mail toolbar preset.</p>",
    editable: true,
    formatBar: { groups: TEXT_EDITOR_FORMAT_BAR_MAIL, showPrint: false },
  },
};

const sourceToggleRender = (args: ComponentProps<typeof TextEditor>) => (
  <TextEditorWithSourceToggle {...args} />
);

export const HtmlWithSourceToggle: Story = {
  name: "HTML source (external toggle)",
  render: sourceToggleRender,
  args: {
    format: "html",
    content: textEditorDemoContent("html"),
    editable: true,
    showPrint: true,
    viewSource: false,
  },
};

export const MarkdownWithSourceToggle: Story = {
  name: "Markdown source (external toggle)",
  render: sourceToggleRender,
  args: {
    format: "markdown",
    content: textEditorDemoContent("markdown"),
    editable: true,
    showPrint: true,
    viewSource: false,
  },
};

export const MailHtmlWithSourceToggle: Story = {
  name: "Mail HTML source (external toggle)",
  render: sourceToggleRender,
  args: {
    format: "html",
    content: "<p>Hello — use the mail toolbar preset.</p>",
    editable: true,
    formatBar: { groups: TEXT_EDITOR_FORMAT_BAR_MAIL, showPrint: false },
    viewSource: false,
  },
};

export const HtmlSourceSplit: Story = {
  name: "HTML source split",
  args: {
    format: "html",
    content: textEditorDemoContent("html"),
    editable: true,
    showPrint: true,
    viewSource: true,
  },
};

export const MarkdownSourceSplit: Story = {
  name: "Markdown source split",
  args: {
    format: "markdown",
    content: textEditorDemoContent("markdown"),
    editable: true,
    showPrint: true,
    viewSource: true,
  },
};

export const HtmlSourcePortrait: Story = {
  name: "HTML source only (portrait)",
  args: {
    format: "html",
    content: textEditorDemoContent("html"),
    editable: true,
    showPrint: false,
    viewSource: true,
  },
  globals: {
    viewport: { value: "mobile1", isRotated: false },
  },
};

export const MarkdownSourcePortrait: Story = {
  name: "Markdown source only (portrait)",
  args: {
    format: "markdown",
    content: textEditorDemoContent("markdown"),
    editable: true,
    showPrint: false,
    viewSource: true,
  },
  globals: {
    viewport: { value: "mobile1", isRotated: false },
  },
};

export const ReadOnlyMarkdownSource: Story = {
  name: "Read only markdown source",
  args: {
    format: "markdown",
    content: textEditorDemoContent("markdown"),
    editable: false,
    showPrint: false,
    viewSource: true,
  },
};

export const EmptyMarkdownSourceSplit: Story = {
  name: "Empty markdown source split",
  args: {
    format: "markdown",
    content: "",
    editable: true,
    placeholder: "Start writing, or type / for blocks…",
    showPrint: false,
    viewSource: true,
  },
};
