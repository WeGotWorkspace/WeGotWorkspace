import { DocsDocStatus } from "@/docs-core/src/docs-doc-status";
import type { DocsCollabIndicator } from "@/docs-core/src/collab/docs-collab-indicator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";

export type DocsCollabStatusIndicatorProps = {
  indicator: DocsCollabIndicator;
};

/** The one real-time status line in the Docs detail footer. */
export function DocsCollabStatusIndicator({ indicator }: DocsCollabStatusIndicatorProps) {
  if (!indicator.label) return null;
  const status = <DocsDocStatus status={indicator.label} kind={indicator.kind} />;
  if (!indicator.hint) return status;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{status}</TooltipTrigger>
        <TooltipContent>{indicator.hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
