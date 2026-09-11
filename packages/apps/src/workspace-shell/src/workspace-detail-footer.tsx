import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WorkspaceChromeFooter } from "@/workspace-shell/src/workspace-chrome-footer";

export type WorkspaceDetailFooterProps = {
  /** Leading slot (e.g. collab presence), aligned left. */
  start?: ReactNode;
  /**
   * Meta tags for the end group (word/char counts, last-edited, …).
   * Rendered before `end` so status can trail the tags.
   */
  tags?: ReactNode;
  /** Trailing status slot (e.g. save indicator). */
  end?: ReactNode;
  className?: string;
  "aria-live"?: "off" | "polite" | "assertive";
};

/**
 * Shared Notes/Docs detail-pane footer: presence (`start`) + product tags + status.
 * Layout tokens still come from the workspace root via `WorkspaceChromeFooter`.
 */
export function WorkspaceDetailFooter({
  start,
  tags,
  end,
  className,
  "aria-live": ariaLive,
}: WorkspaceDetailFooterProps) {
  const endContent =
    tags != null || end != null ? (
      <>
        {tags}
        {end}
      </>
    ) : undefined;

  return (
    <WorkspaceChromeFooter
      className={cn("workspace-detail-footer", className)}
      end={endContent}
      aria-live={ariaLive}
    >
      {start}
    </WorkspaceChromeFooter>
  );
}
