import { CalendarPlus, ChevronDown, Plus, Rss, Upload } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
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

  const mainButton = (
    <Button
      label={labels.newEvent}
      icon={<Plus />}
      onClick={onCreateEvent}
      size="lg"
      pill
      variant="primary"
      className={items.length > 0 ? "calendar-new-menu__main" : "calendar-new-menu__main--solo"}
    />
  );

  if (items.length === 0) return mainButton;

  return (
    <div className="calendar-new-menu">
      {mainButton}
      <DropdownMenu
        align="end"
        trigger={
          <IconButton
            label={labels.newEventMenu}
            icon={<ChevronDown />}
            size="lg"
            variant="primary"
            showTooltip={false}
            className="calendar-new-menu__menu"
          />
        }
        items={items}
      />
    </div>
  );
}
