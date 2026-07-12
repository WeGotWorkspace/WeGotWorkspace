import { LoaderCircle } from "lucide-react";
import type { DriveSharePrincipalEntry } from "@wgw-api-generated/drive-types";
import { SharePrincipalMark } from "@/share-ui/share-principal-mark";
import { shareLabels } from "@/share-ui/share-labels";
import { cn } from "@/lib/utils";
import "@/unified-search-dropdown/src/unified-search-results-dropdown.css";

type SharePrincipalSearchDropdownProps = {
  query: string;
  searching: boolean;
  results: DriveSharePrincipalEntry[];
  className?: string;
  onSelect: (entry: DriveSharePrincipalEntry) => void;
};

export function SharePrincipalSearchDropdown({
  query,
  searching,
  results,
  className,
  onSelect,
}: SharePrincipalSearchDropdownProps) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2 && !searching) {
    return null;
  }

  return (
    <div
      className={cn("unified-search-results-dropdown", "anchored-dropdown-panel", className)}
      role="listbox"
      aria-label={shareLabels.teamSectionTitle}
    >
      {searching ? (
        <div className="unified-search-results-dropdown__state" role="status" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" />
          <span>Searching…</span>
        </div>
      ) : results.length === 0 ? (
        <div className="unified-search-results-dropdown__state">No people or groups found</div>
      ) : (
        <div className="share-principal-search-dropdown__list">
          {results.map((entry) => (
            <button
              key={entry.principal}
              type="button"
              role="option"
              className="share-principal-search-dropdown__option"
              onClick={() => onSelect(entry)}
            >
              <SharePrincipalMark
                principalType={entry.principalType}
                displayName={entry.displayName}
              />
              <span className="share-principal-search-dropdown__name">{entry.displayName}</span>
              {entry.memberCount != null ? (
                <span className="share-principal-search-dropdown__meta">
                  {shareLabels.membersSuffix(entry.memberCount)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
