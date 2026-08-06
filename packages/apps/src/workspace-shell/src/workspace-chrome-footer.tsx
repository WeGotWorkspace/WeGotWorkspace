import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "@/workspace-shell/src/workspace-chrome-footer.css";

export type WorkspaceChromeFooterProps = {
  children?: ReactNode;
  /** Trailing status slot (e.g. save indicator), aligned to the end. */
  end?: ReactNode;
  className?: string;
  "aria-live"?: "off" | "polite" | "assertive";
};

/**
 * Pinned detail-pane footer chrome shared by docs stats and notes meta.
 * Product apps supply tag/status children; layout tokens live on the workspace root.
 */
export function WorkspaceChromeFooter({
  children,
  end,
  className,
  "aria-live": ariaLive = "polite",
}: WorkspaceChromeFooterProps) {
  if (children == null && end == null) return null;

  return (
    <footer className={cn("workspace-chrome-footer", className)} aria-live={ariaLive}>
      {children != null ? <div className="workspace-chrome-footer__group">{children}</div> : null}
      {end != null ? (
        <div className="workspace-chrome-footer__group workspace-chrome-footer__group--end">
          {end}
        </div>
      ) : null}
    </footer>
  );
}
