import { useId } from "react";
import { useWatch, type Control } from "react-hook-form";
import { CalendarClock } from "lucide-react";
import { Button } from "@/button/src/button";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import type { CalendarAvailabilitySettingsOperations } from "@/lib/api/wgw/calendar-availability";
import type { CalendarAvailabilityPublicLinkOperations } from "@/lib/api/wgw/calendar-availability-public-link";
import type {
  CalendarAvailabilityDetail,
  CalendarAvailabilityFormValues,
} from "@/settings-core/src/settings-calendar-availability-form";
import { calendarAvailabilityLabels as labels } from "@/settings-core/src/settings-calendar-availability-labels";
import { SettingsCalendarPublicLinkRow } from "@/settings-core/src/settings-calendar-public-link-row";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import {
  useSettingsCalendarAvailability,
  type SettingsCalendarAvailabilityController,
} from "@/settings-core/src/use-settings-calendar-availability";
import {
  useSettingsCalendarPublicLink,
  type SettingsCalendarPublicLinkController,
} from "@/settings-core/src/use-settings-calendar-public-link";
import { Form, FormField } from "@/ui/form";
import { CollectionColorDot } from "@/ui/collection-color-dot";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import type { CalendarAvailabilityCalendar } from "@wgw/openapi-types/calendars-types";
import "./settings-calendar-availability-section.css";

/** Calendar color when the server has none (same fallback as the JMAP calendar mapping). */
const FALLBACK_CALENDAR_COLOR = "#4285f4";

/**
 * Availability in Settings → Calendar (#1912): whether people in the owner's Teams see when
 * they are busy, and per calendar one choice: "Do not add", time only, or (personal calendars
 * only) title and location. Server-side; changes save themselves. Below the calendar list sits the
 * public link (#2406): the same busy times, time only, for people outside the workspace. The
 * calendar choices apply to both, so they show while either is on.
 */
export function SettingsCalendarAvailabilitySection({
  operations,
  publicLinkOperations,
}: {
  /** Stories and tests; the app uses the live REST resource (mock without an API). */
  operations?: CalendarAvailabilitySettingsOperations;
  publicLinkOperations?: CalendarAvailabilityPublicLinkOperations;
}) {
  const controller = useSettingsCalendarAvailability(operations);
  const publicLink = useSettingsCalendarPublicLink(publicLinkOperations);
  return (
    <SettingsPaneCard title={labels.title} icon={<CalendarClock aria-hidden />}>
      <AvailabilityBody controller={controller} publicLink={publicLink} />
    </SettingsPaneCard>
  );
}

function AvailabilityBody({
  controller,
  publicLink,
}: {
  controller: SettingsCalendarAvailabilityController;
  publicLink: SettingsCalendarPublicLinkController;
}) {
  const { phase, settings, retry } = controller;
  if (phase === "loading") {
    // The switch row as it will be, with a spinner where the switch goes: nothing shifts.
    return (
      <FieldLabelRow layout="inline" label={labels.switch} description={labels.offHint}>
        <span className="settings-availability__pending" role="status" aria-label={labels.loading}>
          <LoadingSpinner size="sm" />
        </span>
      </FieldLabelRow>
    );
  }
  if (phase === "offline") {
    return (
      <p className="settings-availability__status" role="status">
        {labels.offline}
      </p>
    );
  }
  if (phase === "error" || !settings) {
    return (
      <div className="settings-availability__error" role="alert">
        <p className="settings-availability__status">{labels.loadError}</p>
        <Button type="button" variant="outline" size="sm" label={labels.retry} onClick={retry} />
      </div>
    );
  }
  return <AvailabilityForm controller={controller} publicLink={publicLink} />;
}

function AvailabilityForm({
  controller,
  publicLink,
}: {
  controller: SettingsCalendarAvailabilityController;
  publicLink: SettingsCalendarPublicLinkController;
}) {
  const { form, settings } = controller;
  const switchId = useId();
  const enabled = useWatch({ control: form.control, name: "enabled" });
  return (
    <Form {...form}>
      <div className="settings-availability">
        <FormField
          control={form.control}
          name="enabled"
          render={({ field }) => (
            <FieldLabelRow
              layout="inline"
              label={labels.switch}
              description={labels.offHint}
              htmlFor={switchId}
            >
              <Switch id={switchId} checked={field.value} onCheckedChange={field.onChange} />
            </FieldLabelRow>
          )}
        />
        {enabled || publicLink.link?.enabled ? (
          <AvailabilityCalendars calendars={settings?.calendars ?? []} control={form.control} />
        ) : null}
        <SettingsCalendarPublicLinkRow controller={publicLink} />
      </div>
    </Form>
  );
}

function AvailabilityCalendars({
  calendars,
  control,
}: {
  calendars: CalendarAvailabilityCalendar[];
  control: Control<CalendarAvailabilityFormValues>;
}) {
  const headingId = useId();
  return (
    <section className="settings-availability__group" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings-availability__heading">
        {labels.calendarsHeading}
      </h3>
      <p className="settings-availability__hint">{labels.calendarsHint}</p>
      {calendars.length > 0 ? (
        calendars.map((calendar, index) => (
          <AvailabilityCalendarRow
            key={calendar.calendarId}
            calendar={calendar}
            index={index}
            control={control}
          />
        ))
      ) : (
        <p className="settings-availability__hint">{labels.calendarsNone}</p>
      )}
    </section>
  );
}

/** One dropdown value per row: "Do not add", or the detail level of an included calendar. */
const EXCLUDE = "exclude";

function AvailabilityCalendarRow({
  calendar,
  index,
  control,
}: {
  calendar: CalendarAvailabilityCalendar;
  index: number;
  control: Control<CalendarAvailabilityFormValues>;
}) {
  const triggerId = useId();
  const isTeam = calendar.source === "team";
  return (
    <FormField
      control={control}
      name={`calendars.${index}`}
      render={({ field }) => (
        <FieldLabelRow
          layout="inline"
          label={calendar.name}
          description={isTeam ? labels.teamHint : undefined}
          htmlFor={triggerId}
          labelClassName={field.value.include ? undefined : "settings-availability__excluded"}
          icon={<CollectionColorDot color={calendar.color ?? FALLBACK_CALENDAR_COLOR} />}
        >
          <Select
            value={field.value.include ? field.value.detail : EXCLUDE}
            onValueChange={(value) =>
              field.onChange(
                value === EXCLUDE
                  ? { ...field.value, include: false }
                  : {
                      ...field.value,
                      include: true,
                      detail: value as CalendarAvailabilityDetail,
                    },
              )
            }
          >
            <CollectionGhostSelectTrigger id={triggerId} label={<SelectValue />} />
            <SelectContent align="end">
              <SelectItem value={EXCLUDE}>{labels.exclude}</SelectItem>
              <SelectItem value="busy">{labels.detailBusy}</SelectItem>
              {isTeam ? null : <SelectItem value="details">{labels.detailDetails}</SelectItem>}
            </SelectContent>
          </Select>
        </FieldLabelRow>
      )}
    />
  );
}
