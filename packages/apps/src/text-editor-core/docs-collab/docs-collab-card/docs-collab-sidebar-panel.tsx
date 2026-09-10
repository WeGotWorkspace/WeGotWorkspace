import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { IconButton } from "@/button/src/button";
import { ViewHeader } from "@/view-header/src/view-header";
import "./docs-collab-sidebar-panel.css";

export type DocsCollabSidebarPanelProps = {
  className?: string;
  ariaLabel: string;
  title: string;
  /** Numeric count shown in parentheses beside the title. */
  count?: number;
  /** Accessible label for the count (e.g. "3 open"). */
  countLabel?: string;
  closeLabel: string;
  onClose: () => void;
  /** When true, renders a close action in the panel header (mobile drawer). */
  showCloseButton?: boolean;
  headerActions?: ReactNode;
  /** Control immediately before the title (e.g. Meet thread back). */
  titleLeading?: ReactNode;
  /** Pinned below the title row (filters, segmented controls). */
  toolbar?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  empty?: boolean;
  emptyLabel?: string;
  listClassName?: string;
  children: ReactNode;
};

export function DocsCollabSidebarPanel({
  className,
  ariaLabel,
  title,
  count,
  countLabel,
  closeLabel,
  onClose,
  showCloseButton = false,
  headerActions,
  titleLeading,
  toolbar,
  scrollRef,
  empty = false,
  emptyLabel,
  listClassName = "docs-collab-sidebar-panel__list",
  children,
}: DocsCollabSidebarPanelProps) {
  return (
    <aside
      className={className ? `docs-collab-sidebar-panel ${className}` : "docs-collab-sidebar-panel"}
      aria-label={ariaLabel}
    >
      <header className="docs-collab-sidebar-panel__header">
        <ViewHeader
          hideSidebarToggle
          title={title}
          titleLeading={titleLeading}
          titleSuffix={
            count != null ? (
              <span className="view-header__title-count" aria-label={countLabel ?? String(count)}>
                ({count})
              </span>
            ) : null
          }
          actions={
            headerActions || showCloseButton ? (
              <div className="docs-collab-sidebar-panel__header-actions">
                {headerActions}
                {showCloseButton ? (
                  <IconButton
                    label={closeLabel}
                    icon={<X className="size-4" aria-hidden />}
                    size="sm"
                    variant="outline"
                    showTooltip={false}
                    onClick={onClose}
                  />
                ) : null}
              </div>
            ) : null
          }
        />
        {toolbar ? <div className="docs-collab-sidebar-panel__toolbar">{toolbar}</div> : null}
      </header>

      <div ref={scrollRef} className="docs-collab-sidebar-panel__scroll">
        {empty && emptyLabel ? (
          <p className="docs-collab-sidebar-panel__empty">{emptyLabel}</p>
        ) : (
          <div className={listClassName}>{children}</div>
        )}
      </div>
    </aside>
  );
}
