import type { ReactNode, RefObject } from "react";
import { WorkspaceSidebarToggle } from "@/workspace-shell/src/workspace-app-layout";
import { CollectionSearchInput } from "@/collection-search-input/src/collection-search-input";
import { cn } from "@/lib/utils";
import { DropdownMenu, type DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import { CollectionGhostButton } from "@/ui/collection-ghost-select";
import { useViewHeaderSearchQuery } from "@/view-header/src/use-view-header-search-query";

import "./view-header.css";

type ViewHeaderLayout = "inline" | "stacked" | "responsive";

type ViewHeaderProps = {
  title: string;
  /** Shown instead of `title` when the header main column is narrow. */
  compactTitle?: string;
  /**
   * Title-row layout for `view-header__title-cluster` + `view-header__end`.
   * "inline" (default) = one row; "stacked" = cluster then actions; "responsive" =
   * stacked when the header main column is narrow (container query).
   */
  layout?: ViewHeaderLayout;
  /**
   * Optional control immediately before the title (e.g. mobile Today).
   * Stays with the title in stacked / narrow layouts.
   */
  titlePrefix?: ReactNode;
  /**
   * Optional period controls (e.g. calendar prev/next). Inline: before the
   * title. Stacked / narrow responsive: end of row 2 (after the title).
   */
  titleLeading?: ReactNode;
  /**
   * Optional first-row trailing control (e.g. calendar inbox). Inline: after
   * `actions`. Stacked / narrow responsive: end of row 1.
   */
  titleTrailing?: ReactNode;
  /**
   * Optional control immediately after the title (e.g. list count in parentheses).
   * Stays with the title in stacked / narrow layouts.
   */
  titleSuffix?: ReactNode;
  /**
   * Makes the title a ghost dropdown with these entries (e.g. Calendar: the period
   * views, then Today).
   */
  titleMenu?: DropdownMenuEntry[];
  onTitleMenuOpenChange?: (open: boolean) => void;
  /** When true, omits the workspace sidebar toggle (e.g. portaled compose dialog). */
  hideSidebarToggle?: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  actions?: ReactNode;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchInput?: (query: string) => void;
  searchDebounceMs?: number;
  searchMinLength?: number;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  /** Steps the floating search aside (e.g. during multi-select); it stays mounted, so the query is kept. */
  searchHidden?: boolean;
};

export function ViewHeader({
  title,
  compactTitle,
  layout = "inline",
  titlePrefix,
  titleLeading,
  titleTrailing,
  titleSuffix,
  titleMenu,
  onTitleMenuOpenChange,
  hideSidebarToggle = false,
  sidebarOpen = false,
  onToggleSidebar,
  actions,
  searchPlaceholder,
  searchValue = "",
  onSearchInput,
  searchDebounceMs = 180,
  searchMinLength,
  searchInputRef,
  searchHidden = false,
}: ViewHeaderProps) {
  const { query, setQuery } = useViewHeaderSearchQuery({
    searchValue,
    onSearchInput,
    searchDebounceMs,
    searchMinLength,
  });

  const searchField = searchPlaceholder ? (
    <CollectionSearchInput
      inputRef={searchInputRef}
      value={query}
      onChange={setQuery}
      placeholder={searchPlaceholder}
    />
  ) : null;

  const titleText = compactTitle ? (
    <>
      <span className="view-header__title-full">{title}</span>
      <span className="view-header__title-compact">{compactTitle}</span>
    </>
  ) : (
    title
  );

  return (
    <>
      <div className="view-header">
        {hideSidebarToggle ? null : (
          <div className="view-header__sidebar-toggle">
            <WorkspaceSidebarToggle open={sidebarOpen} onToggle={onToggleSidebar ?? (() => {})} />
          </div>
        )}
        <div className="view-header__main">
          <div
            className={cn(
              "view-header__title-row",
              layout === "stacked" && "view-header__title-row--stacked",
              layout === "responsive" && "view-header__title-row--responsive",
            )}
          >
            <div className="view-header__title-cluster">
              {titleLeading ? (
                <div className="view-header__title-leading">{titleLeading}</div>
              ) : null}
              <div className="view-header__title-block">
                {titlePrefix ? (
                  <div className="view-header__title-prefix">{titlePrefix}</div>
                ) : null}
                <h2
                  className={cn("view-header__title", titleMenu && "view-header__title--menu")}
                  tabIndex={-1}
                >
                  {titleMenu ? (
                    <DropdownMenu
                      items={titleMenu}
                      onOpenChange={onTitleMenuOpenChange}
                      trigger={
                        <CollectionGhostButton
                          className="view-header__title-menu"
                          label={titleText}
                        />
                      }
                    />
                  ) : (
                    titleText
                  )}
                </h2>
                {titleSuffix ? (
                  <div className="view-header__title-suffix">{titleSuffix}</div>
                ) : null}
              </div>
            </div>
            <div className="view-header__end">
              <div className="view-header__actions">{actions}</div>
              {titleTrailing ? (
                <div className="view-header__title-trailing">{titleTrailing}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {searchField ? (
        <div
          className="view-header__search-stack"
          data-hidden={searchHidden ? "true" : undefined}
          inert={searchHidden || undefined}
        >
          {searchField}
        </div>
      ) : null}
    </>
  );
}
