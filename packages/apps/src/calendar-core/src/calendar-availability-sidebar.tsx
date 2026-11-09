import { useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { Input } from "@/ui/input";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import type { JmapTeamMember } from "@/lib/jmap-client/availability/types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  availabilityColor,
  availabilityColorToken,
} from "@/calendar-core/src/calendar-availability-overlay";
import type { TeamAvailabilityState } from "@/calendar-core/src/use-team-availability";
import "./calendar-availability-sidebar.css";

/** A filter shows once the section has more rows than this. */
export const TEAM_AVAILABILITY_FILTER_THRESHOLD = 8;

type SidebarLabels = Pick<
  CalendarUILabels,
  | "teamAvailabilitySection"
  | "teamAvailabilitySelf"
  | "teamAvailabilityShow"
  | "teamAvailabilityHide"
  | "teamAvailabilityShowSelf"
  | "teamAvailabilityHideSelf"
  | "teamAvailabilityFilter"
  | "teamAvailabilityNoMatch"
  | "teamAvailabilityIncomplete"
  | "teamAvailabilityCollapse"
  | "teamAvailabilityExpand"
>;

export type CalendarAvailabilitySidebarProps = {
  /** Members null or empty renders nothing. */
  availability: Pick<
    TeamAvailabilityState,
    "members" | "shownIds" | "incompleteIds" | "collapsed" | "toggleShown" | "toggleCollapsed"
  > &
    Partial<Pick<TeamAvailabilityState, "colors">>;
  labels: SidebarLabels;
};

function rowName(member: JmapTeamMember, labels: SidebarLabels): string {
  return member.isSelf ? labels.teamAvailabilitySelf : member.name;
}

/** "Show/Hide {name}'s availability"; the own row reads "your own availability". */
function visibilityLabel(member: JmapTeamMember, shown: boolean, labels: SidebarLabels): string {
  if (member.isSelf) {
    return shown ? labels.teamAvailabilityHideSelf : labels.teamAvailabilityShowSelf;
  }
  return shown
    ? labels.teamAvailabilityHide(member.name)
    : labels.teamAvailabilityShow(member.name);
}

/**
 * Team availability, after Shared with me (#1910). One row per teammate who
 * shares with the user, hidden by default; ticking one paints their busy
 * blocks on the grid. Collapsible, with a filter above eight rows.
 */
export function CalendarAvailabilitySidebar({
  availability,
  labels,
}: CalendarAvailabilitySidebarProps) {
  const { members, shownIds, incompleteIds, collapsed, colors } = availability;
  const onToggleShown = availability.toggleShown;
  const [filter, setFilter] = useState("");
  const showFilter = (members?.length ?? 0) > TEAM_AVAILABILITY_FILTER_THRESHOLD;
  const query = showFilter ? filter.trim().toLocaleLowerCase() : "";
  const rows = useMemo(
    () =>
      (members ?? []).filter(
        (member) =>
          !query ||
          member.name.toLocaleLowerCase().includes(query) ||
          member.id.toLocaleLowerCase().includes(query),
      ),
    [members, query],
  );
  if (!members || members.length === 0) return null;

  return (
    <SidebarSection
      title={labels.teamAvailabilitySection}
      className="calendar-availability-sidebar"
      collapsed={collapsed}
      onToggleCollapsed={availability.toggleCollapsed}
      collapseLabel={labels.teamAvailabilityCollapse}
      expandLabel={labels.teamAvailabilityExpand}
      beforeList={
        showFilter ? (
          <div className="calendar-availability-sidebar__filter">
            <Input
              type="search"
              variant="search"
              size="sm"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={labels.teamAvailabilityFilter}
              aria-label={labels.teamAvailabilityFilter}
            />
          </div>
        ) : null
      }
    >
      {rows.map((member) => {
        const name = rowName(member, labels);
        const shown = shownIds.has(member.id);
        return (
          <CollectionSidebarRow
            key={member.id}
            blockName="calendar-sidebar-row"
            className="calendar-availability-sidebar__row"
            name={name}
            color={availabilityColor(member.id, colors)}
            visible={shown}
            visibilityLabel={visibilityLabel(member, shown, labels)}
            onToggleVisibility={() => onToggleShown(member.id)}
            nameLeading={
              <UserAvatar
                displayName={member.name}
                compact
                size="xs"
                color={availabilityColorToken(member.id, colors)}
                className="calendar-availability-sidebar__avatar"
              />
            }
            badges={
              shown && incompleteIds.has(member.id) ? (
                <CollectionSidebarMark
                  label={labels.teamAvailabilityIncomplete}
                  className="calendar-availability-sidebar__incomplete"
                >
                  <CircleAlert className="size-3.5" aria-hidden />
                </CollectionSidebarMark>
              ) : null
            }
          />
        );
      })}
      {rows.length === 0 ? (
        <li className="calendar-availability-sidebar__empty">{labels.teamAvailabilityNoMatch}</li>
      ) : null}
    </SidebarSection>
  );
}
