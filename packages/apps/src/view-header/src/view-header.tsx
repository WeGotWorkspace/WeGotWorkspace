import type { ReactNode, RefObject } from "react";
import { useEffect, useState } from "react";
import { WorkspaceSidebarToggle } from "@/workspace-shell/src/workspace-app-layout";
import { CollectionSearchInput } from "@/collection-search-input/src/collection-search-input";
import { cn } from "@/lib/utils";

import "./view-header.css";

type ViewHeaderTitleSize = "default" | "sm";
type ViewHeaderLayout = "inline" | "stacked" | "responsive";

type ViewHeaderProps = {
  title: string;
  /** Shown instead of `title` when the header main column is narrow. */
  compactTitle?: string;
  /** "default" = large serif title (smaller on compact headers); "sm" = medium sans-serif title (e.g. doc editor file name). */
  titleSize?: ViewHeaderTitleSize;
  /**
   * Title-row layout for `view-header__title-cluster` + `view-header__end`.
   * "inline" (default) = one row; "stacked" = cluster then actions; "responsive" =
   * stacked when the header main column is narrow (container query).
   */
  layout?: ViewHeaderLayout;
  /**
   * Optional period controls (e.g. calendar prev/next). Always before the title
   * at the start of the first row (inline, stacked, and narrow responsive).
   */
  titleLeading?: ReactNode;
  /**
   * Optional first-row trailing control (e.g. calendar inbox). Inline: after
   * `actions`. Stacked / narrow responsive: end of row 1 while `actions` wrap.
   */
  titleTrailing?: ReactNode;
  subtitle?: string;
  /** When true, omits the workspace sidebar toggle (e.g. portaled compose dialog). */
  hideSidebarToggle?: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  actions?: ReactNode;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchInput?: (query: string) => void;
  searchDebounceMs?: number;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  searchContent?: ReactNode;
};

export function ViewHeader({
  title,
  compactTitle,
  titleSize = "default",
  layout = "inline",
  titleLeading,
  titleTrailing,
  subtitle,
  hideSidebarToggle = false,
  sidebarOpen = false,
  onToggleSidebar,
  actions,
  searchPlaceholder,
  searchValue = "",
  onSearchInput,
  searchDebounceMs = 180,
  searchInputRef,
  searchContent,
}: ViewHeaderProps) {
  const [query, setQuery] = useState(searchValue);

  useEffect(() => {
    setQuery(searchValue);
  }, [searchValue]);

  useEffect(() => {
    if (!onSearchInput) return;
    const timeout = window.setTimeout(() => onSearchInput(query), searchDebounceMs);
    return () => window.clearTimeout(timeout);
  }, [query, onSearchInput, searchDebounceMs]);

  return (
    <>
      <div className="view-header">
        {hideSidebarToggle ? null : (
          <WorkspaceSidebarToggle open={sidebarOpen} onToggle={onToggleSidebar ?? (() => {})} />
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
              <h2
                className={cn("view-header__title", titleSize === "sm" && "view-header__title--sm")}
              >
                {compactTitle ? (
                  <>
                    <span className="view-header__title-full">{title}</span>
                    <span className="view-header__title-compact">{compactTitle}</span>
                  </>
                ) : (
                  title
                )}
              </h2>
            </div>
            <div className="view-header__end">
              <div className="view-header__actions">{actions}</div>
              {titleTrailing ? (
                <div className="view-header__title-trailing">{titleTrailing}</div>
              ) : null}
            </div>
          </div>
          {subtitle ? (
            <p className={cn("field-label-row__label", "view-header__subtitle")}>{subtitle}</p>
          ) : null}
        </div>
      </div>
      {searchPlaceholder ? (
        <div className="view-header__search-stack anchored-dropdown-anchor">
          <CollectionSearchInput
            inputRef={searchInputRef}
            value={query}
            onChange={setQuery}
            placeholder={searchPlaceholder}
          />
          {searchContent}
        </div>
      ) : null}
    </>
  );
}
