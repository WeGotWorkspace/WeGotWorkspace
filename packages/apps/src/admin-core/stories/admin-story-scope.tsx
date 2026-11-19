import type { ReactNode } from "react";
import { AutosaveStatusProvider } from "@/ui/autosave-status";
import { AdminSettingsAutosave } from "@/admin-core/src/use-admin-settings-autosave";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";
import "@/admin-core/src/admin-workspace.css";

export function AdminStoryScope({ children }: { children: ReactNode }) {
  return (
    <div className="admin-workspace admin-story-scope">
      <div className="mx-auto max-w-2xl p-6 md:p-10">{children}</div>
    </div>
  );
}

/**
 * A settings pane outside Admin: the story scope plus the autosave editor the pane reads
 * (`useAdminSettingsEditor`) and the status it reports to.
 */
export function AdminPaneScope({
  controller,
  children,
}: {
  controller: AdminControllerState;
  children: ReactNode;
}) {
  return (
    <AdminStoryScope>
      <AutosaveStatusProvider>
        <AdminSettingsAutosave controller={controller}>{children}</AdminSettingsAutosave>
      </AutosaveStatusProvider>
    </AdminStoryScope>
  );
}
