import type { CSSProperties, ReactNode } from "react";
import { ChevronRight, Folder, MoreHorizontal } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { cn } from "@/lib/utils";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import "@/path-breadcrumb/src/path-breadcrumb.css";

export type PathBreadcrumbItem = {
  label: string;
  path?: string | null;
  /** Icon of this level in the full-path menu; a folder when not set. */
  icon?: ReactNode;
};

export type PathBreadcrumbProps = {
  items: PathBreadcrumbItem[];
  onNavigate?: (path: string) => void;
  /** Active location; matching crumbs render as current (non-link). */
  currentPath?: string | null;
  /** Paths that stay clickable even when they match {@link currentPath}. */
  alwaysNavigablePaths?: string[];
  className?: string;
  leadingIcon?: ReactNode;
  /** Compact density for dialogs and narrow panes. */
  size?: "default" | "sm";
  /** Name of the menu that holds the hidden middle of a long path. */
  fullPathLabel?: string;
};

/** Longer paths keep the first and the last crumb; the rest sits in a menu between. */
const MAX_VISIBLE_CRUMBS = 3;

export function PathBreadcrumb({
  items,
  onNavigate,
  currentPath,
  alwaysNavigablePaths,
  className,
  leadingIcon,
  size = "default",
  fullPathLabel = "Show full path",
}: PathBreadcrumbProps) {
  const isCurrent = (item: PathBreadcrumbItem, index: number) =>
    item.path == null ||
    (currentPath !== undefined
      ? item.path === currentPath && !alwaysNavigablePaths?.includes(item.path)
      : index === items.length - 1);

  const crumb = (item: PathBreadcrumbItem, index: number) => (
    <span key={`${item.label}-${index}`} className="path-breadcrumb__segment">
      {index > 0 ? <ChevronRight className="path-breadcrumb__separator" /> : null}
      {isCurrent(item, index) ? (
        <span className="path-breadcrumb__current">{item.label}</span>
      ) : (
        <button
          type="button"
          onClick={() => item.path != null && onNavigate?.(item.path)}
          className="path-breadcrumb__link"
        >
          {item.label}
        </button>
      )}
    </span>
  );

  const collapsed = items.length > MAX_VISIBLE_CRUMBS;

  return (
    <nav
      className={cn("path-breadcrumb", size === "sm" && "path-breadcrumb--sm", className)}
      aria-label="Breadcrumb"
    >
      {leadingIcon ? (
        <span className="path-breadcrumb__lead" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      <div className="path-breadcrumb__trail">
        {collapsed ? (
          <>
            {crumb(items[0], 0)}
            <span className="path-breadcrumb__segment path-breadcrumb__segment--menu">
              <ChevronRight className="path-breadcrumb__separator" />
              <DropdownMenu
                trigger={
                  <IconButton
                    label={fullPathLabel}
                    icon={<MoreHorizontal aria-hidden />}
                    size="xs"
                    variant="outline"
                    className="path-breadcrumb__more"
                  />
                }
                items={items.map((item, index) => ({
                  id: `${item.label}-${index}`,
                  label: item.label,
                  icon: item.icon ?? <Folder aria-hidden />,
                  // Each step a little further in, so the menu reads as the path.
                  className: "path-breadcrumb__menu-item",
                  style: { "--path-breadcrumb-depth": index } as CSSProperties,
                  // A label without a path (e.g. Teams) is not where you are, unless it is last.
                  checked:
                    isCurrent(item, index) && (item.path != null || index === items.length - 1),
                  disabled: item.path == null || isCurrent(item, index),
                  onClick: () => item.path != null && onNavigate?.(item.path),
                }))}
              />
            </span>
            {crumb(items[items.length - 1], items.length - 1)}
          </>
        ) : (
          items.map(crumb)
        )}
      </div>
    </nav>
  );
}
