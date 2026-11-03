// Decides whether a delivery issue still needs its plain-language Summary.
// Rules: .agents/skills/developer/plain-language.md. Used by
// .github/workflows/require-issue-summary.yml.

export const NEEDS_SUMMARY_LABEL = "needs-summary";

const KIND_LABELS = new Set(["type:epic", "type:task", "type:chore", "type:bug"]);
const SUMMARY_LINES = ["What", "Who notices", "If we wait"];

/** A Summary line counts when it has at least two words after its marker. */
function hasFilledLine(body, marker) {
  const pattern = new RegExp(String.raw`^[ \t>*-]*\*{0,2}${marker}:\*{0,2}[ \t]*(.*)$`, "gim");
  for (const match of body.matchAll(pattern)) {
    const words = match[1]
      .trim()
      .split(/\s+/)
      .filter((word) => /[\p{L}\p{N}]/u.test(word));
    if (words.length >= 2) return true;
  }
  return false;
}

/** True when the body has all three Summary lines, each filled in. */
export function hasSummary(body) {
  const text = body ?? "";
  return SUMMARY_LINES.every((marker) => hasFilledLine(text, marker));
}

/** True for Epics, Tasks, Chores and Bugs: the issues that need a Summary. */
export function isDeliveryIssue({ labels = [], typeName = null }) {
  return typeName === "Bug" || labels.some((label) => KIND_LABELS.has(label));
}

/**
 * Returns "add", "remove" or null: what to do with the needs-summary label.
 * Closed issues are left alone.
 */
export function summaryLabelAction({ state = "open", labels = [], typeName = null, body = "" }) {
  if (state !== "open") return null;
  const labelled = labels.includes(NEEDS_SUMMARY_LABEL);
  const complete = hasSummary(body);
  if (complete) return labelled ? "remove" : null;
  if (!isDeliveryIssue({ labels, typeName })) return null;
  return labelled ? null : "add";
}
