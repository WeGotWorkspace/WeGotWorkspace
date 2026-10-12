import { useEffect, useState } from "react";
import {
  CONNECTION_PHASE_REVEAL_MS,
  type DocsCollabConnectionPhase,
} from "@/text-editor-core/docs-collab/docs-collab-connection-phase";

/**
 * Holds a transient connection phase back until it has lasted `delayMs`, and
 * drops it the moment the phase clears. A reconnect that resolves inside the
 * window is therefore never announced.
 */
export function useDocsCollabConnectionPhase(
  phase: DocsCollabConnectionPhase | null,
  delayMs: number = CONNECTION_PHASE_REVEAL_MS,
): DocsCollabConnectionPhase | null {
  const [revealed, setRevealed] = useState<DocsCollabConnectionPhase | null>(null);

  useEffect(() => {
    setRevealed(null);
    if (!phase) return;
    const timer = setTimeout(() => setRevealed(phase), delayMs);
    return () => clearTimeout(timer);
  }, [phase, delayMs]);

  return revealed;
}
