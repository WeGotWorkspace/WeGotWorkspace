import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { TIMEZONES } from "@/admin-core/src/admin-workspace-utils";
import { useAdminSettingsEditor } from "@/admin-core/src/use-admin-settings-autosave";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminCalendarPaneProps = {
  controller: AdminControllerState;
};

export function AdminCalendarPane({ controller }: AdminCalendarPaneProps) {
  const form = controller.settingsForm;
  const { choose } = useAdminSettingsEditor();
  return (
    <WorkspacePageSection>
      <FieldLabelRow
        layout="inline"
        label="Default time zone"
        description="For calendars that do not set their own."
        htmlFor="admin-calendar-timezone"
      >
        <Select value={form.timezone} onValueChange={(value) => choose({ timezone: value })}>
          <CollectionGhostSelectTrigger id="admin-calendar-timezone" label={<SelectValue />} />
          <SelectContent align="end" className="max-h-72">
            {TIMEZONES.map((timezone) => (
              <SelectItem key={timezone} value={timezone}>
                {timezone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldLabelRow>
    </WorkspacePageSection>
  );
}
