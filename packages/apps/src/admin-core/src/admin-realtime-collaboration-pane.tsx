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
        <FormField htmlFor="admin-realtime-stun-urls" label="STUN URLs">
          <Input
            id="admin-realtime-stun-urls"
            value={controller.settingsForm.stunUrls}
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                stunUrls: value,
              }));
            }}
          />
        </FormField>
        <FormField htmlFor="admin-realtime-turn-urls" label="TURN URLs">
          <Input
            id="admin-realtime-turn-urls"
            value={controller.settingsForm.turnUrls}
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                turnUrls: value,
              }));
            }}
          />
        </FormField>
        <div className="grid md:grid-cols-2 gap-3">
          <FormField htmlFor="admin-realtime-turn-username" label="TURN username">
            <Input
              id="admin-realtime-turn-username"
              value={controller.settingsForm.turnUsername}
              onChange={(event) => {
                const value = event.target.value;
                controller.setSettingsForm((prev) => ({
                  ...prev,
                  turnUsername: value,
                }));
              }}
            />
          </FormField>
          <FormField htmlFor="admin-realtime-turn-password" label="TURN password">
            <Input
              id="admin-realtime-turn-password"
              variant="password"
              value={controller.settingsForm.turnPassword}
              onChange={(event) => {
                const value = event.target.value;
                controller.setSettingsForm((prev) => ({
                  ...prev,
                  turnPassword: value,
                }));
              }}
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
