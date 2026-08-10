import type { ReactNode, RefObject } from "react";
import { useEffect, useState } from "react";
import { WorkspaceSidebarToggle } from "@/workspace-shell/src/workspace-app-layout";
import { CollectionSearchInput } from "@/collection-search-input/src/collection-search-input";
import { cn } from "@/lib/utils";

import "./view-header.css";

type ViewHeaderTitleSize = "default" | "sm";

type ViewHeaderProps = {
  title: string;
  /** "default" = large serif display; "sm" = medium sans-serif title (e.g. doc editor file name). */
  titleSize?: ViewHeaderTitleSize;
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
  titleSize = "default",
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
      <div className="flex items-start gap-3">
        {hideSidebarToggle ? null : (
          <WorkspaceSidebarToggle open={sidebarOpen} onToggle={onToggleSidebar ?? (() => {})} />
        )}
        <div className="view-header__main">
          <div className="view-header__title-row">
            <h2
              className={cn("view-header__title", titleSize === "sm" && "view-header__title--sm")}
            >
              {title}
            </h2>
            <div className="view-header__actions">{actions}</div>
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
