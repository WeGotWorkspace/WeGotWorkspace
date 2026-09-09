import { useState } from "react";
import { Button } from "@/button/src/button";
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
import type { SettingsMcpGrant } from "@/settings-core/src/settings-types";
import type { SettingsMcpGrantsState } from "@/settings-core/src/use-settings-mcp-grants";
import { formatGrantInstant, groupMcpScopeIds } from "@/settings-core/src/mcp-scope-labels";

export const MCP_CONNECT_GUIDE_HREF =
  "https://github.com/WeGotWorkspace/WeGotWorkspace/blob/main/docs/mcp-connect.md";

export type SettingsAssistantsPaneProps = {
  assistants: SettingsMcpGrantsState;
};

export function SettingsAssistantsPane({ assistants }: SettingsAssistantsPaneProps) {
  const { grants, loading, revokingId, error, revoke } = assistants;
  const [pending, setPending] = useState<SettingsMcpGrant | null>(null);

  return (
    <div className="settings-assistants-pane">
      <p className="settings-assistants-pane__lead">
        Assistants you connect can act as you on this instance. Content they read may leave this
        instance for the vendor’s model. To change permissions, revoke access and connect again.{" "}
        <a href={MCP_CONNECT_GUIDE_HREF} target="_blank" rel="noreferrer">
          Connect guide
        </a>
      </p>
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
      {grants.map((grant) => (
        <GrantCard
          key={grant.clientId}
          grant={grant}
          revoking={revokingId === grant.clientId}
          onRevoke={() => setPending(grant)}
        />
      ))}

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

function GrantCard({
  grant,
  revoking,
  onRevoke,
}: {
  grant: SettingsMcpGrant;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const title = grant.clientOrigin || grant.clientName;
  const showName = Boolean(grant.clientName && grant.clientName !== grant.clientOrigin);
  const groups = groupMcpScopeIds(grant.scopes);

  return (
    <Card title={title} description={showName ? grant.clientName : undefined}>
      <dl className="settings-assistants-pane__meta">
        <div>
          <dt>Connected</dt>
          <dd>{formatGrantInstant(grant.connectedAt, grant.connectedAt)}</dd>
        </div>
        <div>
          <dt>Last used</dt>
          <dd>{formatGrantInstant(grant.lastUsedAt)}</dd>
        </div>
      </dl>
      <div className="settings-assistants-pane__grants">
        <p className="settings-assistants-pane__grants-label" id={`mcp-grant-${grant.clientId}`}>
          Permissions
        </p>
        <ul
          className="settings-assistants-pane__apps"
          aria-labelledby={`mcp-grant-${grant.clientId}`}
        >
          {groups.map((group) => (
            <li key={group.label} className="settings-assistants-pane__app">
              <span className="settings-assistants-pane__app-name">{group.label}</span>
              <ul className="settings-assistants-pane__actions">
                {group.scopes.map((scope) => (
                  <li key={scope.id}>
                    <span className="settings-assistants-pane__action">{scope.actionLabel}</span>
                    <code className="settings-assistants-pane__scope-id">{scope.id}</code>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <Button variant="subtle" size="sm" disabled={revoking} onClick={onRevoke}>
        Revoke access
      </Button>
    </Card>
  );
}
