import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { TIMEZONES } from "@/admin-core/src/admin-workspace-utils";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminWebdavPaneProps = {
  controller: AdminControllerState;
};

export function AdminWebdavPane({ controller }: AdminWebdavPaneProps) {
  return (
    <>
      <Card title="Server defaults">
        <FormField htmlFor="admin-webdav-timezone" label="Default timezone">
          <Select
            value={controller.settingsForm.timezone}
            onValueChange={(value) =>
              controller.setSettingsForm((prev) => ({ ...prev, timezone: value }))
            }
          >
            <SelectTrigger id="admin-webdav-timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {TIMEZONES.map((timezone) => (
                <SelectItem key={timezone} value={timezone}>
                  {timezone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField htmlFor="admin-webdav-auth-realm" label="Auth realm">
          <Input
            id="admin-webdav-auth-realm"
            value={controller.settingsForm.authRealm}
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                authRealm: value,
              }));
            }}
          />
        </FormField>
        <FormField htmlFor="admin-webdav-base-uri" label="Base URI">
          <Input
            id="admin-webdav-base-uri"
            value={controller.settingsForm.baseUri}
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                baseUri: value,
              }));
            }}
          />
        </FormField>
      </Card>

      <div className="flex justify-end">
        <Button
          label="Save changes"
          variant="primary"
          onClick={() => void controller.actions.saveSettings()}
        />
      </div>
    </>
  );
}
