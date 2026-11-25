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

/** The menu's sections, in display order. */
export const SLASH_GROUPS = [
  { id: "text", label: "Text" },
  { id: "lists", label: "Lists & tasks" },
  { id: "advanced", label: "Advanced" },
] as const;

export type SlashGroupId = (typeof SLASH_GROUPS)[number]["id"];

export type SlashCommand = {
  title: string;
  group: SlashGroupId;
  /** What typing at the start of a line does instead (the editor's input rule), shown as a hint. */
  shortcut?: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string;
  /** The schema node the command makes; a restricted editor without it never offers it. */
  requires?: string;
  run: (editor: Editor) => void;
  /** Hide the item where its command cannot run (default: always offered). */
  isAvailable?: (editor: Editor) => boolean;
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
    requires: "heading",
    group: "text",
    shortcut: "#",
    icon: Heading1,
    keywords: "h1 title",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    requires: "heading",
    group: "text",
    shortcut: "##",
    icon: Heading2,
    keywords: "h2",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    requires: "heading",
    group: "text",
    shortcut: "###",
    icon: Heading3,
    keywords: "h3",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Paragraph",
    group: "text",
    icon: Text,
    keywords: "p text",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).setParagraph().run(),
  },
  {
    title: "Bulleted list",
    requires: "bulletList",
    group: "lists",
    shortcut: "-",
    icon: List,
    keywords: "ul bullet",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    requires: "orderedList",
    group: "lists",
    shortcut: "1.",
    icon: ListOrdered,
    keywords: "ol number",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleOrderedList().run(),
  },
  {
    title: "Task list",
    requires: "taskList",
    group: "lists",
    shortcut: "[ ]",
    icon: ListChecks,
    keywords: "todo task check",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleTaskList().run(),
  },
  {
    title: "Quote",
    requires: "blockquote",
    group: "text",
    shortcut: ">",
    icon: Quote,
    keywords: "blockquote",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleBlockquote().run(),
  },
  {
    title: "Divider",
    requires: "horizontalRule",
    group: "advanced",
    shortcut: "---",
    icon: Minus,
    keywords: "hr rule line",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).setHorizontalRule().run(),
  },
  {
    title: "Code block",
    requires: "codeBlock",
    group: "advanced",
    shortcut: "```",
    icon: Code2,
    keywords: "code pre",
    run: (e) => e.chain().focus().deleteRange(getSlashRange(e)).toggleCodeBlock().run(),
  },
  {
    title: "Table",
    requires: "table",
    group: "advanced",
    shortcut: "3×3",
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
  requires: "pageBreak",
  group: "advanced",
  icon: SeparatorHorizontal,
  keywords: "page break new page",
  // Breaks only go between top-level blocks, not in lists, quotes or tables.
  isAvailable: (e) => e.can().setPageBreak(),
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
      requires: "image",
      group: "advanced",
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

/**
 * The commands split into the menu's sections, in section order (a command keeps its
 * place within its section). Empty sections are left out. Arrow keys walk this order.
 */
export function groupSlashCommands(commands: readonly SlashCommand[]) {
  return SLASH_GROUPS.map((group) => ({
    ...group,
    commands: commands.filter((command) => command.group === group.id),
  })).filter((group) => group.commands.length > 0);
}

/**
 * The commands this editor's schema can make. A restricted editor (a comment or chat
 * composer) offers only its own blocks; "Paragraph" alone is no reason for a menu.
 */
export function slashCommandsForEditor(
  commands: readonly SlashCommand[],
  editor: Editor | null,
): SlashCommand[] {
  if (!editor) return [...commands];
  const available = commands.filter(
    (command) => !command.requires || editor.schema.nodes[command.requires],
  );
  return available.some((command) => command.requires) ? available : [];
}
