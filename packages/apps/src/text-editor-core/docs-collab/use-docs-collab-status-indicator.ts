import { docsCollabConnectionPhase } from "@/text-editor-core/docs-collab/docs-collab-connection-phase";
import {
  deriveDocsCollabIndicator,
  indicatorSupersedesDocStatus,
  type DocsCollabIndicator,
} from "@/text-editor-core/docs-collab/docs-collab-indicator";
import { useDocsCollabConnectionPhase } from "@/text-editor-core/docs-collab/use-docs-collab-connection-phase";

export type UseDocsCollabStatusIndicatorOptions = {
  docStatus: string;
  online: boolean;
  /** Local edits that have not reached the server. */
  pendingSync: boolean;
  /** The last save attempt failed; the retry toast already owns that story. */
  failedSync: boolean;
  /** People in the room we have given up reaching directly. */
  unreachableCount: number;
};

/**
 * Collapses the collab session into the single footer indicator, holding
 * transient phases for 1.5 s on the way.
 */
export function useDocsCollabStatusIndicator({
  docStatus,
  online,
  pendingSync,
  failedSync,
  unreachableCount,
}: UseDocsCollabStatusIndicatorOptions): DocsCollabIndicator {
  const phase = useDocsCollabConnectionPhase(docsCollabConnectionPhase(docStatus));

  if (!indicatorSupersedesDocStatus(docStatus)) {
    return { kind: "message", label: docStatus };
  }

  return deriveDocsCollabIndicator({
    online,
    phase,
    saving: pendingSync && !failedSync,
    saveOnly: unreachableCount > 0,
  });
}
