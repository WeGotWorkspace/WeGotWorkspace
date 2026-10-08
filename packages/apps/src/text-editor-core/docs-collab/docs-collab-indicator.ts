import { docsLabels, type DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsCollabConnectionPhase } from "@/text-editor-core/docs-collab/docs-collab-connection-phase";

export type DocsCollabIndicatorKind =
  | "offline"
  | DocsCollabConnectionPhase
  | "saveOnly"
  | "saving"
  | "idle"
  /** A docStatus the indicator does not model — passed through verbatim. */
  | "message";

/**
 * The `docStatus` values the indicator now speaks for. Anything outside this set
 * is an exceptional message (a failed snapshot, an unexpected error) that still
 * owns the slot, because swallowing it would hide a real problem.
 */
const SUPERSEDED_DOC_STATUSES: ReadonlySet<string> = new Set([
  "",
  "Connecting to collaborators…",
  "Reconnecting…",
  "Rejoining…",
  "Editing offline",
]);

export function indicatorSupersedesDocStatus(status: string): boolean {
  return SUPERSEDED_DOC_STATUSES.has(status);
}

export type DocsCollabIndicatorInput = {
  online: boolean;
  /**
   * A transient phase that has already cleared its 1.5 s hold. Callers pass the
   * output of `useDocsCollabConnectionPhase`, never the raw phase.
   */
  phase?: DocsCollabConnectionPhase | null;
  /** A save is in flight, or local edits have not reached the server yet. */
  saving: boolean;
  /**
   * The direct connection is unavailable, so edits only travel on save. Until an
   * HTTP fallback exists this is the honest story, hence the softer copy.
   */
  saveOnly?: boolean;
};

export type DocsCollabIndicator = {
  kind: DocsCollabIndicatorKind;
  label: string;
};

const PHASE_LABEL_KEYS = {
  connecting: "statusConnecting",
  reconnecting: "statusReconnecting",
  rejoining: "statusRejoining",
} as const satisfies Record<DocsCollabConnectionPhase, keyof DocsUILabels>;

/**
 * Docs shows exactly one real-time indicator, so the states are ordered by how
 * much the reader needs them: losing the network outranks a phase that has
 * already proven slow, which outranks a degraded link, which outranks an
 * in-flight save. Who else is here is a dot on the footer avatars, and a
 * landed save is a dot on the last-edited tag, so neither becomes a sentence.
 */
export function deriveDocsCollabIndicator(
  input: DocsCollabIndicatorInput,
  labels: DocsUILabels = docsLabels,
): DocsCollabIndicator {
  if (!input.online) return { kind: "offline", label: labels.statusOffline };
  if (input.phase) {
    return { kind: input.phase, label: labels[PHASE_LABEL_KEYS[input.phase]] };
  }
  if (input.saveOnly) return { kind: "saveOnly", label: labels.statusChangesSyncWhenSaved };
  if (input.saving) return { kind: "saving", label: labels.statusSaving };
  return { kind: "idle", label: "" };
}
