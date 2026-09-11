import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { IconButton } from "@/button/src/button";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "@/segmented-control/src/segmented-control";
import { ViewHeader } from "@/view-header/src/view-header";
import "./docs-collab-sidebar-panel.css";

/** SideDrawer sheet class: portal wash + outline chrome from `--workspace-accent`. */
export const DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS = "docs-collab-sidebar-panel-drawer";

/** Product-agnostic inbox filter (Calendar New/Responded, Docs Open/Resolved, …). */
export type DocsCollabSidebarPanelFilter<T extends string = string> = {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedControlOption<T>[];
  ariaLabel: string;
  className?: string;
};

export type DocsCollabSidebarPanelProps<T extends string = string> = {
  className?: string;
  ariaLabel: string;
  title: string;
  /** Numeric count shown in parentheses beside the title. */
  count?: number;
  /** Accessible label for the count (e.g. "3 open"). */
  countLabel?: string;
  closeLabel: string;
  onClose: () => void;
  /**
   * Close IconButton at the end of the header action cluster (`titleTrailing`),
   * with gap-3 from preceding `headerActions` / filter. Default true so Calendar,
   * Docs review, Drive, and Meet share the same close placement.
   */
  showCloseButton?: boolean;
  /** Segmented inbox filter rendered in the title-row actions (before close). */
  filter?: DocsCollabSidebarPanelFilter<T>;
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

export function DocsCollabSidebarPanel<T extends string = string>({
  className,
  ariaLabel,
  title,
  count,
  countLabel,
  closeLabel,
  onClose,
  showCloseButton = true,
  filter,
  headerActions,
  titleLeading,
  toolbar,
  scrollRef,
  empty = false,
  emptyLabel,
  listClassName = "docs-collab-sidebar-panel__list",
  children,
}: DocsCollabSidebarPanelProps<T>) {
  const filterControl = filter ? (
    <SegmentedControl
      value={filter.value}
      onChange={filter.onChange}
      options={filter.options}
      size="sm"
      className={
        filter.className
          ? `docs-collab-sidebar-panel__filter ${filter.className}`
          : "docs-collab-sidebar-panel__filter"
      }
      aria-label={filter.ariaLabel}
    />
  ) : null;

  /** Filter + optional leading actions; close sits in titleTrailing (gap-3). */
  const actions =
    filterControl || headerActions ? (
      <div className="docs-collab-sidebar-panel__header-actions">
        {filterControl}
        {headerActions}
      </div>
    ) : null;

  const closeButton = showCloseButton ? (
    <IconButton
      label={closeLabel}
      icon={<X className="size-4" aria-hidden />}
      size="sm"
      variant="outline"
      showTooltip={false}
      onClick={onClose}
    />
  ) : null;

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
          actions={actions}
          titleTrailing={closeButton}
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
