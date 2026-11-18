import { KeyRound, MonitorSmartphone } from "lucide-react";
import { Button } from "@/button/src/button";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { buildMcpEndpointUrl } from "@/lib/mcp-endpoint";
import type { SettingsMcpGrant } from "@/lib/models/settings-types";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import { Tag } from "@/tag/src/tag";
import { FieldLabelRow } from "@/ui/field-label-row";
import {
  connectionMetaParts,
  connectionsShareScopes,
  groupMcpGrants,
  mcpAppAccess,
  userAgentLabel,
  type McpAssistantGroup,
} from "@/settings-core/src/mcp-grant-display";
import { McpEndpointUrlRow } from "@/settings-core/src/mcp-endpoint-url-row";
import { MCP_CONSENT_GROUP_APP_ID } from "@/settings-core/src/mcp-scope-labels";
import { MCP_SHARE_ACTIVITY_LIMIT, ShareActivity } from "@/settings-core/src/mcp-share-activity";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import type { SettingsMcpGrantsState } from "@/settings-core/src/use-settings-mcp-grants";

export const MCP_CONNECT_GUIDE_HREF =
  "https://github.com/WeGotWorkspace/WeGotWorkspace/blob/main/docs/mcp-connect.md";

export const SETTINGS_AUTHORIZED_ASSISTANTS_TITLE = "Authorized assistants";

export type SettingsAssistantsPaneProps = {
  assistants: SettingsMcpGrantsState;
  /** Override for Storybook. Live defaults to current origin + `/mcp`. */
  mcpEndpointUrl?: string;
  /** Override for tests and Storybook: "now" for the relative times. */
  now?: Date;
};

/**
 * Settings → AI assistants, in the two-column rows of the other panes: the
 * connection URL, then one row per assistant product (Revoke at the end) with
 * what it may do and, for a product connected more than once, its connections.
 */
export function SettingsAssistantsPane({
  assistants,
  mcpEndpointUrl,
  now,
}: SettingsAssistantsPaneProps) {
  const { grants, loading, revokingId, error, revokeAll } = assistants;
  const { confirmDialog, requestConfirm } = useConfirmDialog();
  const endpointUrl = mcpEndpointUrl ?? buildMcpEndpointUrl();
  const groups = groupMcpGrants(grants);

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
    <>
      <SettingsPaneCard>
        <McpEndpointUrlRow
          url={endpointUrl}
          inputId="settings-mcp-endpoint"
          description={
            <>
              Add it in Claude, ChatGPT or Mistral as a custom connector.{" "}
              <a href={MCP_CONNECT_GUIDE_HREF} target="_blank" rel="noreferrer">
                Connect guide
              </a>
            </>
          }
        />
      </SettingsPaneCard>
      {error ? (
        <p className="settings-assistants-pane__error" role="alert">
          {error}
        </p>
      ) : null}
      {grants.length === 0 ? (
        <SettingsPaneCard title={SETTINGS_AUTHORIZED_ASSISTANTS_TITLE}>
          <p className="settings-assistants-pane__empty">
            {loading
              ? "Loading AI assistants…"
              : "No assistants yet. Add the connection URL in your assistant to connect it."}
          </p>
        </SettingsPaneCard>
      ) : null}
      {groups.map((group) => (
        <AssistantSection
          key={group.key}
          group={group}
          now={now}
          revokingId={revokingId}
          onRevoke={(connections) => confirmRevoke(group, connections)}
        />
      ))}
      {confirmDialog}
    </>
  );
}

/**
 * One assistant product as a page section: its name as the title (source at the
 * end), then what it may do per app, then its connections. One connection or
 * many, the layout is the same; Revoke all only appears with more than one.
 */
function AssistantSection({
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
  const sharedScopes = connectionsShareScopes(connections);
  const shareCalls = connections
    .flatMap((grant) => grant.shareCalls)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MCP_SHARE_ACTIVITY_LIMIT);
  const showSource = group.source !== "" && group.source !== group.name;

  return (
    <SettingsPaneCard
      className="settings-assistant"
      title={group.name}
      titleAccessory={showSource ? <Tag label={group.source} /> : undefined}
    >
      {sharedScopes ? (
        <>
          <FieldLabelRow
            layout="inline"
            section
            className="settings-assistant__heading"
            label="Permissions"
            icon={<KeyRound aria-hidden />}
          >
            {null}
          </FieldLabelRow>
          <AccessRows scopes={connections[0].scopes} />
        </>
      ) : null}
      <FieldLabelRow
        layout="inline"
        section
        className="settings-assistant__heading"
        label="Connections"
        icon={<MonitorSmartphone aria-hidden />}
      >
        {connections.length > 1 ? (
          <RevokeButton
            label="Revoke all"
            ariaLabel={`Revoke all ${group.name} connections`}
            disabled={connections.some((grant) => grant.clientId === revokingId)}
            onClick={() => onRevoke(connections)}
          />
        ) : null}
      </FieldLabelRow>
      {connections.map((grant) => (
        <ConnectionRow
          key={grant.clientId}
          grant={grant}
          name={group.name}
          single={connections.length === 1}
          now={now}
          showScopes={!sharedScopes}
          disabled={grant.clientId === revokingId}
          onRevoke={() => onRevoke([grant])}
        />
      ))}
      <ShareActivity calls={shareCalls} />
    </SettingsPaneCard>
  );
}

function ConnectionRow({
  grant,
  name,
  single,
  now,
  showScopes,
  disabled,
  onRevoke,
}: {
  grant: SettingsMcpGrant;
  name: string;
  single: boolean;
  now?: Date;
  showScopes: boolean;
  disabled: boolean;
  onRevoke: () => void;
}) {
  const via = userAgentLabel(grant.approvedUserAgent);
  const parts = connectionMetaParts(grant, now ?? new Date());
  // With a browser, it is the caption and the rest is the description.
  const description = (via ? parts.slice(1) : parts).join(" · ");
  return (
    <FieldLabelRow
      layout="inline"
      className="settings-assistant__connection"
      label={via ?? "Unknown browser"}
      description={description}
      below={showScopes ? <AccessRows scopes={grant.scopes} /> : undefined}
    >
      <RevokeButton
        label="Revoke"
        ariaLabel={single ? `Revoke ${name}` : `Revoke ${name}, ${via ?? "unknown browser"}`}
        disabled={disabled}
        onClick={onRevoke}
      />
    </FieldLabelRow>
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
      variant="outline"
      severity="danger"
      label={label}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

function AppIcon({ app }: { app: string }) {
  const appId = MCP_CONSENT_GROUP_APP_ID[app];
  return appId ? <WorkspaceAppIcon appId={appId} className="settings-assistant__app-icon" /> : null;
}

/** One inline row per app: the app at the start, Read / Write / Share tags at the end. */
function AccessRows({ scopes }: { scopes: string[] }) {
  const apps = mcpAppAccess(scopes);
  if (apps.length === 0) return null;
  return (
    <>
      {apps.map((access) => (
        <FieldLabelRow
          key={access.app}
          layout="inline"
          className="settings-assistant__app"
          label={access.app}
          icon={<AppIcon app={access.app} />}
        >
          <span className="settings-assistant__actions">
            {access.actions.map((action) => (
              <Tag key={action} label={action} />
            ))}
          </span>
        </FieldLabelRow>
      ))}
    </>
  );
}
