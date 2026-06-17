import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { textEditorSourceLines } from "@/text-editor-core/src/text-editor-source-lines";
import {
  applyTextEditorSourceEnterEdit,
  applyTextEditorSourceTabEdit,
} from "@/text-editor-core/src/text-editor-source-tab";

export { textEditorSourceLineCount } from "@/text-editor-core/src/text-editor-source-lines";

export type TextEditorSourceProps = {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  editable?: boolean;
  /** Shown in `aria-label` (e.g. HTML or Markdown). */
  formatLabel?: string;
  /** When true, Tab inserts spaces at the caret instead of moving focus. */
  indentWithSpaces?: boolean;
  /**
   * When true, Enter splits the line and copies leading whitespace to the new line.
   * Defaults to the value of `indentWithSpaces`.
   */
  autoIndentOnEnter?: boolean;
  /** Spaces inserted per Tab when `indentWithSpaces` is enabled. Defaults to 2. */
  tabSize?: number;
  /** When true, Escape blurs the textarea (for use with trapped Tab indent). */
  escapeToBlur?: boolean;
  /** Called after Escape blurs the textarea; use to restore focus elsewhere. */
  onEscapeBlur?: () => void;
  className?: string;
};

/**
 * Plain-text source editor with a scroll-synced line-number gutter.
 * Long logical lines wrap; gutter row height follows wrapped line height.
 */
export function TextEditorSource({
  value,
  onChange,
  onFocus,
  onBlur,
  editable = true,
  formatLabel = "source",
  indentWithSpaces = false,
  autoIndentOnEnter,
  tabSize = 2,
  escapeToBlur = false,
  onEscapeBlur,
  className,
}: TextEditorSourceProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  const lines = useMemo(() => textEditorSourceLines(value), [value]);

  const inputAriaLabel = escapeToBlur
    ? `${formatLabel} source. Press Escape to exit.`
    : `${formatLabel} source`;

  const measureLineHeights = useCallback(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    const rowElements = mirror.querySelectorAll<HTMLElement>(".text-editor-source__mirror-line");
    const heights = Array.from(rowElements).map((row) => row.getBoundingClientRect().height);
    setLineHeights((previous) => {
      if (
        previous.length === heights.length &&
        previous.every((height, index) => Math.abs(height - heights[index]!) < 0.5)
      ) {
        return previous;
      }
      return heights;
    });
  }, []);

  useLayoutEffect(() => {
    measureLineHeights();
  }, [lines, measureLineHeights]);

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    if (!pending || !textarea) return;
    textarea.selectionStart = pending.start;
    textarea.selectionEnd = pending.end;
    pendingSelectionRef.current = null;
  }, [value]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const observer = new ResizeObserver(() => measureLineHeights());
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [measureLineHeights]);

  const syncGutterScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const gutter = gutterRef.current;
    if (!textarea || !gutter) return;
    gutter.scrollTop = textarea.scrollTop;
  }, []);

  const shouldAutoIndentOnEnter = autoIndentOnEnter ?? indentWithSpaces;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!editable) return;

      if (escapeToBlur && event.key === "Escape") {
        event.preventDefault();
        textareaRef.current?.blur();
        onEscapeBlur?.();
        return;
      }

      const textarea = textareaRef.current;
      if (!textarea) return;

      if (shouldAutoIndentOnEnter && event.key === "Enter") {
        event.preventDefault();

        const result = applyTextEditorSourceEnterEdit(
          value,
          textarea.selectionStart,
          textarea.selectionEnd,
        );

        pendingSelectionRef.current = {
          start: result.selectionStart,
          end: result.selectionEnd,
        };
        onChange(result.value);
        return;
      }

      if (!indentWithSpaces || event.key !== "Tab") return;

      event.preventDefault();

      const result = applyTextEditorSourceTabEdit(
        value,
        textarea.selectionStart,
        textarea.selectionEnd,
        tabSize,
        event.shiftKey,
      );

      pendingSelectionRef.current = {
        start: result.selectionStart,
        end: result.selectionEnd,
      };
      onChange(result.value);
    },
    [
      editable,
      escapeToBlur,
      indentWithSpaces,
      onChange,
      onEscapeBlur,
      shouldAutoIndentOnEnter,
      tabSize,
      value,
    ],
  );

  return (
    <div className={cn("text-editor-source", className)}>
      <div className="text-editor-source__layout">
        <div ref={gutterRef} className="text-editor-source__gutter" aria-hidden>
          {lines.map((_, index) => (
            <div
              key={index}
              className="text-editor-source__gutter-line"
              style={
                lineHeights[index] != null ? { minHeight: `${lineHeights[index]}px` } : undefined
              }
            >
              {index + 1}
            </div>
          ))}
        </div>
        <div className="text-editor-source__input-wrap">
          <textarea
            ref={textareaRef}
            className="text-editor-source__input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onScroll={syncGutterScroll}
            onKeyDown={handleKeyDown}
            onFocus={onFocus}
            onBlur={onBlur}
            readOnly={!editable}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="soft"
            aria-label={inputAriaLabel}
            aria-keyshortcuts={escapeToBlur ? "Escape" : undefined}
          />
          <div ref={mirrorRef} className="text-editor-source__mirror" aria-hidden>
            {lines.map((line, index) => (
              <div key={index} className="text-editor-source__mirror-line">
                {line.length > 0 ? line : "\u00a0"}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
