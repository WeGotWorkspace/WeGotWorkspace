import { DocsDocStatus } from "@/docs-core/src/docs-doc-status";
import type { DocsCollabIndicator } from "@/text-editor-core/docs-collab/docs-collab-indicator";

export type DocsCollabStatusIndicatorProps = {
  indicator: DocsCollabIndicator;
};

/** The one real-time status line in the Docs detail footer. */
export function DocsCollabStatusIndicator({ indicator }: DocsCollabStatusIndicatorProps) {
  if (!indicator.label) return null;
  return <DocsDocStatus status={indicator.label} kind={indicator.kind} />;
}
