import { DocsDocStatus } from "@/docs-core/src/docs-doc-status";
import { docsLabels } from "@/docs-core/src/docs-labels";
import type { DocsCollabIndicator } from "@/text-editor-core/docs-collab/docs-collab-indicator";

export type DocsCollabStatusIndicatorProps = {
  indicator: DocsCollabIndicator;
};

/** The one real-time status line in the Docs detail footer. */
export function DocsCollabStatusIndicator({ indicator }: DocsCollabStatusIndicatorProps) {
  // Idle = online, in the room, nothing waiting to sync: say so instead of going blank.
  if (indicator.kind === "idle") {
    return <DocsDocStatus status={docsLabels.statusAllSaved} kind="saved" />;
  }
  if (!indicator.label) return null;
  return <DocsDocStatus status={indicator.label} kind={indicator.kind} />;
}
