import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Editor } from "@tiptap/react";
import { subscribeEditorLayoutUpdates } from "@/text-editor-core/src/text-editor-overlay-utils";
import {
  slashCommands,
  type SlashCommandOptions,
} from "@/text-editor-core/src/text-editor-slash-commands";

export type TextEditorSlashMenuProps = SlashCommandOptions & {
  editor: Editor | null;
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

export function TextEditorSlashMenu({
  editor,
  onInsertImage,
  pageBreak,
}: TextEditorSlashMenuProps) {
  const labelId = useId();
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

  const filtered = slashCommands({ onInsertImage, pageBreak }).filter((c) =>
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
      <div id={labelId} className="text-editor-slash-menu__label">
        Basic blocks
      </div>
      <ul className="text-editor-slash-menu__list" role="listbox" aria-labelledby={labelId}>
        {filtered.map((c, i) => (
          <li
            key={c.title}
            role="option"
            aria-selected={i === active}
            // Focus stays in the editor; -1 keeps the scrolling list reachable for AT.
            tabIndex={-1}
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
