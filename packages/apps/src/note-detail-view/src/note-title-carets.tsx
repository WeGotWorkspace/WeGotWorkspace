import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import type { RemoteTitleCaret } from "@/text-editor-core/docs-collab/docs-collab-title-selection";
import { readableTextColorOn } from "@/text-editor-core/docs-collab/docs-collab-utils";
import {
  measureTextareaCarets,
  measureTextareaSelections,
  type TextareaSelectionBox,
} from "@/note-detail-view/src/note-title-caret-geometry";
import "@/note-detail-view/src/note-title-carets.css";

/** A caret to draw, in px relative to the title textarea's border box. */
export type NoteTitleCaretMark = {
  id: number | string;
  name: string;
  color: string;
  left: number;
  top: number;
  height: number;
  /** The participant's selected text, one box per line. Empty for a plain caret. */
  selections?: readonly TextareaSelectionBox[];
};

export type NoteTitleCaretsProps = {
  carets: readonly NoteTitleCaretMark[];
  className?: string;
};

/**
 * Other participants' carets over the note title, with their names and
 * selected text. Decorative: hidden from assistive tech, takes no focus or
 * pointer events.
 */
export function NoteTitleCarets({ carets, className }: NoteTitleCaretsProps) {
  if (carets.length === 0) return null;
  return (
    <div className={cn("note-title-carets", className)} aria-hidden="true">
      {carets.flatMap((caret) =>
        (caret.selections ?? []).map((box, index) => (
          <div
            key={`${caret.id}-selection-${index}`}
            className="note-title-carets__selection"
            data-name={caret.name}
            style={selectionStyle(caret.color, box)}
          />
        )),
      )}
      {carets.map((caret) => (
        <div key={caret.id} className="note-title-carets__caret" style={caretStyle(caret)}>
          <span className="note-title-carets__label">{caret.name}</span>
        </div>
      ))}
    </div>
  );
}

export type NoteTitleCaretsLayerProps = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  carets: readonly RemoteTitleCaret[];
  /** Title text shown in the textarea. A change re-measures the carets. */
  value: string;
};

/**
 * Measures {@link RemoteTitleCaret} indexes against the textarea and draws
 * them. Re-measures when the text, the carets, the size, or the scroll change.
 */
export function NoteTitleCaretsLayer({ textareaRef, carets, value }: NoteTitleCaretsLayerProps) {
  const [marks, setMarks] = useState<NoteTitleCaretMark[]>([]);
  const [layoutVersion, relayout] = useReducer((version: number) => version + 1, 0);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(relayout);
    observer?.observe(element);
    element.addEventListener("scroll", relayout);
    // A web font that loads after the first paint changes every letter width.
    let active = true;
    void element.ownerDocument.fonts?.ready.then(() => active && relayout());
    return () => {
      active = false;
      observer?.disconnect();
      element.removeEventListener("scroll", relayout);
    };
  }, [textareaRef]);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element || carets.length === 0) {
      setMarks((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    const boxes = measureTextareaCarets(
      element,
      carets.map((caret) => caret.head),
    );
    const selections = measureTextareaSelections(
      element,
      carets.map((caret) => ({ start: caret.anchor, end: caret.head })),
    );
    setMarks(
      carets.map((caret, index) => ({
        id: caret.clientId,
        name: caret.name,
        color: caret.color,
        left: boxes[index]?.left ?? 0,
        top: boxes[index]?.top ?? 0,
        height: boxes[index]?.height ?? 0,
        selections: selections[index] ?? [],
      })),
    );
  }, [textareaRef, carets, value, layoutVersion]);

  return <NoteTitleCarets carets={marks} />;
}

function selectionStyle(color: string, box: TextareaSelectionBox): CSSProperties {
  return {
    "--note-title-caret-color": color,
    "--note-title-caret-x": `${box.left}px`,
    "--note-title-caret-y": `${box.top}px`,
    "--note-title-selection-width": `${box.width}px`,
    "--note-title-caret-height": `${box.height}px`,
  } as CSSProperties;
}

function caretStyle(caret: NoteTitleCaretMark): CSSProperties {
  return {
    "--note-title-caret-color": caret.color,
    "--note-title-caret-label-color": readableTextColorOn(caret.color),
    "--note-title-caret-x": `${caret.left}px`,
    "--note-title-caret-y": `${caret.top}px`,
    "--note-title-caret-height": `${caret.height}px`,
  } as CSSProperties;
}
