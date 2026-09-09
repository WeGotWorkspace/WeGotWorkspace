import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { SECURITY_OPTIONS } from "@/admin-core/src/admin-workspace-utils";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminMailPaneProps = {
  controller: AdminControllerState;
};

export function AdminMailPane({ controller }: AdminMailPaneProps) {
  return (
    <>
      <Card title="IMAP (incoming)">
        <FormField label="Server">
          <Input
            value={controller.settingsForm.imapHost}
            onChange={(event) =>
              controller.setSettingsForm((prev) => ({
                ...prev,
                imapHost: event.currentTarget.value,
              }))
            }
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Port">
            <Input
              type="number"
              value={String(controller.settingsForm.imapPort)}
              onChange={(event) =>
                controller.setSettingsForm((prev) => ({
                  ...prev,
                  imapPort: Number(event.currentTarget.value) || 0,
                }))
              }
            />
          </FormField>
          <FormField label="Security">
            <Select
              value={controller.settingsForm.imapSecurity || "ssl"}
              onValueChange={(value) =>
                controller.setSettingsForm((prev) => ({ ...prev, imapSecurity: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECURITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </Card>
      <Card title="SMTP (outgoing)">
        <FormField label="Server">
          <Input
            value={controller.settingsForm.smtpHost}
            onChange={(event) =>
              controller.setSettingsForm((prev) => ({
                ...prev,
                smtpHost: event.currentTarget.value,
              }))
            }
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Port">
            <Input
              type="number"
              value={String(controller.settingsForm.smtpPort)}
              onChange={(event) =>
                controller.setSettingsForm((prev) => ({
                  ...prev,
                  smtpPort: Number(event.currentTarget.value) || 0,
                }))
              }
            />
          </FormField>
          <FormField label="Security">
            <Select
              value={controller.settingsForm.smtpSecurity || "ssl"}
              onValueChange={(value) =>
                controller.setSettingsForm((prev) => ({ ...prev, smtpSecurity: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECURITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
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
