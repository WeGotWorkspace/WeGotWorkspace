import { useMemo, useRef, useState } from "react";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { CalendarInvitationCard } from "@/calendar-core/src/calendar-invitation-card";
import {
  filterInvitationsByTab,
  type CalendarInvitationInboxTab,
} from "@/calendar-core/src/calendar-invitation-event";
import type { CalendarMeetOperations } from "@/calendar-core/src/calendar-meet-link";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type {
  CalendarSchedulingNotification,
  CalendarSchedulingRespondStatus,
} from "@/lib/api/wgw/calendar-scheduling";
import { SegmentedControl } from "@/segmented-control/src/segmented-control";
import { DocsCollabSidebarPanel } from "@/text-editor-core/docs-collab/docs-collab-card";
import "./calendar-invitations-panel.css";

export type CalendarInvitationsPanelProps = {
  notifications: CalendarSchedulingNotification[];
  labels: CalendarUILabels;
  locale: string;
  calendars?: CalendarInfo[];
  defaultCalendarId?: string;
  busy?: boolean;
  activeId?: string | null;
  showCloseButton?: boolean;
  tab?: CalendarInvitationInboxTab;
  onTabChange?: (tab: CalendarInvitationInboxTab) => void;
  onClose: () => void;
  onRespond: (
    id: string,
    status: CalendarSchedulingRespondStatus,
    calendarId?: string,
  ) => void | Promise<void>;
  onOpenEvent?: (eventId: string) => void;
  onSelect?: (id: string) => void;
  meetOperations?: CalendarMeetOperations;
  workspaceOrigin?: string;
  onJoinMeeting?: (href: string) => void;
};

export function CalendarInvitationsPanel({
  notifications,
  labels,
  locale,
  calendars = [],
  defaultCalendarId,
  busy = false,
  activeId = null,
  showCloseButton = false,
  tab: tabProp,
  onTabChange,
  onClose,
  onRespond,
  onOpenEvent,
  onSelect,
  meetOperations,
  workspaceOrigin,
  onJoinMeeting,
}: CalendarInvitationsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [uncontrolledTab, setUncontrolledTab] = useState<CalendarInvitationInboxTab>("new");
  const tab = tabProp ?? uncontrolledTab;
  const visible = useMemo(() => filterInvitationsByTab(notifications, tab), [notifications, tab]);
  const count = visible.length;

  return (
    <DocsCollabSidebarPanel
      className="calendar-invitations-panel"
      ariaLabel={labels.invitationsSection}
      title={labels.invitationsSection}
      titleSize="default"
      closeLabel={labels.invitationsClosePanel}
      onClose={onClose}
      showCloseButton={showCloseButton}
      scrollRef={scrollRef}
      empty={count === 0}
      emptyLabel={tab === "responded" ? labels.invitationsEmptyResponded : labels.invitationsEmpty}
      listClassName="docs-collab-sidebar-panel__list calendar-invitations-panel__list"
      toolbar={
        <SegmentedControl
          value={tab}
          onChange={(next) => {
            if (tabProp === undefined) setUncontrolledTab(next);
            onTabChange?.(next);
          }}
          size="sm"
          className="calendar-invitations-panel__filter"
          aria-label={labels.invitationsFilterAria}
          options={[
            { value: "new", label: labels.invitationsTabNew },
            { value: "responded", label: labels.invitationsTabResponded },
          ]}
        />
      }
    >
      {visible.map((notification) => (
        <CalendarInvitationCard
          key={notification.id}
          notification={notification}
          labels={labels}
          locale={locale}
          calendars={calendars}
          defaultCalendarId={defaultCalendarId}
          active={activeId === notification.id}
          busy={busy}
          onSelect={() => {
            onSelect?.(notification.id);
            if (notification.eventId) onOpenEvent?.(notification.eventId);
          }}
          onRespond={(status, calendarId) => onRespond(notification.id, status, calendarId)}
          meetOperations={meetOperations}
          workspaceOrigin={workspaceOrigin}
          onJoinMeeting={onJoinMeeting}
        />
      ))}
    </DocsCollabSidebarPanel>
  );
}
