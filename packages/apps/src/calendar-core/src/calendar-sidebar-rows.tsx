import { Circle, Eye, Rss } from "lucide-react";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";
import {
  canOpenCalendarSettings,
  canWriteCalendarCollection,
} from "@/calendar-core/src/calendar-collection-write";
import { isSharedWithMeCalendar } from "@/calendar-core/src/calendar-share";
import { isSubscribedCalendar } from "@/calendar-core/src/calendar-subscription";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";

/** My calendars / Shared with me rows: visibility, create target, edit, marks. */
export function CalendarSidebarRows({
  calendars,
  hiddenCalendarIds,
  defaultCalendarId,
  canDeleteCalendars,
  canUnsubscribe,
  editLabel,
  subscribedLabel,
  viewOnlyLabel,
  pendingCalendarIds,
  pendingSyncLabel,
  onToggleVisibility,
  onSelectDefault,
  onEdit,
}: {
  calendars: CalendarInfo[];
  hiddenCalendarIds: ReadonlySet<string>;
  defaultCalendarId?: string;
  canDeleteCalendars: boolean;
  canUnsubscribe: boolean;
  editLabel: string;
  subscribedLabel: string;
  viewOnlyLabel: string;
  pendingCalendarIds?: ReadonlySet<string>;
  pendingSyncLabel: string;
  onToggleVisibility: (calendarId: string) => void;
  onSelectDefault: (calendarId: string) => void;
  onEdit: (calendarId: string) => void;
}) {
  return (
    <>
      {calendars.map((calendar) => {
        const visible = !hiddenCalendarIds.has(calendar.id);
        const subscribed = isSubscribedCalendar(calendar);
        const viewOnly = !canWriteCalendarCollection(calendar);
        const mayEdit = canOpenCalendarSettings(calendar);
        const mayDelete = subscribed
          ? canUnsubscribe
          : (calendar.mayDelete !== false || isSharedWithMeCalendar(calendar)) &&
            canDeleteCalendars;
        const canManage = mayEdit || mayDelete;
        const selected = calendar.id === defaultCalendarId;
        return (
          <CollectionSidebarRow
            key={calendar.id}
            blockName="calendar-sidebar-row"
            name={calendar.name}
            color={calendar.color}
            selected={selected}
            visible={visible}
            onToggleVisibility={() => onToggleVisibility(calendar.id)}
            onSelect={() => onSelectDefault(calendar.id)}
            onEdit={canManage ? () => onEdit(calendar.id) : undefined}
            editLabel={editLabel}
            badges={
              <>
                {subscribed ? (
                  <CollectionSidebarMark
                    label={subscribedLabel}
                    className="calendar-sidebar-row__subscription"
                  >
                    <Rss className="size-3.5" aria-hidden />
                  </CollectionSidebarMark>
                ) : null}
                {viewOnly && !subscribed ? (
                  <CollectionSidebarMark
                    label={viewOnlyLabel}
                    className="calendar-sidebar-row__readonly"
                  >
                    <Eye className="size-3.5" aria-hidden />
                  </CollectionSidebarMark>
                ) : null}
              </>
            }
            trailing={
              pendingCalendarIds?.has(calendar.id) ? (
                <span
                  className="calendar-sidebar-row__pending-sync"
                  role="img"
                  aria-label={pendingSyncLabel}
                >
                  <Circle className="size-2.5" fill="currentColor" strokeWidth={0} />
                </span>
              ) : null
            }
          />
        );
      })}
    </>
  );
}
