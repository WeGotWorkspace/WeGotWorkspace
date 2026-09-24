import { useRef } from "react";
import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { FeatureRow } from "@/admin-core/src/admin-workspace-widgets";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";

export type AdminPluginsPaneProps = {
  controller: AdminControllerState;
};

export function AdminPluginsPane({ controller }: AdminPluginsPaneProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { confirmDialog, requestConfirm } = useConfirmDialog();

  return (
    <Card title="Plugin lifecycle">
      <div className="mb-3 flex justify-end">
        <Button
          label="Install plugin ZIP"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            void controller.actions.installPluginZip(file);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {controller.plugins.length === 0 ? (
        <p className="text-sm text-muted-foreground">No plugins discovered.</p>
      ) : (
        controller.plugins.map((plugin) => (
          <FeatureRow
            key={plugin.id}
            label={plugin.name}
            desc={`${plugin.id}${plugin.source ? ` (${plugin.source})` : ""}`}
            value={plugin.active}
            onChange={(next) => {
              if (!next && plugin.active) {
                requestConfirm({
                  title: `Disable ${plugin.name}?`,
                  description:
                    "Drive file handlers and plugin-provided app actions will be unavailable until you enable it again.",
                  confirmLabel: "Disable plugin",
                  cancelLabel: "Cancel",
                  variant: "destructive",
                  onConfirm: () => {
                    void controller.actions.setPluginActive(plugin.id, false);
                  },
                });
                return;
              }
              void controller.actions.setPluginActive(plugin.id, next);
            }}
          />
        ))
      )}
      {confirmDialog}
    </Card>
  );
}
