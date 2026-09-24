import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { DocsCollabPresence, type DocsCollabPresenceProps } from "./docs-collab-presence";

import "@/text-editor-core/docs-collab/docs-collab-presence-chrome.css";

export type DocsCollabPresenceChromeProps = DocsCollabPresenceProps;

/**
 * Shared footer collab chrome: Users icon + “Online collaborators” tooltip +
 * {@link DocsCollabPresence}. Used by Notes and Docs detail footers.
 */
export function DocsCollabPresenceChrome({
  className,
  ...presenceProps
}: DocsCollabPresenceChromeProps) {
  return (
    <div className={cn("docs-collab-presence-chrome", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="docs-collab-presence-chrome__icon-trigger"
            aria-label="Online collaborators"
          >
            <Users className="docs-collab-presence-chrome__icon" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>Online collaborators</TooltipContent>
      </Tooltip>
      <DocsCollabPresence {...presenceProps} />
    </div>
  );
}
