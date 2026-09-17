import { Card } from "@/card/src/card";
import { FeatureRow } from "@/admin-core/src/admin-workspace-widgets";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminMailPaneProps = {
  controller: AdminControllerState;
};

export function AdminMailPane({ controller }: AdminMailPaneProps) {
  const enabled = controller.settingsForm.mailEnabled;

  return (
    <Card title="Mail app">
      <p className="admin-mcp-pane__lead">
        Turns the Mail app, JMAP mail capability, and MCP mail tools off for everyone. Each person
        still configures their own IMAP and SMTP servers in Settings.
      </p>
      <FeatureRow
        label="Enable Mail"
        desc="Instance kill-switch. Does not store IMAP or SMTP hosts."
        value={enabled}
        onChange={(next) => {
          void controller.actions.saveSettings({ mailEnabled: next });
        }}
      />
    </Card>
  );
}
