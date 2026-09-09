import { useState } from "react";
import { Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Card } from "@/card/src/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { buttonVariants } from "@/ui/button";
import { cn } from "@/lib/utils";
import { displayOriginHost } from "@/settings-core/src/display-origin-host";
import { McpConsentPermissionsCard } from "@/settings-core/src/mcp-consent-permissions-card";
import { buildMcpEndpointUrl } from "@/settings-core/src/mcp-endpoint";
import { McpEndpointUrlRow } from "@/settings-core/src/mcp-endpoint-url-row";
import type { SettingsMcpGrant } from "@/settings-core/src/settings-types";
import type { SettingsMcpGrantsState } from "@/settings-core/src/use-settings-mcp-grants";
import {
  mcpConsentCatalogScopeIds,
  mcpConsentGroupsFor,
} from "@/settings-core/src/mcp-scope-labels";

export const MCP_CONNECT_GUIDE_HREF =
  "https://github.com/WeGotWorkspace/WeGotWorkspace/blob/main/docs/mcp-connect.md";

export const SETTINGS_GRANTED_PERMISSIONS_TITLE = "Granted Permissions";
export const SETTINGS_GRANTED_PERMISSIONS_HINT =
  "The assistant is allowed to do the following things";

export type SettingsAssistantsPaneProps = {
  assistants: SettingsMcpGrantsState;
  /** Override for Storybook. Live defaults to current origin + `/mcp`. */
  mcpEndpointUrl?: string;
};

export function SettingsAssistantsPane({
  assistants,
  mcpEndpointUrl,
}: SettingsAssistantsPaneProps) {
  const { grants, loading, revokingId, error, revoke } = assistants;
  const [pending, setPending] = useState<SettingsMcpGrant | null>(null);
  const endpointUrl = mcpEndpointUrl ?? buildMcpEndpointUrl();
  const isEmpty = !loading && grants.length === 0;
  const isConnected = grants.length > 0;

  return (
    <div
      className={cn(
        "settings-assistants-pane",
        "settings-connected-assistants-pane",
        isEmpty && "settings-connected-assistants-pane--empty",
        isConnected && "settings-connected-assistants-pane--connected",
      )}
    >
      <McpEndpointUrlRow url={endpointUrl} inputId="settings-mcp-endpoint" />
      {error ? (
        <p className="settings-assistants-pane__error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && grants.length === 0 ? (
        <p className="settings-assistants-pane__empty">Loading connected assistants…</p>
      ) : null}
      {!loading && grants.length === 0 ? (
        <Card title="No assistants connected">
          <p className="settings-assistants-pane__empty">
            Connect Claude, ChatGPT, or Mistral using this instance as a custom MCP connector. You
            will sign in again on the instance. See the{" "}
            <a href={MCP_CONNECT_GUIDE_HREF} target="_blank" rel="noreferrer">
              connect guide
            </a>
            .
          </p>
        </Card>
      ) : null}
      {grants.length > 0 ? (
        <div className="settings-assistants-pane__grants">
          {grants.map((grant) => (
            <GrantCard
              key={grant.clientId}
              grant={grant}
              revoking={revokingId === grant.clientId}
              onRevoke={() => setPending(grant)}
            />
          ))}
        </div>
      ) : null}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {pending?.clientOrigin ?? "this assistant"}?</AlertDialogTitle>
            <AlertDialogDescription>
              The assistant will lose access immediately. You can connect it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (pending) {
                  void revoke(pending.clientId);
                }
                setPending(null);
              }}
            >
              Revoke access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function grantDisplayName(grant: SettingsMcpGrant): string | null {
  const name = grant.clientName?.trim() ?? "";
  const origin = grant.clientOrigin?.trim() ?? "";
  if (name && name !== origin) return name;
  if (name && !origin) return name;
  return null;
}

function grantRevokeLabel(grant: SettingsMcpGrant): string {
  const name = grantDisplayName(grant);
  return name ? `Revoke ${name}` : "Revoke assistant";
}

function GrantCard({
  grant,
  revoking,
  onRevoke,
}: {
  grant: SettingsMcpGrant;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const displayName = grantDisplayName(grant);
  const origin = grant.clientOrigin?.trim() || "";
  const host = origin ? displayOriginHost(origin) : "";
  const title = displayName ?? (host || null);
  const showHost = Boolean(host) && host !== title;
  const groups = mcpConsentGroupsFor([...mcpConsentCatalogScopeIds(), ...grant.scopes]);

  return (
    <article className="settings-assistants-pane__grant">
      <header className="settings-assistants-pane__grant-header">
        <div className="settings-assistants-pane__grant-identity">
          {title ? <h2 className="settings-assistants-pane__grant-name">{title}</h2> : null}
          {showHost ? <p className="settings-assistants-pane__grant-origin">{host}</p> : null}
        </div>
        <IconButton
          className="settings-assistants-pane__grant-revoke"
          variant="destructive-outline"
          size="sm"
          icon={<Trash2 />}
          label={grantRevokeLabel(grant)}
          disabled={revoking}
          onClick={onRevoke}
        />
      </header>
      <McpConsentPermissionsCard
        readOnly
        showWarning={false}
        title={SETTINGS_GRANTED_PERMISSIONS_TITLE}
        hint={SETTINGS_GRANTED_PERMISSIONS_HINT}
        groups={groups}
        grantedScopeIds={grant.scopes}
        idPrefix={`mcp-grant-${grant.clientId}`}
      />
    </article>
  );
}
