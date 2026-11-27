import * as React from "react";
import { TextareaAutosize, type TextareaAutosizeProps } from "./textarea-autosize";
import { hasLinks } from "@/lib/linkify/linkify-text";
import { LinkifiedText } from "@/lib/linkify/linkified-text";

/**
 * A notes field that shows links until you type. While the field is not focused and its text
 * contains a link, an overlay with the same box, padding and font shows the text with
 * clickable links. A click on a link opens it; a click anywhere else, or tabbing in, focuses the
 * textarea underneath (caret at the end). The textarea is always mounted, so typing,
 * autosave, undo and the accessible name behave exactly as for a plain textarea.
 */
export const LinkifiedTextarea = React.forwardRef<HTMLTextAreaElement, TextareaAutosizeProps>(
  ({ className, style, value, onFocus, onBlur, disabled, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const [focused, setFocused] = React.useState(false);
    const text = typeof value === "string" ? value : "";
    const showLinks = !focused && !disabled && hasLinks(text);

    const setRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const startEditing = (event: React.MouseEvent) => {
      // A link opens; anything else in the field starts editing.
      if ((event.target as HTMLElement).closest("a")) return;
      event.preventDefault();
      const field = innerRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    };

    return (
      <div style={{ position: "relative", flex: "1 1 auto", minWidth: 0, width: "100%" }}>
        {showLinks ? (
          // The textarea stays the accessible field; this layer only paints the links.
          <div
            role="presentation"
            data-linkified-view
            onMouseDown={startEditing}
            style={{ position: "absolute", inset: 0, overflow: "hidden", cursor: "text" }}
          >
            <LinkifiedText
              text={text}
              className={className}
              style={{ background: "transparent", borderColor: "transparent", minHeight: 0 }}
            />
          </div>
        ) : null}
        <TextareaAutosize
          {...props}
          ref={setRef}
          className={className}
          value={value}
          disabled={disabled}
          style={showLinks ? { ...style, color: "transparent" } : style}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
        />
      </div>
    );
  },
);
LinkifiedTextarea.displayName = "LinkifiedTextarea";
