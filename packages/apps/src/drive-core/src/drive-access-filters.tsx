import { cn } from "@/lib/utils";
import type { DriveAccessFilter } from "@/drive-core/src/drive-access-utils";
import type { DriveAccessController } from "@/drive-core/src/use-drive-access-controller";

type DriveAccessFiltersProps = {
  controller: DriveAccessController;
};

const FILTER_OPTIONS: { id: DriveAccessFilter; labelKey: keyof DriveAccessController["labels"] }[] =
  [
    { id: "all", labelKey: "accessFilterAll" },
    { id: "external", labelKey: "accessFilterExternal" },
    { id: "public", labelKey: "accessFilterPublic" },
    { id: "groups", labelKey: "accessFilterGroups" },
  ];

export function DriveAccessFilters({ controller }: DriveAccessFiltersProps) {
  const { labels, filter, setFilter } = controller;

  return (
    <div className="drive-access-filters" role="group" aria-label="Filter grants">
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={cn(
            "drive-access-filters__chip",
            filter === option.id && "drive-access-filters__chip--active",
          )}
          aria-pressed={filter === option.id}
          onClick={() => setFilter(option.id)}
        >
          {labels[option.labelKey]}
        </button>
      ))}
    </div>
  );
}
