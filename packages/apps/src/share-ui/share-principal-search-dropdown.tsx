import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { SharePrincipalMark, type SharePrincipalKind } from "@/share-ui/share-principal-mark";
import { shareLabels } from "@/share-ui/share-labels";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/popover";
import { cn } from "@/lib/utils";
import "@/unified-search-dropdown/src/unified-search-results-dropdown.css";

export type ShareSearchOption = {
  id: string;
  displayName: string;
  principalType: SharePrincipalKind;
  meta?: string;
};

type SharePrincipalSearchDropdownProps = {
  query: string;
  searching?: boolean;
  results: ShareSearchOption[];
  className?: string;
  emptyLabel?: string;
  listLabel?: string;
  minQueryLength?: number;
  /** Anchor element (typically the search input). */
  children: ReactNode;
  onSelect: (option: ShareSearchOption) => void;
};

export function SharePrincipalSearchDropdown({
  query,
  searching = false,
  results,
  className,
  emptyLabel = "No people or groups found",
  listLabel = shareLabels.teamSectionTitle,
  minQueryLength = 2,
  children,
  onSelect,
}: SharePrincipalSearchDropdownProps) {
  const trimmedQuery = query.trim();
  const open = trimmedQuery.length >= minQueryLength || searching;

  return (
    <Popover open={open} modal={false}>
      <PopoverAnchor asChild>
        <div className="share-dialog__add-grant-field">{children}</div>
      </PopoverAnchor>
      {open ? (
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={0}
          collisionPadding={8}
          className={cn(
            "share-dialog z-[60] max-w-none border-0 bg-transparent p-0 shadow-none outline-none",
            "w-[var(--radix-popover-trigger-width)]",
            "data-[state=open]:animate-none data-[state=closed]:animate-none",
            "unified-search-results-dropdown",
            "share-dialog__principal-search-dropdown",
            className,
          )}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {searching ? (
            <div
              className="unified-search-results-dropdown__state"
              role="status"
              aria-live="polite"
            >
              <LoaderCircle className="size-4 animate-spin" />
              <span>Searching…</span>
            </div>
          ) : results.length === 0 ? (
            <div className="unified-search-results-dropdown__state">{emptyLabel}</div>
          ) : (
            <div
              className="share-principal-search-dropdown__list"
              role="listbox"
              aria-label={listLabel}
            >
              {results.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  className="share-principal-search-dropdown__option"
                  onMouseDown={(event) => {
                    // Keep focus on the input and avoid Dialog treating this as an outside dismiss.
                    event.preventDefault();
                    onSelect(entry);
                  }}
                >
                  <SharePrincipalMark
                    principalType={entry.principalType}
                    displayName={entry.displayName}
                  />
                  <span className="share-principal-search-dropdown__name">{entry.displayName}</span>
                  {entry.meta ? (
                    <span className="share-principal-search-dropdown__meta">{entry.meta}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
