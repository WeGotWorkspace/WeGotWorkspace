import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarSharePrincipal, CalendarShareWith } from "@/calendar-core/src/calendar-share";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import { CollectionShareSection } from "@/share-ui/collection-share-section";

export type CalendarShareSectionProps = {
  calendar: CalendarInfo;
  labels: CalendarUILabels;
  knownPrincipals?: readonly CalendarSharePrincipal[];
  disabled?: boolean;
  online?: boolean;
  onSearchPrincipals: (query: string) => Promise<CalendarSharePrincipal[]>;
  onPatchShareWith: (calendarId: string, shareWith: CalendarShareWith) => Promise<void>;
};

export function CalendarShareSection({
  calendar,
  labels,
  knownPrincipals = [],
  disabled = false,
  online = true,
  onSearchPrincipals,
  onPatchShareWith,
}: CalendarShareSectionProps) {
  return (
    <CollectionShareSection
      collectionId={calendar.id}
      shareWith={calendar.shareWith}
      knownPrincipals={knownPrincipals}
      disabled={disabled}
      online={online}
      dialogClassName="calendar-dialog-surface"
      copy={{
        title: labels.shareCalendarSectionTitle,
        hint: labels.shareCalendarSectionHint,
        placeholder: labels.shareCalendarAddPlaceholder,
        empty: labels.shareCalendarSearchEmpty,
        offline: labels.shareCalendarOffline,
        removeTitle: labels.removeCalendarShareTitle,
        removeConfirm: labels.removeCalendarShareConfirm,
      }}
      onSearchPrincipals={onSearchPrincipals}
      onPatchShareWith={onPatchShareWith}
    />
  );
}
