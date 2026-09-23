import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { textEditorSourceLines } from "@/text-editor-core/src/text-editor-source-lines";

export { textEditorSourceLineCount } from "@/text-editor-core/src/text-editor-source-lines";

export type TextEditorSourceProps = {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  editable?: boolean;
  /** Shown in `aria-label` (e.g. HTML or Markdown). */
  formatLabel?: string;
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
  className,
}: TextEditorSourceProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  const lines = useMemo(() => textEditorSourceLines(value), [value]);

  const measureLineHeights = useCallback(() => {
    const mirror = mirrorRef.current;
    const textarea = textareaRef.current;
    if (!mirror || !textarea || textarea.clientWidth === 0) return;
    // Match the textarea's content box, excluding the scrollbar, so wrap points agree.
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.right = "auto";
    const rowElements = mirror.querySelectorAll<HTMLElement>(".text-editor-source__mirror-line");
    const heights = Array.from(rowElements, (row) => row.getBoundingClientRect().height);
    if (heights.length === 0 || heights.some((height) => height <= 0)) return;
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
    const textarea = textareaRef.current;
    if (!textarea) return;
    const observer = new ResizeObserver(() => measureLineHeights());
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [measureLineHeights]);

  useLayoutEffect(() => {
    const fonts = document.fonts;
    if (!fonts?.ready) return;
    let cancelled = false;
    void fonts.ready.then(() => {
      if (!cancelled) measureLineHeights();
    });
    return () => {
      cancelled = true;
    };
  }, [measureLineHeights, lines]);

  const syncGutterScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const gutter = gutterRef.current;
    if (!textarea || !gutter) return;
    gutter.scrollTop = textarea.scrollTop;
  }, []);

  useLayoutEffect(() => {
    syncGutterScroll();
  }, [lineHeights, syncGutterScroll]);

  return (
    <div className={cn("text-editor-source", className)}>
      <div className="text-editor-source__layout">
        <div ref={gutterRef} className="text-editor-source__gutter" aria-hidden>
          {lines.map((_, index) => (
            <div
              key={index}
              className="text-editor-source__gutter-line"
              style={lineHeights[index] != null ? { height: `${lineHeights[index]}px` } : undefined}
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
            onFocus={onFocus}
            onBlur={onBlur}
            readOnly={!editable}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="soft"
            aria-label={`${formatLabel} source`}
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
