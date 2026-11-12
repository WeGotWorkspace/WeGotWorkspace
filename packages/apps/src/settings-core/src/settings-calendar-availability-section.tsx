import { useId } from "react";
import { useWatch, type Control } from "react-hook-form";
import { CalendarClock } from "lucide-react";
import { Button } from "@/button/src/button";
import type { CalendarAvailabilitySettingsOperations } from "@/lib/api/wgw/calendar-availability";
import type {
  CalendarAvailabilityDetail,
  CalendarAvailabilityFormValues,
} from "@/settings-core/src/settings-calendar-availability-form";
import { calendarAvailabilityLabels as labels } from "@/settings-core/src/settings-calendar-availability-labels";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import {
  useSettingsCalendarAvailability,
  type SettingsCalendarAvailabilityController,
} from "@/settings-core/src/use-settings-calendar-availability";
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
 * only) title and location. Server-side; changes save themselves.
 */
export function SettingsCalendarAvailabilitySection({
  operations,
}: {
  /** Stories and tests; the app uses the live REST resource (mock without an API). */
  operations?: CalendarAvailabilitySettingsOperations;
}) {
  const controller = useSettingsCalendarAvailability(operations);
  return (
    <SettingsPaneCard title={labels.title} icon={<CalendarClock aria-hidden />}>
      <AvailabilityBody controller={controller} />
    </SettingsPaneCard>
  );
}

function AvailabilityBody({ controller }: { controller: SettingsCalendarAvailabilityController }) {
  const { phase, settings, retry } = controller;
  if (phase === "loading") {
    return (
      <p className="settings-availability__status" role="status">
        {labels.loading}
      </p>
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
  return <AvailabilityForm controller={controller} />;
}

function AvailabilityForm({ controller }: { controller: SettingsCalendarAvailabilityController }) {
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
        {enabled ? (
          <AvailabilityCalendars calendars={settings?.calendars ?? []} control={form.control} />
        ) : null}
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
