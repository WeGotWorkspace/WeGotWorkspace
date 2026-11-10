import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DestinationPickerListItem = {
  id: string;
  title: string;
  icon: ReactNode;
  selectable: boolean;
  navigable?: boolean;
};

type DestinationPickerListProps = {
  items: DestinationPickerListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen?: (id: string) => void;
};

export function DestinationPickerList({
  items,
  selectedId,
  onSelect,
  onOpen,
}: DestinationPickerListProps) {
  return (
    // Focusable so keyboard users can scroll a long list (axe scrollable-region-focusable).
    <div className="destination-picker__scroll" tabIndex={0}>
      <table className="destination-list-table">
        <tbody>
          {items.map((item) => {
            const isSelected = item.selectable && selectedId === item.id;
            const navigable = item.navigable ?? false;

            return (
              <tr
                key={item.id}
                aria-disabled={!item.selectable}
                onClick={item.selectable ? () => onSelect(item.id) : undefined}
                onDoubleClick={navigable ? () => onOpen?.(item.id) : undefined}
                className={cn(
                  "destination-list-row",
                  item.selectable || navigable
                    ? "cursor-pointer"
                    : "destination-list-row--disabled",
                  isSelected && "destination-list-row--selected",
                )}
              >
                <td className="destination-list-col-name min-w-0 py-2">
                  <div className="flex w-full min-w-0 items-center gap-2.5">
                    <span className="destination-list-destination-icon shrink-0 [&>svg]:size-4">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
