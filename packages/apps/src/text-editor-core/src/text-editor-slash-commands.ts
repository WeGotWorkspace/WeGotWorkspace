import type { ComponentType } from "react";
import type { Editor } from "@tiptap/react";
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  SeparatorHorizontal,
  Table as TableIcon,
  Text,
} from "lucide-react";

export type SlashCommand = {
  title: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string;
  run: (editor: Editor) => void;
};

function getSlashRange(editor: Editor) {
  const { from } = editor.state.selection;
  const text = editor.state.doc.textBetween(Math.max(0, from - 50), from, "\n", "\0");
  const idx = text.lastIndexOf("/");
  if (idx < 0) return { from, to: from };
  return { from: from - (text.length - idx), to: from };
}

const BASE_SLASH_COMMANDS: SlashCommand[] = [
  {
    title: "Heading 1",
    desc: "Big section title",
    icon: Heading1,
    keywords: "h1 title",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    desc: "Medium heading",
    icon: Heading2,
    keywords: "h2",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    desc: "Small heading",
    icon: Heading3,
    keywords: "h3",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Paragraph",
    desc: "Plain text",
    icon: Text,
    keywords: "p text",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).setParagraph().run(),
  },
  {
    title: "Bulleted list",
    desc: "Simple bulleted list",
    icon: List,
    keywords: "ul bullet",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    desc: "Ordered list",
    icon: ListOrdered,
    keywords: "ol number",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleOrderedList().run(),
  },
  {
    title: "Task list",
    desc: "Checkbox to-dos",
    icon: ListChecks,
    keywords: "todo task check",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleTaskList().run(),
  },
  {
    title: "Quote",
    desc: "Capture a quote",
    icon: Quote,
    keywords: "blockquote",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleBlockquote().run(),
  },
  {
    title: "Divider",
    desc: "Visual separator",
    icon: Minus,
    keywords: "hr rule line",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).setHorizontalRule().run(),
  },
  {
    title: "Code block",
    desc: "Syntax-highlighted code",
    icon: Code2,
    keywords: "code pre",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleCodeBlock().run(),
  },
  {
    title: "Table",
    desc: "3×3 table with header",
    icon: TableIcon,
    keywords: "grid",
    run: (e) =>
      e
        .chain()
        .focus()
        .deleteRange(getSlashRange(e))
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
];

const PAGE_BREAK_COMMAND: SlashCommand = {
  title: "Page break",
  desc: "Start a new page",
  icon: SeparatorHorizontal,
  keywords: "page break new page",
  run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).setPageBreak().run(),
};

export type SlashCommandOptions = {
  /** Image: opens the Docs Drive picker. */
  onInsertImage?: () => void;
  /** Docs only: Page break (#1616). */
  pageBreak?: boolean;
};

/** Base blocks plus the items only some hosts want (Docs: Image, Page break). */
export function slashCommands({ onInsertImage, pageBreak }: SlashCommandOptions = {}) {
  const commands = [...BASE_SLASH_COMMANDS];
  if (pageBreak) commands.push(PAGE_BREAK_COMMAND);
  if (onInsertImage) {
    commands.push({
      title: "Image",
      desc: "Upload or choose from Drive",
      icon: ImageIcon,
      keywords: "image photo picture media",
      run: (e) => {
        e.chain().focus().deleteRange(getSlashRange(e)).run();
        onInsertImage();
      },
    });
  }
  return commands;
}
