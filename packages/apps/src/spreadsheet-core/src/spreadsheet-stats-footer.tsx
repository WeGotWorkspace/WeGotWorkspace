import { Plus } from "lucide-react";
import { Button } from "@/button/src/button";
import { Tag } from "@/tag/src/tag";
import type { SpreadsheetController } from "@/spreadsheet-core/src/use-spreadsheet-controller";

export function SpreadsheetStatsFooter({ controller }: { controller: SpreadsheetController }) {
  if (!controller.hasFile) return null;

  return (
    <footer className="spreadsheet-workspace__stats-footer" aria-live="polite">
      <div className="spreadsheet-workspace__sheet-actions">
        <Button
          type="button"
          size="sm"
          variant="subtle"
          icon={<Plus className="size-3.5" aria-hidden />}
          label={controller.labels.addRow}
          onClick={controller.addRow}
        />
        <Button
          type="button"
          size="sm"
          variant="subtle"
          icon={<Plus className="size-3.5" aria-hidden />}
          label={controller.labels.addColumn}
          onClick={controller.addColumn}
        />
      </div>
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
