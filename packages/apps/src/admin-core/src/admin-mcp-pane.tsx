import { useState } from "react";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
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
import { buttonVariants } from "@/button/src/button";
import { FeatureRow } from "@/admin-core/src/admin-workspace-widgets";
import { useAdminSettingsEditor } from "@/admin-core/src/use-admin-settings-autosave";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";
import { buildMcpEndpointUrl } from "@/lib/mcp-endpoint";
import { McpEndpointUrlRow } from "@/settings-core/src/mcp-endpoint-url-row";

export type AdminMcpPaneProps = {
  controller: AdminControllerState;
  /** Storybook / API override. Live falls back to current origin + `/mcp`. */
  mcpEndpointUrl?: string;
};

export function AdminMcpPane({ controller, mcpEndpointUrl }: AdminMcpPaneProps) {
  const [confirmOff, setConfirmOff] = useState(false);
  const enabled = controller.settingsForm.mcpEnabled;
  const endpointUrl = mcpEndpointUrl ?? buildMcpEndpointUrl();

  const { choose } = useAdminSettingsEditor();
  const persistEnabled = (next: boolean) => choose({ mcpEnabled: next });

  const requestToggle = (next: boolean) => {
    if (!next && enabled) {
      setConfirmOff(true);
      return;
    }
    persistEnabled(next);
  };

  return (
    <>
      <WorkspacePageSection>
        <FeatureRow
          label="Allow connected assistants"
          desc="People choose for themselves in Settings. Turning this off disconnects everyone."
          value={enabled}
          onChange={requestToggle}
        />
        {enabled ? (
          <McpEndpointUrlRow
            className="admin-mcp-pane__endpoint"
            url={endpointUrl}
            inputId="admin-mcp-endpoint"
          />
        ) : null}
      </WorkspacePageSection>
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
