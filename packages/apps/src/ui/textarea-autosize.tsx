import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaAutosizeProps = React.ComponentProps<"textarea"> & {
  minRows?: number;
  maxRows?: number;
};

function getVerticalPadding(element: HTMLTextAreaElement): number {
  const style = window.getComputedStyle(element);
  return parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
}

function getBorderHeight(element: HTMLTextAreaElement): number {
  const style = window.getComputedStyle(element);
  return parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
}

function getLineHeight(element: HTMLTextAreaElement): number {
  const style = window.getComputedStyle(element);
  const lineHeight = parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight)) return lineHeight;
  const fontSize = parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.2 : 16;
}

function resizeTextarea(element: HTMLTextAreaElement, minRows: number, maxRows: number) {
  const lineHeight = getLineHeight(element);
  const padding = getVerticalPadding(element);
  const border = getBorderHeight(element);
  const minHeight = lineHeight * minRows + padding + border;
  const maxHeight = lineHeight * maxRows + padding + border;

  element.style.height = "auto";
  const scrollHeight = element.scrollHeight;
  // `scrollHeight` leaves out the border; the border-box height needs it, or the last
  // line is clipped by the border width.
  const nextHeight = Math.min(Math.max(scrollHeight + border, minHeight), maxHeight);
  element.style.height = `${nextHeight}px`;
  element.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
}

const TextareaAutosize = React.forwardRef<HTMLTextAreaElement, TextareaAutosizeProps>(
  ({ className, minRows = 1, maxRows = 8, value, onChange, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

    const setRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const syncHeight = React.useCallback(() => {
      const element = innerRef.current;
      if (element) resizeTextarea(element, minRows, maxRows);
    }, [minRows, maxRows]);

    React.useLayoutEffect(() => {
      syncHeight();
    }, [value, syncHeight]);

    return (
      <textarea
        ref={setRef}
        className={cn(className)}
        rows={minRows}
        value={value}
        onChange={(event) => {
          onChange?.(event);
          resizeTextarea(event.currentTarget, minRows, maxRows);
        }}
        {...props}
      />
    );
  },
);
TextareaAutosize.displayName = "TextareaAutosize";

export { TextareaAutosize, resizeTextarea };
