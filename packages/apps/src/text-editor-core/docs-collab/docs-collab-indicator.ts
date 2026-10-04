import { docsLabels, type DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsCollabConnectionPhase } from "@/text-editor-core/docs-collab/docs-collab-connection-phase";

export type DocsCollabIndicatorKind =
  "offline" | DocsCollabConnectionPhase | "saveOnly" | "saving" | "live" | "saved" | "idle";

export type DocsCollabIndicatorInput = {
  online: boolean;
  /**
   * A transient phase that has already cleared its 1.5 s hold. Callers pass the
   * output of `useDocsCollabConnectionPhase`, never the raw phase.
   */
  phase?: DocsCollabConnectionPhase | null;
  /** A save is in flight, or local edits have not reached the server yet. */
  saving: boolean;
  /** Everything typed so far is on the server. */
  saved: boolean;
  /** Display names of the other people editing right now. */
  liveNames: readonly string[];
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

/** Beyond this, the remaining names collapse into "and N others". */
export const DOCS_COLLAB_INDICATOR_MAX_NAMES = 3;

/** "Ada"; "Ada and Bo"; "Ada, Bo and Cy"; "Ada, Bo, Cy and 2 others". */
export function formatDocsCollabLiveNames(
  names: readonly string[],
  labels: DocsUILabels = docsLabels,
): string {
  const present = names.map((name) => name.trim()).filter((name) => name.length > 0);
  if (present.length === 0) return "";
  if (present.length === 1) return present[0]!;

  if (present.length <= DOCS_COLLAB_INDICATOR_MAX_NAMES) {
    const last = present[present.length - 1]!;
    return labels.statusNamesPair(present.slice(0, -1).join(", "), last);
  }

  const shown = present.slice(0, DOCS_COLLAB_INDICATOR_MAX_NAMES).join(", ");
  const hidden = present.length - DOCS_COLLAB_INDICATOR_MAX_NAMES;
  return hidden === 1
    ? labels.statusNamesOverflowOne(shown)
    : labels.statusNamesOverflowMany(shown, hidden);
}

const PHASE_LABEL_KEYS = {
  connecting: "statusConnecting",
  reconnecting: "statusReconnecting",
  rejoining: "statusRejoining",
} as const satisfies Record<DocsCollabConnectionPhase, keyof DocsUILabels>;

/**
 * Docs shows exactly one real-time indicator, so the states are ordered by how
 * much the reader needs them: losing the network outranks a phase that has
 * already proven slow, which outranks a degraded link, which outranks an
 * in-flight save, which outranks who else is here. A save landing while someone
 * else is editing therefore falls back to "Live with …", not "Saved" — the
 * company is the more useful fact once the bytes are safe.
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

  const names = formatDocsCollabLiveNames(input.liveNames, labels);
  if (names) return { kind: "live", label: labels.statusLiveWith(names) };

  if (input.saved) return { kind: "saved", label: labels.statusSaved };
  return { kind: "idle", label: "" };
}
