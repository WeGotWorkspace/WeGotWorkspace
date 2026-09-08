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
        Assistants you connect can act as you on this instance. You sign in again on the consent
        page. Content they read may leave this instance for the vendor’s model.{" "}
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
        <Card key={grant.clientId} title={grant.clientOrigin || grant.clientName}>
          <dl className="settings-assistants-pane__meta">
            <div>
              <dt>Client</dt>
              <dd>{grant.clientName}</dd>
            </div>
            <div>
              <dt>Connected</dt>
              <dd>{grant.connectedAt}</dd>
            </div>
            <div>
              <dt>Last used</dt>
              <dd>{grant.lastUsedAt ?? "Never"}</dd>
            </div>
            <div>
              <dt>Scopes</dt>
              <dd>{grant.scopes.join(", ")}</dd>
            </div>
          </dl>
          <Button
            variant="subtle"
            size="sm"
            disabled={revokingId === grant.clientId}
            onClick={() => setPending(grant)}
          >
            Revoke access
          </Button>
        </Card>
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
