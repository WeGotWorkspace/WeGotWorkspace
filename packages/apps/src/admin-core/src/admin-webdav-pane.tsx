import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { TIMEZONES } from "@/admin-core/src/admin-workspace-utils";
import { useAdminSettingsEditor } from "@/admin-core/src/use-admin-settings-autosave";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminWebdavPaneProps = {
  controller: AdminControllerState;
};

export function AdminWebdavPane({ controller }: AdminWebdavPaneProps) {
  const form = controller.settingsForm;
  const { choose, type } = useAdminSettingsEditor();
  return (
    <WorkspacePageSection>
      <FieldLabelRow
        layout="inline"
        label="Default time zone"
        description="For calendars that do not set their own."
        htmlFor="admin-webdav-timezone"
      >
        <Select value={form.timezone} onValueChange={(value) => choose({ timezone: value })}>
          <CollectionGhostSelectTrigger id="admin-webdav-timezone" label={<SelectValue />} />
          <SelectContent align="end" className="max-h-72">
            {TIMEZONES.map((timezone) => (
              <SelectItem key={timezone} value={timezone}>
                {timezone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldLabelRow>
      <FieldLabelRow
        layout="inline"
        fill
        label="Sign-in realm"
        description="The name sync apps show when they ask for a password."
        htmlFor="admin-webdav-auth-realm"
      >
        <Input
          id="admin-webdav-auth-realm"
          value={form.authRealm}
          onChange={(event) => type({ authRealm: event.target.value })}
        />
      </FieldLabelRow>
      <FieldLabelRow
        layout="inline"
        fill
        label="Base path"
        description="Where this server lives on its domain. Change it only when you move the install."
        htmlFor="admin-webdav-base-uri"
      >
        <Input
          id="admin-webdav-base-uri"
          value={form.baseUri}
          onChange={(event) => type({ baseUri: event.target.value })}
        />
      </FieldLabelRow>
    </WorkspacePageSection>
  );
}
