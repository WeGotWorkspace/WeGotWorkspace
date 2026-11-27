import { Pencil, Table2, Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { MenuItem } from "@/menu-item/src/menu-item";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import type { SpreadsheetUILabels } from "@/spreadsheet-core/src/spreadsheet-labels";
import type { ParsedSheet } from "@/spreadsheet-core/src/ycsv/ycsv";

type SpreadsheetSheetsSidebarProps = {
  labels: SpreadsheetUILabels;
  sheets: ParsedSheet[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd?: () => void;
  onRename?: (index: number) => void;
  onDelete?: (index: number) => void;
};

export function SpreadsheetSheetsSidebar({
  labels,
  sheets,
  activeIndex,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: SpreadsheetSheetsSidebarProps) {
  const canDeleteSheet = sheets.length > 1;

  return (
    <SidebarSection
      title={labels.sidebarSheets}
      onAdd={onAdd}
      addLabel={labels.newSheet}
      className="spreadsheet-sheets-sidebar"
    >
      {sheets.length === 0 ? (
        <li>
          <MenuItem label={labels.sheetsEmpty} />
        </li>
      ) : (
        sheets.map((sheet, index) => {
          const displayName = sheet.name || sheet.ref;
          return (
            <li key={sheet.ref} className="spreadsheet-sheets-sidebar__item">
              <MenuItem
                label={displayName}
                icon={<Table2 className="size-4" />}
                selected={index === activeIndex}
                onClick={() => onSelect(index)}
                className="spreadsheet-sheets-sidebar__select"
              />
              {onRename || onDelete ? (
                <div className="actions" role="group" aria-label={`${displayName} actions`}>
                  {onRename ? (
                    <IconButton
                      label={labels.renameSheet}
                      icon={<Pencil className="size-3.5" aria-hidden />}
                      size="sm"
                      variant="subtle"
                      showTooltip={false}
                      onClick={() => onRename(index)}
                    />
                  ) : null}
                  {onDelete && canDeleteSheet ? (
                    <IconButton
                      label={labels.deleteSheet}
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                      size="sm"
                      variant="subtle"
                      showTooltip={false}
                      onClick={() => onDelete(index)}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })
      )}
    </SidebarSection>
  );
}
