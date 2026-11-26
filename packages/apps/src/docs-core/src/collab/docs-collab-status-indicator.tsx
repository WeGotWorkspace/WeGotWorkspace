import { DocsDocStatus } from "@/docs-core/src/docs-doc-status";
import type { DocsCollabIndicator } from "@/docs-core/src/collab/docs-collab-indicator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";

export type DocsCollabStatusIndicatorProps = {
  indicator: DocsCollabIndicator;
};

/** The one real-time status line in the Docs detail footer. */
export function DocsCollabStatusIndicator({ indicator }: DocsCollabStatusIndicatorProps) {
  if (!indicator.label) return null;
  if (!indicator.hint) return <DocsDocStatus status={indicator.label} kind={indicator.kind} />;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <DocsDocStatus status={indicator.label} kind={indicator.kind} tabIndex={0} />
        </TooltipTrigger>
        <TooltipContent>{indicator.hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
