import { useMemo } from "react";
import { Table2 } from "lucide-react";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import type { SpreadsheetUILabels } from "@/spreadsheet-core/src/spreadsheet-labels";
import type { ParsedSheet } from "@/spreadsheet-core/src/ycsv/ycsv";

type SpreadsheetSheetsSidebarProps = {
  labels: SpreadsheetUILabels;
  sheets: ParsedSheet[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd?: () => void;
};

export function SpreadsheetSheetsSidebar({
  labels,
  sheets,
  activeIndex,
  onSelect,
  onAdd,
}: SpreadsheetSheetsSidebarProps) {
  const items = useMemo((): MenuItemProps[] => {
    if (sheets.length === 0) return [{ label: labels.sheetsEmpty }];
    return sheets.map((sheet, index) => ({
      label: sheet.name || sheet.ref,
      icon: <Table2 className="size-4" />,
      selected: index === activeIndex,
      onClick: () => onSelect(index),
    }));
  }, [activeIndex, labels.sheetsEmpty, onSelect, sheets]);

  return (
    <SidebarSection
      title={labels.sidebarSheets}
      items={items}
      onAdd={onAdd}
      addLabel={labels.newSheet}
    />
  );
}
