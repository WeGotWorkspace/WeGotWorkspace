import { Tag } from "@/tag/src/tag";
import type { SpreadsheetController } from "@/spreadsheet-core/src/use-spreadsheet-controller";

export function SpreadsheetStatsFooter({ controller }: { controller: SpreadsheetController }) {
  if (!controller.hasFile) return null;

  return (
    <footer className="spreadsheet-workspace__stats-footer" aria-live="polite">
      <div className="spreadsheet-workspace__stats-tags">
        <Tag
          label={controller.labels.statsColumns(controller.columnCount)}
          colors={{
            backgroundColor: "var(--spreadsheet-stat-tag-bg)",
            color: "var(--spreadsheet-stat-tag-color)",
          }}
        />
        <Tag
          label={controller.labels.statsRows(controller.rowCount)}
          colors={{
            backgroundColor: "var(--spreadsheet-stat-tag-bg)",
            color: "var(--spreadsheet-stat-tag-color)",
          }}
        />
      </div>
    </footer>
  );
}
