import { useState } from "react";
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
import { FeatureRow } from "@/admin-core/src/admin-workspace-widgets";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";
import { buildMcpEndpointUrl } from "@/settings-core/src/mcp-endpoint";
import { McpEndpointUrlRow } from "@/settings-core/src/mcp-endpoint-url-row";

export type AdminMcpPaneProps = {
  controller: AdminControllerState;
  /** Override for Storybook. Live defaults to current origin + `/mcp`. */
  mcpEndpointUrl?: string;
};

export function AdminMcpPane({ controller, mcpEndpointUrl }: AdminMcpPaneProps) {
  const [confirmOff, setConfirmOff] = useState(false);
  const enabled = controller.settingsForm.mcpEnabled;
  const endpointUrl = mcpEndpointUrl ?? buildMcpEndpointUrl();

  const persistEnabled = (next: boolean) => {
    void controller.actions.saveSettings({ mcpEnabled: next });
  };

  const requestToggle = (next: boolean) => {
    if (!next && enabled) {
      setConfirmOff(true);
      return;
    }
    persistEnabled(next);
  };

  return (
    <>
      <Card title="Connected assistants">
        <p className="admin-mcp-pane__lead">
          People can connect Claude, ChatGPT, or Mistral. Turning this off disconnects them for
          everyone.
        </p>
        <FeatureRow label="Allow connected assistants" value={enabled} onChange={requestToggle} />
        {enabled ? (
          <McpEndpointUrlRow
            className="admin-mcp-pane__endpoint"
            url={endpointUrl}
            inputId="admin-mcp-endpoint"
          />
        ) : null}
      </Card>
      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off connected assistants?</AlertDialogTitle>
            <AlertDialogDescription>
              Turning this off disconnects all assistants. People will need to connect again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                persistEnabled(false);
                setConfirmOff(false);
              }}
            >
              Turn off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
