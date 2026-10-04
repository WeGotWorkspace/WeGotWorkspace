import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { VIDEO_PROFILE_LABELS, VIDEO_PROFILES_RANKED } from "@/lib/rtc/video-profile";
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
        <FormField htmlFor="admin-realtime-turn-secret" label="TURN shared secret">
          <Input
            id="admin-realtime-turn-secret"
            variant="password"
            autoComplete="new-password"
            value={controller.settingsForm.turnSecret}
            placeholder={
              controller.settingsForm.turnSecretSet ? "Leave blank to keep the stored secret" : ""
            }
            onChange={(event) => {
              const value = event.target.value;
              controller.setSettingsForm((prev) => ({
                ...prev,
                turnSecret: value,
              }));
            }}
          />
        </FormField>
        <p className="mb-3 text-sm text-muted-foreground">
          Optional. Turn this on when the Real-time health page shows people who can&apos;t connect.
          The secret matches your TURN server&apos;s <code>use-auth-secret</code> setting. It is
          currently <strong>{controller.settingsForm.turnSecretSet ? "set" : "not set"}</strong>; it
          is never shown again after saving.
        </p>
        {controller.settingsForm.turnStaticCredentialsPresent ? (
          <p className="mb-3 text-sm text-destructive">
            This server still has a static TURN username and password from an older release. The
            relay stays disabled until you enter a shared secret here, which also removes them.
          </p>
        ) : null}
        {controller.settingsForm.turnSecretSet ? (
          <div className="flex justify-start">
            <Button
              label="Clear stored TURN secret"
              variant="outline"
              onClick={() => void controller.actions.clearTurnSecret()}
            />
          </div>
        ) : null}
      </Card>
      <Card title="Video quality">
        <p className="mb-3 text-sm text-muted-foreground">
          These limits affect video quality only, never audio. Clients still choose a quality
          automatically based on how many people are in the call; these settings only cap how high
          that choice may go.
        </p>
        <FormField htmlFor="admin-realtime-max-video-profile" label="Maximum video quality">
          <Select
            value={controller.settingsForm.maxVideoProfile}
            onValueChange={(value) => {
              controller.setSettingsForm((prev) => ({
                ...prev,
                maxVideoProfile: value,
              }));
            }}
          >
            <SelectTrigger id="admin-realtime-max-video-profile" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_PROFILES_RANKED.map((profile) => (
                <SelectItem key={profile} value={profile}>
                  {VIDEO_PROFILE_LABELS[profile]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <p className="mb-3 text-sm text-muted-foreground">
          The highest quality anyone on this server may send. <strong>Audio only</strong> turns off
          camera sending entirely.
        </p>
        <FormField
          htmlFor="admin-realtime-max-video-profile-relay"
          label="Maximum video quality over relay"
        >
          <Select
            value={controller.settingsForm.maxVideoProfileRelay}
            onValueChange={(value) => {
              controller.setSettingsForm((prev) => ({
                ...prev,
                maxVideoProfileRelay: value,
              }));
            }}
          >
            <SelectTrigger id="admin-realtime-max-video-profile-relay" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_PROFILES_RANKED.map((profile) => (
                <SelectItem key={profile} value={profile}>
                  {VIDEO_PROFILE_LABELS[profile]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <p className="mb-3 text-sm text-muted-foreground">
          Used when someone&apos;s connection has to go through the TURN relay, which costs your
          server bandwidth. It can never exceed the maximum above.
        </p>
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
