import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Editor } from "@tiptap/react";
import { MenuItem } from "@/menu-item/src/menu-item";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/popover";
import { DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut } from "@/ui/dropdown-menu";
import { subscribeEditorLayoutUpdates } from "@/text-editor-core/src/text-editor-overlay-utils";
import {
  groupSlashCommands,
  slashCommands,
  slashCommandsForEditor,
  type SlashCommandOptions,
} from "@/text-editor-core/src/text-editor-slash-commands";

export type TextEditorSlashMenuProps = SlashCommandOptions & {
  editor: Editor | null;
};

/** The caret as a point the popover can anchor to (viewport coordinates). */
type CaretAnchor = { getBoundingClientRect: () => DOMRect };

function caretAnchor(editor: Editor): CaretAnchor {
  const { from } = editor.state.selection;
  const { left, top, bottom } = editor.view.coordsAtPos(from);
  const rect = new DOMRect(left, top, 0, bottom - top);
  return { getBoundingClientRect: () => rect };
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
  const idPrefix = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<CaretAnchor | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const syncSlashMenu = useCallback(() => {
    if (!editor) return;
    const query = readSlashQuery(editor);
    if (query == null) {
      setOpen(false);
      return;
    }
    setQuery((previous) => {
      if (previous !== query) setActive(0);
      return query;
    });
    setAnchor(caretAnchor(editor));
    setOpen(true);
  }, [editor]);

  const closeSlashMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!editor) return;
    editor.on("selectionUpdate", syncSlashMenu);
    editor.on("update", syncSlashMenu);
    editor.on("blur", closeSlashMenu);
    return () => {
      editor.off("selectionUpdate", syncSlashMenu);
      editor.off("update", syncSlashMenu);
      editor.off("blur", closeSlashMenu);
    };
  }, [editor, syncSlashMenu, closeSlashMenu]);

  useEffect(() => {
    if (!open || !editor) return;
    return subscribeEditorLayoutUpdates(editor.view.dom, syncSlashMenu);
  }, [editor, open, syncSlashMenu]);

  // Sections in display order: the arrow keys walk this flat order.
  const groups = groupSlashCommands(
    slashCommandsForEditor(slashCommands({ onInsertImage, pageBreak }), editor).filter(
      (c) =>
        (c.title + " " + c.keywords).toLowerCase().includes(query.toLowerCase()) &&
        (!editor || !c.isAvailable || c.isAvailable(editor)),
    ),
  );
  const filtered = groups.flatMap((group) => group.commands);
  const visible = open && editor != null && anchor != null && filtered.length > 0;
  const virtualRef = useMemo(() => ({ current: anchor }), [anchor]);

  useEffect(() => {
    if (!visible || !editor) return;
    const onKey = (e: KeyboardEvent) => {
      // Another editor may hold focus (chat edit composer beside the main one).
      if (!editor.view.hasFocus()) return;
      const handled = () => {
        // The menu owns these keys while it is open: a host editor (chat: Enter sends,
        // Escape cancels an edit) must not act on them as well.
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "ArrowDown") {
        handled();
        setActive((a) => (a + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        handled();
        setActive((a) => (a - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        if (filtered[active]) {
          handled();
          filtered[active].run(editor);
          setOpen(false);
        }
      } else if (e.key === "Escape") {
        handled();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [visible, filtered, active, editor]);

  // Arrow keys move the active row; keep it in view in a scrolled list.
  useEffect(() => {
    if (!visible) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, visible]);

  if (!editor) return null;

  let index = -1;
  return (
    <Popover open={visible}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        frost
        side="bottom"
        align="start"
        sideOffset={6}
        className="text-editor-slash-menu no-print"
        // The caret stays in the editor: typing keeps filtering the list.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // Clicks in the editor move the caret, which closes or keeps the menu in sync.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div ref={listRef} role="listbox" aria-label="Insert block">
          {groups.map((group, groupIndex) => {
            const labelId = `${idPrefix}-${group.id}`;
            return (
              <Fragment key={group.id}>
                {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                <div role="group" aria-labelledby={labelId}>
                  <DropdownMenuLabel id={labelId} className="text-editor-slash-menu__label">
                    {group.label}
                  </DropdownMenuLabel>
                  {group.commands.map((c) => {
                    const i = ++index;
                    return (
                      <MenuItem
                        key={c.title}
                        role="option"
                        aria-selected={i === active}
                        data-active={i === active ? "true" : "false"}
                        // Focus stays in the editor; -1 keeps the list reachable for AT.
                        tabIndex={-1}
                        icon={<c.icon className="size-4" />}
                        label={c.title}
                        badge={
                          c.shortcut ? (
                            <DropdownMenuShortcut className="text-editor-slash-menu__shortcut">
                              {c.shortcut}
                            </DropdownMenuShortcut>
                          ) : undefined
                        }
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => {
                          c.run(editor);
                          setOpen(false);
                        }}
                      />
                    );
                  })}
                </div>
              </Fragment>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
