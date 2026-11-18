import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/button/src/button";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { buildMcpEndpointUrl } from "@/lib/mcp-endpoint";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import type { SettingsMcpGrant } from "@/lib/models/settings-types";
import { Tag } from "@/tag/src/tag";
import { ConnectAssistantDialog } from "@/settings-core/src/connect-assistant-dialog";
import {
  connectionMetaParts,
  connectionsShareScopes,
  groupMcpGrants,
  mcpAccessTags,
  userAgentLabel,
  type McpAssistantGroup,
} from "@/settings-core/src/mcp-grant-display";
import { McpEndpointUrlRow } from "@/settings-core/src/mcp-endpoint-url-row";
import { MCP_CONSENT_GROUP_APP_ID } from "@/settings-core/src/mcp-scope-labels";
import { MCP_SHARE_ACTIVITY_LIMIT, ShareActivity } from "@/settings-core/src/mcp-share-activity";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import type { SettingsMcpGrantsState } from "@/settings-core/src/use-settings-mcp-grants";

export { MCP_CONNECT_GUIDE_HREF } from "@/settings-core/src/connect-assistant-dialog";

export const SETTINGS_AUTHORIZED_ASSISTANTS_TITLE = "Authorized assistants";

export type SettingsAssistantsPaneProps = {
  assistants: SettingsMcpGrantsState;
  /** Override for Storybook. Live defaults to current origin + `/mcp`. */
  mcpEndpointUrl?: string;
  /** Override for tests and Storybook: "now" for the relative times. */
  now?: Date;
};

/**
 * Settings → AI assistants: the connection URL, then one entry per assistant
 * product with its connections (where and when each was approved, last use)
 * and what it may do.
 */
export function SettingsAssistantsPane({
  assistants,
  mcpEndpointUrl,
  now,
}: SettingsAssistantsPaneProps) {
  const { grants, loading, revokingId, error, revokeAll } = assistants;
  const [connectOpen, setConnectOpen] = useState(false);
  const { confirmDialog, requestConfirm } = useConfirmDialog();
  const endpointUrl = mcpEndpointUrl ?? buildMcpEndpointUrl();
  const groups = groupMcpGrants(grants);
  const title =
    groups.length > 0
      ? `${SETTINGS_AUTHORIZED_ASSISTANTS_TITLE} (${groups.length})`
      : SETTINGS_AUTHORIZED_ASSISTANTS_TITLE;

  const confirmRevoke = (group: McpAssistantGroup, connections: SettingsMcpGrant[]) => {
    const all = connections.length > 1;
    requestConfirm({
      title: all ? `Revoke all ${group.name} connections?` : `Revoke ${group.name}?`,
      description: all
        ? `All ${connections.length} connections lose access immediately. You can connect again later.`
        : "This connection loses access immediately. You can connect again later.",
      confirmLabel: "Revoke access",
      cancelLabel: "Cancel",
      variant: "destructive",
      onConfirm: () => void revokeAll(connections.map((grant) => grant.clientId)),
    });
  };

  return (
    <div className="settings-assistants-pane">
      <McpEndpointUrlRow url={endpointUrl} inputId="settings-mcp-endpoint" />
      <SettingsPaneCard
        title={title}
        action={
          <Button
            variant="outline"
            icon={<Plus />}
            label="Connect assistant"
            onClick={() => setConnectOpen(true)}
          />
        }
      >
        {error ? (
          <p className="settings-assistants-pane__error" role="alert">
            {error}
          </p>
        ) : null}
        {loading && grants.length === 0 ? (
          <p className="settings-assistants-pane__empty">Loading AI assistants…</p>
        ) : null}
        {!loading && grants.length === 0 ? (
          <p className="settings-assistants-pane__empty">
            No assistants yet. Connect Claude, ChatGPT or Mistral with the connection URL above.
          </p>
        ) : null}
        {groups.length > 0 ? (
          <ul className="settings-assistant-list">
            {groups.map((group) => (
              <AssistantEntry
                key={group.key}
                group={group}
                now={now}
                revokingId={revokingId}
                onRevoke={(connections) => confirmRevoke(group, connections)}
              />
            ))}
          </ul>
        ) : null}
      </SettingsPaneCard>
      <ConnectAssistantDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        endpointUrl={endpointUrl}
      />
      {confirmDialog}
    </div>
  );
}

function AssistantEntry({
  group,
  now,
  revokingId,
  onRevoke,
}: {
  group: McpAssistantGroup;
  now?: Date;
  revokingId: string | null;
  onRevoke: (connections: SettingsMcpGrant[]) => void;
}) {
  const { connections } = group;
  const single = connections.length === 1;
  const sharedScopes = connectionsShareScopes(connections);
  const busy = connections.some((grant) => grant.clientId === revokingId);
  const shareCalls = connections
    .flatMap((grant) => grant.shareCalls)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MCP_SHARE_ACTIVITY_LIMIT);

  return (
    <li className="settings-assistant">
      <div className="settings-assistant__header">
        <div className="settings-assistant__identity">
          <h3 className="settings-assistant__name">{group.name}</h3>
          {group.source && group.source !== group.name ? <Tag label={group.source} /> : null}
        </div>
        <RevokeButton
          label={single ? "Revoke" : "Revoke all"}
          ariaLabel={single ? `Revoke ${group.name}` : `Revoke all ${group.name} connections`}
          disabled={busy}
          onClick={() => onRevoke(connections)}
        />
      </div>
      {single ? <ConnectionMeta grant={connections[0]} now={now} /> : null}
      {sharedScopes ? <AccessTags scopes={connections[0].scopes} /> : null}
      {single ? null : (
        <ul className="settings-assistant__connections">
          {connections.map((grant) => (
            <li key={grant.clientId} className="settings-assistant__connection">
              <div className="settings-assistant__connection-main">
                <ConnectionMeta grant={grant} now={now} />
                {sharedScopes ? null : <AccessTags scopes={grant.scopes} />}
              </div>
              <RevokeButton
                label="Revoke"
                ariaLabel={`Revoke ${group.name}, ${userAgentLabel(grant.approvedUserAgent) ?? "unknown browser"}`}
                disabled={grant.clientId === revokingId}
                onClick={() => onRevoke([grant])}
              />
            </li>
          ))}
        </ul>
      )}
      <ShareActivity calls={shareCalls} />
    </li>
  );
}

function RevokeButton({
  label,
  ariaLabel,
  disabled,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="settings-assistant__revoke"
      variant="outline"
      severity="danger"
      label={label}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

function ConnectionMeta({ grant, now }: { grant: SettingsMcpGrant; now?: Date }) {
  return (
    <p className="settings-assistant__meta">
      {connectionMetaParts(grant, now ?? new Date()).join(" · ")}
    </p>
  );
}

function AccessTags({ scopes }: { scopes: string[] }) {
  const tags = mcpAccessTags(scopes);
  if (tags.length === 0) return null;
  return (
    <ul className="settings-assistant__access" aria-label="What it may do">
      {tags.map((tag) => {
        const appId = MCP_CONSENT_GROUP_APP_ID[tag.app];
        return (
          <li key={tag.app}>
            <Tag
              label={tag.label}
              icon={
                appId ? (
                  <WorkspaceAppIcon appId={appId} className="settings-assistant__app-icon" />
                ) : undefined
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
