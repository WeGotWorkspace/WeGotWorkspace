import type { ReactNode } from "react";
import {
  CalendarDays,
  ContactRound,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  HardDrive,
  Image as ImageIcon,
  LoaderCircle,
} from "lucide-react";
import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import { driveLocationLabel } from "@/drive-core/src/drive-search-utils";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { Tag } from "@/tag/src/tag";
import { cn } from "@/lib/utils";
import "@/unified-search-dropdown/src/unified-search-results-dropdown.css";

type ResultGroup = {
  key: string;
  label: string;
  items: WgwUnifiedSearchResult[];
};

export type UnifiedSearchResultsDropdownProps = {
  query: string;
  results: WgwUnifiedSearchResult[];
  loading?: boolean;
  error?: string | null;
  maxResults?: number;
  className?: string;
  onSelect?: (result: WgwUnifiedSearchResult) => void;
  emptyLabel?: string;
  promptLabel?: string;
};

export function UnifiedSearchResultsDropdown({
  query,
  results,
  loading = false,
  error = null,
  maxResults = 10,
  className,
  onSelect,
  emptyLabel = "No results",
  promptLabel = "Start typing to search",
}: UnifiedSearchResultsDropdownProps) {
  const trimmedQuery = query.trim();
  const limited = results.slice(0, maxResults);
  const groups = groupResults(limited);

  return (
    <div
      className={cn("unified-search-results-dropdown", className)}
      // Grouped result buttons, not listbox options.
      role="group"
      aria-label="Search results"
    >
      {loading ? (
        <div className="unified-search-results-dropdown__state" role="status" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" />
          <span>Searching…</span>
        </div>
      ) : error ? (
        <div className="unified-search-results-dropdown__state">{error}</div>
      ) : trimmedQuery.length < 2 ? (
        <div className="unified-search-results-dropdown__state">{promptLabel}</div>
      ) : limited.length === 0 ? (
        <div className="unified-search-results-dropdown__state">{emptyLabel}</div>
      ) : (
        <div className="unified-search-results-dropdown__groups">
          {groups.map((group) => (
            <SidebarSection
              key={group.key}
              title={group.label}
              className="unified-search-results-dropdown__group"
              items={groupItems(group, onSelect)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function groupResults(results: WgwUnifiedSearchResult[]): ResultGroup[] {
  const files = results.filter((item) => item.sourceType === "file");
  const notes = results.filter((item) => item.sourceType === "note");
  const calendars = results.filter((item) => item.sourceType === "caldav");
  const contacts = results.filter((item) => item.sourceType === "carddav");

  const groups: ResultGroup[] = [];
  if (files.length)
    groups.push({
      key: "file",
      label: "Files",
      items: files,
    });
  if (notes.length) {
    groups.push({
      key: "note",
      label: "Notes",
      items: notes,
    });
  }
  if (calendars.length) {
    groups.push({
      key: "caldav",
      label: "Calendars",
      items: calendars,
    });
  }
  if (contacts.length) {
    groups.push({
      key: "carddav",
      label: "Contacts",
      items: contacts,
    });
  }

  return groups;
}

function iconForResult(result: WgwUnifiedSearchResult): ReactNode {
  if (result.sourceType === "caldav") return <CalendarDays className="size-4" />;
  if (result.sourceType === "carddav") return <ContactRound className="size-4" />;
  if (result.sourceType === "note") return <FileText className="size-4" />;
  if (result.category === "folder") return <Folder className="size-4" />;
  if (result.category === "spreadsheet") return <FileSpreadsheet className="size-4" />;
  if (result.category === "image") return <ImageIcon className="size-4" />;
  if (result.category === "document") return <FileText className="size-4" />;
  return <File className="size-4" />;
}

function groupItems(
  group: ResultGroup,
  onSelect?: (result: WgwUnifiedSearchResult) => void,
): MenuItemProps[] {
  return group.items.map((result) => {
    const driveTag = driveTagForResult(result);

    return {
      label: result.title || result.sourceKey,
      description: (
        <span className="unified-search-results-dropdown__item-description">
          {result.snippet?.trim() || result.sourceKey}
        </span>
      ),
      icon: (
        <span
          className={cn(
            "unified-search-results-dropdown__item-icon",
            `unified-search-results-dropdown__item-icon--${result.sourceType}`,
          )}
        >
          {iconForResult(result)}
        </span>
      ),
      badge:
        result.category || driveTag ? (
          <>
            {result.category ? (
              <Tag
                label={result.category}
                colors={{
                  backgroundColor: "var(--unified-search-tag-bg, hsl(0 0% 95%))",
                  color: "var(--unified-search-tag-fg, hsl(0 0% 34%))",
                }}
              />
            ) : null}
            {driveTag ? (
              <Tag
                label={driveTag.label}
                icon={<HardDrive className="size-3" />}
                colors={{
                  backgroundColor: "var(--unified-search-tag-bg, hsl(0 0% 95%))",
                  color: "var(--unified-search-tag-fg, hsl(0 0% 34%))",
                }}
              />
            ) : null}
          </>
        ) : null,
      onClick: () => onSelect?.(result),
      className: cn(
        "unified-search-results-dropdown__menu-item",
        `unified-search-results-dropdown__menu-item--${result.sourceType}`,
      ),
    };
  });
}

function driveTagForResult(result: WgwUnifiedSearchResult): { label: string } | null {
  if (result.sourceType !== "file") return null;
  const label = driveLocationLabel(result.sourceKey);
  return label ? { label } : null;
}
