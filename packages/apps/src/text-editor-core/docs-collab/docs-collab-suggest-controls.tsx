import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Pencil } from "lucide-react";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import { Button } from "@/button/src/button";
import { ICON_BUTTON_ACTIVE_CLASSNAME } from "@/button/src/button.shared";
import { cn } from "@/lib/utils";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { useAppToast } from "@/hooks/use-app-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import {
  editorHasTrackChanges,
  getTrackChangesMode,
} from "@/text-editor-core/src/text-editor-track-changes";

export type DocsCollabSuggestControlsProps = {
  editor: Editor | null;
  className?: string;
  disabled?: boolean;
  /** Visible label (Tasks show-completed pattern); defaults to “Suggest”. */
  suggestLabel?: string;
  /** Aria/tooltip when Suggest is on (action to leave Suggest); defaults to “Edit”. */
  editLabel?: string;
};

/**
 * Suggest-mode toggle for the Docs collab ViewHeader — outline state Button matching
 * Tasks “Show completed” (active when Suggest is on; icon-only below md).
 */
export function DocsCollabSuggestControls({
  editor,
  className,
  disabled = false,
  suggestLabel = docsLabels.suggestMode,
  editLabel = docsLabels.editMode,
}: DocsCollabSuggestControlsProps) {
  const { show } = useAppToast();
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => setRevision((value) => value + 1);
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
    };
  }, [editor]);

  if (!editorHasTrackChanges(editor)) return null;

  const isSuggest = getTrackChangesMode(editor) === "suggest";
  const actionLabel = isSuggest ? editLabel : suggestLabel;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className={cn(
            "docs-collab-suggest-controls",
            isSuggest && ICON_BUTTON_ACTIVE_CLASSNAME,
            className,
          )}
          label={suggestLabel}
          aria-label={actionLabel}
          onClick={() => {
            if (isSuggest) {
              editor.commands.setEditMode();
              show(docsLabels.toastSwitchedToEditMode);
              return;
            }
            editor.commands.setSuggestMode();
            show(docsLabels.toastSwitchedToSuggestMode);
          }}
          icon={<Pencil aria-hidden />}
          size="sm"
          variant="outline"
          aria-pressed={isSuggest}
          disabled={disabled}
        />
      </TooltipTrigger>
      <TooltipContent>{actionLabel}</TooltipContent>
    </Tooltip>
  );
}
