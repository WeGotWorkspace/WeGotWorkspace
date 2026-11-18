import { Button } from "@/button/src/button";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { buildMcpEndpointUrl } from "@/lib/mcp-endpoint";
import type { SettingsMcpGrant } from "@/lib/models/settings-types";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import { Tag } from "@/tag/src/tag";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
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
 * Settings → AI assistants: the connection URL, then a section per assistant
 * product with an app tag per permission and a row per connection (Revoke at the end).
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
 * One assistant product as a page section: its name as the title (source beside it,
 * Revoke all at the end), then an app tag per permission, then its connections. One connection or
 * many, the layout is the same; Revoke all revokes every one.
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
      action={
        <Button
          variant="ghost"
          severity="danger"
          label="Revoke all"
          aria-label={`Revoke all ${group.name} connections`}
          disabled={connections.some((grant) => grant.clientId === revokingId)}
          onClick={() => onRevoke(connections)}
        />
      }
    >
      {sharedScopes ? <AccessRows scopes={connections[0].scopes} /> : null}
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
        label={single ? `Revoke ${name}` : `Revoke ${name}, ${via ?? "unknown browser"}`}
        disabled={disabled}
        onClick={onRevoke}
      />
    </FieldLabelRow>
  );
}

/** Ghost text button; the accessible name says which connection. */
function RevokeButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      severity="danger"
      label="Revoke"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

function AppIcon({ app }: { app: string }) {
  const appId = MCP_CONSENT_GROUP_APP_ID[app];
  return appId ? <WorkspaceAppIcon appId={appId} className="settings-assistant__app-icon" /> : null;
}

/** "Read", "Read & write", "Read, write & share". */
function actionsLabel(actions: string[]): string {
  const words = actions.map((action, index) => (index === 0 ? action : action.toLowerCase()));
  return words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} & ${words[words.length - 1]}`;
}

/**
 * One tag per app, side by side: the app icon and what it may do. The app name
 * is in the tooltip (and the accessible name), so the tags stay short.
 */
function AccessRows({ scopes }: { scopes: string[] }) {
  const apps = mcpAppAccess(scopes);
  if (apps.length === 0) return null;
  return (
    <div className="settings-assistant__apps">
      {apps.map((access) => {
        // Retired ids outside the catalog stay as they are.
        const label =
          access.app === "Other" ? access.actions.join(", ") : actionsLabel(access.actions);
        return (
          <Tooltip key={access.app}>
            <TooltipTrigger asChild>
              <span
                className="settings-assistant__app"
                tabIndex={0}
                aria-label={`${access.app}: ${label}`}
              >
                <Tag label={label} icon={<AppIcon app={access.app} />} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{access.app}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
