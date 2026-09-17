import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { Editor } from "@tiptap/react";
import { subscribeEditorLayoutUpdates } from "@/text-editor-core/src/text-editor-overlay-utils";
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
  Table as TableIcon,
  Text,
} from "lucide-react";

type SlashCommand = {
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

function slashCommands(onInsertImage?: () => void): SlashCommand[] {
  if (!onInsertImage) return BASE_SLASH_COMMANDS;
  return [
    ...BASE_SLASH_COMMANDS,
    {
      title: "Image",
      desc: "Upload or choose from Drive",
      icon: ImageIcon,
      keywords: "image photo picture media",
      run: (e) => {
        e.chain().focus().deleteRange(getSlashRange(e)).run();
        onInsertImage();
      },
    },
  ];
}

export type TextEditorSlashMenuProps = {
  editor: Editor | null;
  /** When set, slash offers Image (opens the Docs Drive picker). */
  onInsertImage?: () => void;
};

/** Viewport coordinates for `position: fixed` (portaled to `document.body`). */
function slashMenuPosition(editor: Editor): { top: number; left: number } {
  const { from } = editor.state.selection;
  const coords = editor.view.coordsAtPos(from);
  return {
    top: coords.bottom + 6,
    left: coords.left,
  };
}

function readSlashQuery(editor: Editor): string | null {
  const { from } = editor.state.selection;
  const text = editor.state.doc.textBetween(Math.max(0, from - 50), from, "\n", "\0");
  const match = text.match(/(?:^|\s)\/([\w]*)$/);
  return match ? match[1] : null;
}

export function TextEditorSlashMenu({ editor, onInsertImage }: TextEditorSlashMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const syncSlashMenu = useCallback(() => {
    if (!editor) return;
    const query = readSlashQuery(editor);
    if (query == null) {
      setOpen(false);
      return;
    }
    const nextPos = slashMenuPosition(editor);
    setQuery((previous) => {
      if (previous !== query) setActive(0);
      return query;
    });
    setPos(nextPos);
    setOpen(true);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on("selectionUpdate", syncSlashMenu);
    editor.on("update", syncSlashMenu);
    return () => {
      editor.off("selectionUpdate", syncSlashMenu);
      editor.off("update", syncSlashMenu);
    };
  }, [editor, syncSlashMenu]);

  useEffect(() => {
    if (!open || !editor) return;
    return subscribeEditorLayoutUpdates(editor.view.dom, syncSlashMenu);
  }, [editor, open, syncSlashMenu]);

  const filtered = slashCommands(onInsertImage).filter((c) =>
    (c.title + " " + c.keywords).toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (!open || !editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        if (filtered[active]) {
          e.preventDefault();
          filtered[active].run(editor);
          setOpen(false);
        }
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, filtered, active, editor]);

  if (!open || !pos || !editor || filtered.length === 0) return null;

  return createPortal(
    <div
      ref={containerRef}
      style={{ top: pos.top, left: pos.left }}
      className="text-editor-slash-menu no-print"
    >
      <div className="text-editor-slash-menu__label">Basic blocks</div>
      <ul className="text-editor-slash-menu__list" role="listbox">
        {filtered.map((c, i) => (
          <li
            key={c.title}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              c.run(editor);
              setOpen(false);
            }}
            onMouseEnter={() => setActive(i)}
            className={
              i === active
                ? "text-editor-slash-menu__item text-editor-slash-menu__item--active"
                : "text-editor-slash-menu__item"
            }
          >
            <span className="text-editor-slash-menu__icon" aria-hidden>
              <c.icon className="h-4 w-4" />
            </span>
            <span className="text-editor-slash-menu__copy">
              <span className="text-editor-slash-menu__title">{c.title}</span>
              <span className="text-editor-slash-menu__desc">{c.desc}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
