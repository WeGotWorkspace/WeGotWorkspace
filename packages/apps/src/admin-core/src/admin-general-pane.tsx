import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { useAdminSettingsEditor } from "@/admin-core/src/use-admin-settings-autosave";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminGeneralPaneProps = {
  controller: AdminControllerState;
};

export function AdminGeneralPane({ controller }: AdminGeneralPaneProps) {
  const form = controller.settingsForm;
  const { type } = useAdminSettingsEditor();
  return (
    <WorkspacePageSection>
      <FieldLabelRow
        layout="inline"
        fill
        label="Base path"
        description="Where this server lives on its domain. Change it only when you move the install."
        htmlFor="admin-general-base-uri"
      >
        <Input
          id="admin-general-base-uri"
          value={form.baseUri}
          onChange={(event) => type({ baseUri: event.target.value })}
        />
      </FieldLabelRow>
    </WorkspacePageSection>
  );
}
