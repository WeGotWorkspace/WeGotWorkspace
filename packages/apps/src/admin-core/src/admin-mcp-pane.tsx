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
import { FeatureRow } from "@/admin-core/src/admin-workspace-widgets";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminMcpPaneProps = {
  controller: AdminControllerState;
};

export function AdminMcpPane({ controller }: AdminMcpPaneProps) {
  const [confirmOff, setConfirmOff] = useState(false);

  const requestToggle = (next: boolean) => {
    if (!next && controller.settingsForm.mcpEnabled) {
      setConfirmOff(true);
      return;
    }
    controller.setSettingsForm((prev) => ({ ...prev, mcpEnabled: next }));
  };

  return (
    <>
      <Card title="MCP access">
        <p className="admin-mcp-pane__lead">
          When this is on, signed-in users can connect Claude, ChatGPT, or Mistral to act as them
          through MCP. Turning it off immediately revokes every outstanding assistant grant on this
          instance.
        </p>
        <FeatureRow
          label="Allow connected assistants"
          desc="Off by default. Users still sign in on the consent page when they connect."
          value={controller.settingsForm.mcpEnabled}
          onChange={requestToggle}
        />
        <Button label="Save changes" variant="primary" onClick={controller.actions.saveSettings} />
      </Card>
      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off connected assistants?</AlertDialogTitle>
            <AlertDialogDescription>
              Every assistant grant will be revoked. Re-enabling does not restore old connections —
              users must connect again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                controller.setSettingsForm((prev) => ({ ...prev, mcpEnabled: false }));
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
