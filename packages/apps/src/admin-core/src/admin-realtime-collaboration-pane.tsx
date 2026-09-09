import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminRealtimeCollaborationPaneProps = {
  controller: AdminControllerState;
};

export function AdminRealtimeCollaborationPane({
  controller,
}: AdminRealtimeCollaborationPaneProps) {
  return (
    <>
      <Card title="WebRTC ICE servers">
        <p className="mb-3 text-sm text-muted-foreground">
          ICE servers improve real-time reliability by helping peers discover the best route through
          NATs and firewalls. Configure STUN for direct path discovery and TURN as a relay fallback
          when direct peer-to-peer connections are blocked. Enter multiple URLs as a comma-separated
          list.
        </p>
        <FormField label="STUN URLs">
          <Input
            value={controller.settingsForm.stunUrls}
            onChange={(event) =>
              controller.setSettingsForm((prev) => ({
                ...prev,
                stunUrls: event.currentTarget.value,
              }))
            }
          />
        </FormField>
        <FormField label="TURN URLs">
          <Input
            value={controller.settingsForm.turnUrls}
            onChange={(event) =>
              controller.setSettingsForm((prev) => ({
                ...prev,
                turnUrls: event.currentTarget.value,
              }))
            }
          />
        </FormField>
        <div className="grid md:grid-cols-2 gap-3">
          <FormField label="TURN username">
            <Input
              value={controller.settingsForm.turnUsername}
              onChange={(event) =>
                controller.setSettingsForm((prev) => ({
                  ...prev,
                  turnUsername: event.currentTarget.value,
                }))
              }
            />
          </FormField>
          <FormField label="TURN password">
            <Input
              type="password"
              value={controller.settingsForm.turnPassword}
              onChange={(event) =>
                controller.setSettingsForm((prev) => ({
                  ...prev,
                  turnPassword: event.currentTarget.value,
                }))
              }
            />
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
