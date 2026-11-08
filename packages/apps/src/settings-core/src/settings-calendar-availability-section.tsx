import { useId } from "react";
import { useWatch, type Control } from "react-hook-form";
import { Button } from "@/button/src/button";
import type { CalendarAvailabilitySettingsOperations } from "@/lib/api/wgw/calendar-availability";
import type { CalendarAvailabilityFormValues } from "@/settings-core/src/settings-calendar-availability-form";
import { calendarAvailabilityLabels as labels } from "@/settings-core/src/settings-calendar-availability-labels";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { settingsWorkspacePaneClasses } from "@/settings-core/src/settings-workspace.styles";
import {
  useSettingsCalendarAvailability,
  type SettingsCalendarAvailabilityController,
} from "@/settings-core/src/use-settings-calendar-availability";
import { Badge } from "@/ui/badge";
import { Checkbox } from "@/ui/checkbox";
import { Form, FormField } from "@/ui/form";
import { FormSaveActionRow } from "@/ui/form-save-action-row";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import type {
  CalendarAvailabilityCalendar,
  CalendarAvailabilityTeam,
} from "@wgw/openapi-types/calendars-types";
import "./settings-calendar-availability-section.css";

/** Calendar color when the server has none (same fallback as the JMAP calendar mapping). */
const FALLBACK_CALENDAR_COLOR = "#4285f4";

/**
 * Availability in Settings → Calendar (#1912): whether people in the owner's Teams see when
 * they are busy, which calendars count, and how much a personal calendar shows. Server-side,
 * so it has its own Save next to the device-local Calendar settings above it.
 */
export function SettingsCalendarAvailabilitySection({
  operations,
}: {
  /** Stories and tests; the app uses the live REST resource (mock without an API). */
  operations?: CalendarAvailabilitySettingsOperations;
}) {
  const controller = useSettingsCalendarAvailability(operations);
  return (
    <SettingsPaneCard title={labels.title}>
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
  const { form, save, settings } = controller;
  const switchId = useId();
  const enabled = useWatch({ control: form.control, name: "enabled" });
  const { isDirty, isSubmitting } = form.formState;
  return (
    <Form {...form}>
      <div className={`${settingsWorkspacePaneClasses.stack} settings-availability`}>
        <FormField
          control={form.control}
          name="enabled"
          render={({ field }) => (
            <div className="settings-availability__switch-row">
              <Label htmlFor={switchId}>{labels.switch}</Label>
              <Switch id={switchId} checked={field.value} onCheckedChange={field.onChange} />
            </div>
          )}
        />
        {enabled ? (
          <>
            <AvailabilityTeams teams={settings?.teams ?? []} />
            <AvailabilityCalendars calendars={settings?.calendars ?? []} control={form.control} />
            <p className="settings-availability__hint">{labels.footer}</p>
          </>
        ) : (
          <p className="settings-availability__hint">{labels.offHint}</p>
        )}
        <FormSaveActionRow
          className={settingsWorkspacePaneClasses.saveActionRow}
          label="Save"
          disabled={!isDirty || isSubmitting}
          onSave={save}
        />
      </div>
    </Form>
  );
}

function AvailabilityTeams({ teams }: { teams: CalendarAvailabilityTeam[] }) {
  const headingId = useId();
  return (
    <section className="settings-availability__group" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings-availability__heading">
        {labels.teamsHeading}
      </h3>
      {teams.length > 0 ? (
        <ul className="settings-availability__teams">
          {teams.map((team) => (
            <li key={team.slug}>
              <Badge variant="secondary">{team.name}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-availability__hint">{labels.teamsNone}</p>
      )}
    </section>
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
        <ul className="settings-availability__calendars">
          {calendars.map((calendar, index) => (
            <AvailabilityCalendarRow
              key={calendar.calendarId}
              calendar={calendar}
              index={index}
              control={control}
            />
          ))}
        </ul>
      ) : (
        <p className="settings-availability__hint">{labels.calendarsNone}</p>
      )}
    </section>
  );
}

function AvailabilityCalendarRow({
  calendar,
  index,
  control,
}: {
  calendar: CalendarAvailabilityCalendar;
  index: number;
  control: Control<CalendarAvailabilityFormValues>;
}) {
  const baseId = useId();
  const nameId = `${baseId}-name`;
  const includeId = `${baseId}-include`;
  const detailLabelId = `${baseId}-detail`;
  const isTeam = calendar.source === "team";
  const include = useWatch({ control, name: `calendars.${index}.include` });
  return (
    <li className="settings-availability__calendar" data-included={include ? "true" : "false"}>
      <div className="settings-availability__calendar-main">
        <div className="settings-availability__calendar-name">
          <span
            className="settings-availability__dot"
            style={{ backgroundColor: calendar.color ?? FALLBACK_CALENDAR_COLOR }}
            aria-hidden
          />
          <span id={nameId} className="settings-availability__calendar-label">
            {calendar.name}
          </span>
          {isTeam ? <Badge variant="outline">{labels.teamBadge}</Badge> : null}
        </div>
        <div className="settings-availability__calendar-controls">
          <FormField
            control={control}
            name={`calendars.${index}.include`}
            render={({ field }) => (
              <div className="settings-availability__include">
                <Checkbox
                  id={includeId}
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  aria-labelledby={`${includeId}-label ${nameId}`}
                />
                <Label id={`${includeId}-label`} htmlFor={includeId}>
                  {labels.include}
                </Label>
              </div>
            )}
          />
          <div className="settings-availability__detail">
            <span id={detailLabelId} className="settings-availability__detail-label">
              {labels.detail}
            </span>
            {isTeam ? (
              <span className="settings-availability__detail-fixed">{labels.detailBusy}</span>
            ) : (
              <FormField
                control={control}
                name={`calendars.${index}.detail`}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!include}>
                    <SelectTrigger
                      className="settings-availability__detail-select"
                      aria-labelledby={`${detailLabelId} ${nameId}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="busy">{labels.detailBusy}</SelectItem>
                      <SelectItem value="details">{labels.detailDetails}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </div>
        </div>
      </div>
      {isTeam ? <p className="settings-availability__hint">{labels.teamHint}</p> : null}
    </li>
  );
}
