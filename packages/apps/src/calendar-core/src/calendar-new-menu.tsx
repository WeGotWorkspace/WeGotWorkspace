import { CalendarPlus, Rss, Upload } from "lucide-react";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import "./calendar-new-menu.css";

export type CalendarNewMenuProps = {
  labels: Pick<
    CalendarUILabels,
    "newEvent" | "newEventMenu" | "createCalendar" | "subscribeCalendar" | "importIcs"
  >;
  onCreateEvent: () => void;
  onCreateCalendar?: () => void;
  onSubscribeCalendar?: () => void;
  onImportEvents?: () => void;
};

export function CalendarNewMenu({
  labels,
  onCreateEvent,
  onCreateCalendar,
  onSubscribeCalendar,
  onImportEvents,
}: CalendarNewMenuProps) {
  const items: DropdownMenuItemProps[] = [];
  if (onCreateCalendar) {
    items.push({
      id: "create-calendar",
      label: labels.createCalendar,
      icon: <CalendarPlus aria-hidden />,
      onClick: onCreateCalendar,
    });
  }
  if (onSubscribeCalendar) {
    items.push({
      id: "subscribe-calendar",
      label: labels.subscribeCalendar,
      icon: <Rss aria-hidden />,
      onClick: onSubscribeCalendar,
    });
  }
  if (onImportEvents) {
    items.push({
      id: "import-ics",
      label: labels.importIcs,
      icon: <Upload aria-hidden />,
      onClick: onImportEvents,
    });
  }

  return (
    <SidebarSegmentedNewMenu
      blockName="calendar-new-menu"
      mainLabel={labels.newEvent}
      menuLabel={labels.newEventMenu}
      onMainAction={onCreateEvent}
      items={items}
    />
  );
}
