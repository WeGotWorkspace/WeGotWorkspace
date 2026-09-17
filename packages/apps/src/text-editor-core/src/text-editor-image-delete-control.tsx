import { Trash2 } from "lucide-react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { IconButton } from "@/button/src/icon-button";
import { TooltipProvider } from "@/ui/tooltip";

export const DOCS_IMAGE_DELETE_LABEL = "Delete image";

export type TextEditorImageDeleteControlProps = {
  onDelete: () => void;
};

export function TextEditorImageDeleteControl({ onDelete }: TextEditorImageDeleteControlProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <IconButton
        type="button"
        label={DOCS_IMAGE_DELETE_LABEL}
        icon={<Trash2 aria-hidden />}
        size="xs"
        variant="outline"
        severity="danger"
        className="text-editor-image__delete no-print"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDelete();
        }}
      />
    </TooltipProvider>
  );
}

export function mountTextEditorImageDeleteControl(
  host: HTMLElement,
  props: TextEditorImageDeleteControlProps,
): Root {
  const root = createRoot(host);
  flushSync(() => {
    root.render(<TextEditorImageDeleteControl {...props} />);
  });
  return root;
}
