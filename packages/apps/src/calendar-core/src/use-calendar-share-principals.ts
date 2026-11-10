import { useCallback, useMemo } from "react";
import type { CalendarInvitee } from "@/lib/models/calendar-attendees";
import {
  calendarSharePrincipalsFromDirectory,
  filterCalendarSharePrincipals,
} from "@/calendar-core/src/calendar-share";
import type { CalendarAPIOperations, CalendarUIData } from "@/lib/models/calendar-types";
import { calendarDirectoryGroupsFromBootstrap } from "@/calendar-core/src/calendar-workspace-props";
import { viewerHasNoTeam } from "@/lib/sharing/collection-share";

type UseCalendarSharePrincipalsOptions = {
  data: CalendarUIData;
  invitees: CalendarInvitee[];
  username: string | null | undefined;
  operations?: CalendarAPIOperations;
};

/** People and Teams for the calendar share and attendee pickers, and whether the viewer is in no Team. */
export function useCalendarSharePrincipals({
  data,
  invitees,
  username,
  operations,
}: UseCalendarSharePrincipalsOptions) {
  const directoryGroups = calendarDirectoryGroupsFromBootstrap(data);
  const sharePrincipals = useMemo(
    () =>
      calendarSharePrincipalsFromDirectory({
        invitees,
        groups: directoryGroups,
        excludeUsername: username,
      }),
    [directoryGroups, invitees, username],
  );
  const searchSharePrincipals = useCallback(
    async (query: string) => {
      if (operations?.searchSharePrincipals) {
        return operations.searchSharePrincipals(query);
      }
      return filterCalendarSharePrincipals(query, sharePrincipals);
    },
    [operations, sharePrincipals],
  );
  const noTeam = viewerHasNoTeam(data.groups);
  // Admins without a Team still find everyone, so the attendee note also needs an empty picker (#1924).
  const attendeePickerNoTeam =
    noTeam && !invitees.some((invitee) => invitee.username && invitee.username !== username);

  return { directoryGroups, sharePrincipals, searchSharePrincipals, noTeam, attendeePickerNoTeam };
}
