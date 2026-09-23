import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextEditorSource } from "@/text-editor-core/src/text-editor-source";
import { textEditorDemoContent } from "@/text-editor-core/src/text-editor-fixtures";

import "@/text-editor-core/src/text-editor.css";

const SAMPLE_HTML = textEditorDemoContent("html");
const SAMPLE_MARKDOWN = textEditorDemoContent("markdown");

const LONG_SOURCE = Array.from({ length: 48 }, (_, index) => {
  const line = index + 1;
  return `<p>Line ${line}: Lorem ipsum dolor sit amet.</p>`;
}).join("\n");

function TextEditorSourceDemo(args: ComponentProps<typeof TextEditorSource>) {
  const [value, setValue] = useState(args.value ?? "");

  return (
    <div className="text-editor flex h-[28rem] max-w-3xl flex-col border border-border">
      <TextEditorSource {...args} value={value} onChange={setValue} className="min-h-0 flex-1" />
    </div>
  );
}

const meta = {
  title: "UI/Patterns/TextEditor/Components/TextEditorSource",
  component: TextEditorSource,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Plain-text source field with a scroll-synced line-number gutter. Used inside TextEditor when `viewSource` is enabled.",
      },
    },
  },
  render: (args) => <TextEditorSourceDemo {...args} />,
  argTypes: {
    editable: { control: "boolean" },
    formatLabel: { control: "text" },
  },
} satisfies Meta<typeof TextEditorSource>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Html: Story = {
  args: {
    value: SAMPLE_HTML,
    editable: true,
    formatLabel: "HTML",
  },
};

export const Markdown: Story = {
  args: {
    value: SAMPLE_MARKDOWN,
    editable: true,
    formatLabel: "Markdown",
  },
};

export const Empty: Story = {
  args: {
    value: "",
    editable: true,
    formatLabel: "HTML",
  },
};

export const ReadOnly: Story = {
  name: "Read only",
  args: {
    value: SAMPLE_HTML,
    editable: false,
    formatLabel: "HTML",
  },
};

export const LongDocument: Story = {
  name: "Long document",
  args: {
    value: LONG_SOURCE,
    editable: true,
    formatLabel: "HTML",
  },
};

const LONG_LINE =
  "This is one logical line without line breaks — the gutter should still show a single line number beside it, not wrap to multiple numbers.";

export const LongLine: Story = {
  name: "Long line (no wrap)",
  args: {
    value: `${LONG_LINE}\nSecond line`,
    editable: true,
    formatLabel: "Markdown",
  },
};
