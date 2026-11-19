import type { ReactNode } from "react";
import { Tag, type TagTone } from "@/tag/src/tag";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

type PageState = { label: string; tone: TagTone };

/** The page's state in one word, beside its title (replaces the status callouts). */
export function adminPageState(controller: AdminControllerState): PageState | null {
  switch (controller.section) {
    case "email-delivery":
      return controller.mailDelivery.capability.canSubmit
        ? { label: "Can send", tone: "success" }
        : { label: "Cannot send", tone: "warning" };
    case "updates": {
      const updates = controller.updates;
      if (updates.installChannel === "docker") return null;
      if (updates.inProgress) return { label: "Updating", tone: "pending" };
      if (updates.updateAvailable) return { label: "Update available", tone: "warning" };
      if (updates.lastCheckedAt) return { label: "Up to date", tone: "success" };
      return null;
    }
    case "search":
      return controller.searchReindex.inProgress
        ? { label: "Reindexing", tone: "pending" }
        : { label: "Idle", tone: "success" };
    default:
      return null;
  }
}

export function AdminPageStatus({ controller }: { controller: AdminControllerState }): ReactNode {
  const state = adminPageState(controller);
  return state ? <Tag label={state.label} tone={state.tone} dot /> : null;
}
