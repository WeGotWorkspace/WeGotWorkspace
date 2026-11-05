import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { DocsCollabPresence, type DocsCollabPresenceProps } from "./docs-collab-presence";

import "@/text-editor-core/docs-collab/docs-collab-presence-chrome.css";

export type DocsCollabPresenceChromeProps = DocsCollabPresenceProps & {
  /**
   * `header`: round, overlapping avatars with a surface ring and no people glyph,
   * for the Docs header and the Notes detail action bar. Default is the footer look.
   */
  variant?: "footer" | "header";
};

/**
 * Shared collab chrome: Users icon + “Online collaborators” tooltip +
 * {@link DocsCollabPresence}. The `header` variant drops the icon and shows
 * round, overlapping avatars (Docs header, Notes detail action bar).
 */
export function DocsCollabPresenceChrome({
  className,
  variant = "footer",
  ...presenceProps
}: DocsCollabPresenceChromeProps) {
  return (
    <div
      className={cn(
        "docs-collab-presence-chrome",
        variant === "header" && "docs-collab-presence-chrome--header",
        className,
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="docs-collab-presence-chrome__icon-trigger"
            role="img"
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
