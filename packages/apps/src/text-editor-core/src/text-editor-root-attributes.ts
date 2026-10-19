/** Fallback accessible name for an editable editor with no `ariaLabel` or placeholder. */
export const TEXT_EDITOR_DEFAULT_ARIA_LABEL = "Text editor";

const TEXT_EDITOR_ROOT_CLASS = "text-editor-prose focus:outline-none";

/**
 * Attributes for the ProseMirror root (`editorProps.attributes`).
 *
 * TipTap adds `role="textbox"` when the view is created, but any later `setOptions`
 * (`setEditable`, option updates from `useEditor`) replaces the attributes wholesale, so
 * the role is set here explicitly. Editable editors are a named multi-line textbox;
 * read-only renders (chat bodies, previews) get no textbox role and read as content.
 */
export function textEditorRootAttributes({
  editable,
  ariaLabel,
}: {
  editable: boolean;
  ariaLabel?: string;
}): Record<string, string> {
  if (!editable) return { class: TEXT_EDITOR_ROOT_CLASS, role: "" };
  return {
    class: TEXT_EDITOR_ROOT_CLASS,
    role: "textbox",
    "aria-multiline": "true",
    "aria-label": ariaLabel?.trim() || TEXT_EDITOR_DEFAULT_ARIA_LABEL,
  };
}
