import { Bug, Network, Video } from "lucide-react";
import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { AdminIceUrlList } from "@/admin-core/src/admin-ice-url-list";
import { splitIceUrlRows } from "@/admin-core/src/admin-settings-form-utils";
import { AdminStunUrlsField } from "@/admin-core/src/admin-stun-urls-field";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Tag } from "@/tag/src/tag";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { VIDEO_PROFILE_LABELS, VIDEO_PROFILES_RANKED } from "@/lib/rtc/video-profile";
import { FeatureRow } from "@/admin-core/src/admin-workspace-widgets";
import { useAdminSettingsEditor } from "@/admin-core/src/use-admin-settings-autosave";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminRealtimeCollaborationPaneProps = {
  controller: AdminControllerState;
};

function VideoProfileSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <CollectionGhostSelectTrigger id={id} label={<SelectValue />} />
      <SelectContent align="end">
        {VIDEO_PROFILES_RANKED.map((profile) => (
          <SelectItem key={profile} value={profile}>
            {VIDEO_PROFILE_LABELS[profile]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AdminRealtimeCollaborationPane({
  controller,
}: AdminRealtimeCollaborationPaneProps) {
  const form = controller.settingsForm;
  const { choose, type } = useAdminSettingsEditor();
  const relayReady = form.turnSecretSet && splitIceUrlRows(form.turnUrls).some((url) => url !== "");

  return (
    <>
      {form.turnStaticCredentialsPresent ? (
        <Callout
          className="admin-pane-callout"
          severity="warning"
          title="The relay is off"
          message="This server still has a TURN username and password from an older release. Enter a shared secret below to turn the relay back on; that also removes the old ones."
        />
      ) : null}

      <WorkspacePageSection title="Connection servers" icon={<Network aria-hidden />}>
        <p className="workspace-page-section__lead">
          Calls and live editing connect people directly. STUN helps them find each other; TURN
          relays the connection when a firewall blocks the direct route. Up to three of each.
        </p>
        <AdminStunUrlsField
          value={form.stunUrls}
          onChange={(stunUrls) => type({ stunUrls })}
          onRestore={(stunUrls) => choose({ stunUrls })}
        />
        <FieldLabelRow
          layout="inline"
          fill
          label="TURN servers"
          description="Optional relay for people behind strict firewalls."
          htmlFor="admin-realtime-turn-urls-1"
        >
          <AdminIceUrlList
            id="admin-realtime-turn-urls"
            label="TURN servers"
            itemLabel="TURN URL"
            value={form.turnUrls}
            onChange={(turnUrls) => type({ turnUrls: turnUrls })}
          />
        </FieldLabelRow>
        <FieldLabelRow
          layout="inline"
          fill
          label="TURN shared secret"
          description={
            form.turnSecretSet
              ? "Saved. It is never shown again; leave empty to keep it."
              : "The use-auth-secret value of your TURN server."
          }
          htmlFor="admin-realtime-turn-secret"
        >
          <span className="admin-value-control">
            <Input
              id="admin-realtime-turn-secret"
              variant="password"
              autoComplete="new-password"
              value={form.turnSecret}
              onChange={(event) => type({ turnSecret: event.target.value })}
            />
            {form.turnSecretSet ? (
              <Button
                label="Clear"
                variant="ghost"
                onClick={() => void controller.actions.clearTurnSecret()}
              />
            ) : null}
          </span>
        </FieldLabelRow>
      </WorkspacePageSection>

      <WorkspacePageSection title="Video quality" icon={<Video aria-hidden />}>
        <p className="workspace-page-section__lead">
          Caps for video only, never audio. Each call still picks a quality for its size, up to
          these limits.
        </p>
        <FieldLabelRow
          layout="inline"
          label="Highest quality"
          description="Audio only turns cameras off on this server."
          htmlFor="admin-realtime-max-video-profile"
        >
          <VideoProfileSelect
            id="admin-realtime-max-video-profile"
            value={form.maxVideoProfile}
            onChange={(value) => choose({ maxVideoProfile: value })}
          />
        </FieldLabelRow>
        <FieldLabelRow
          layout="inline"
          label="Highest quality over the relay"
          description="Relayed video uses your server's bandwidth. Never above the limit above."
          htmlFor="admin-realtime-max-video-profile-relay"
        >
          <VideoProfileSelect
            id="admin-realtime-max-video-profile-relay"
            value={form.maxVideoProfileRelay}
            onChange={(value) => choose({ maxVideoProfileRelay: value })}
          />
        </FieldLabelRow>
      </WorkspacePageSection>

      <WorkspacePageSection title="Troubleshooting" icon={<Bug aria-hidden />}>
        <p className="workspace-page-section__lead">Changes apply when people reload the page.</p>
        <FeatureRow
          label="Detailed connection logs"
          desc="Writes connection details to each browser's developer console. Turn it off when you are done."
          value={form.rtcDebugLogging}
          onChange={(next) => choose({ rtcDebugLogging: next })}
        />
        <FeatureRow
          label="Always use the relay"
          desc="Sends all traffic through your TURN server, even when a direct route works. Uses more bandwidth."
          value={relayReady ? form.rtcForceRelay : false}
          disabled={!relayReady}
          labelAccessory={
            relayReady ? undefined : (
              <Tag label="Needs TURN" className="admin-feature-row__status-tag" />
            )
          }
          onChange={(next) => choose({ rtcForceRelay: next })}
        />
      </WorkspacePageSection>
    </>
  );
}
