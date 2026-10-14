/** Shared detection for Cursor-injected commit trailers and PR description footers. */

export const CURSOR_AGENT_AUTHOR_EMAIL = "cursoragent@cursor.com";

const CURSOR_AGENT_AUTHOR_DOMAINS = new Set([
  CURSOR_AGENT_AUTHOR_EMAIL.split("@")[1],
  "cursor.sh",
]);

const CURSOR_COMMIT_ATTRIBUTION_LINE_PATTERNS = [
  /^Co-authored-by:\s*Cursor\s*<cursoragent@cursor\.com>\s*$/i,
  /^Made-with:\s*Cursor\s*$/i,
];

const CURSOR_PR_ATTRIBUTION_LINE_PATTERNS = [
  /^Made with Cursor\s*$/i,
  /^Made with \[Cursor\](?:\([^)]*\))?\s*$/i,
  ...CURSOR_COMMIT_ATTRIBUTION_LINE_PATTERNS,
];

export function isCursorAgentAuthorEmail(email) {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  const at = normalized.lastIndexOf("@");
  if (at < 1) {
    return false;
  }
  return CURSOR_AGENT_AUTHOR_DOMAINS.has(normalized.slice(at + 1));
}

function isCursorCommitAttributionLine(line) {
  const trimmed = line.trim();
  return CURSOR_COMMIT_ATTRIBUTION_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isCursorPrAttributionLine(line) {
  const trimmed = line.trim();
  return CURSOR_PR_ATTRIBUTION_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function containsCursorAttribution(message) {
  return message.split("\n").some(isCursorCommitAttributionLine);
}

const CURSOR_ATTRIBUTION_SUBSTRING_PATTERNS = [
  /\bMade with Cursor\b/i,
  /Made with\s+\[Cursor\]/i,
  /Co-authored-by:\s*Cursor\s*<cursoragent@cursor\.com>/i,
  /Made-with:\s*Cursor\b/i,
];

export function containsCursorPrAttribution(body) {
  if (!body?.trim()) {
    return false;
  }
  if (body.split("\n").some(isCursorPrAttributionLine)) {
    return true;
  }
  return CURSOR_ATTRIBUTION_SUBSTRING_PATTERNS.some((pattern) => pattern.test(body));
}

export function stripCursorAttribution(message) {
  const lines = message.split("\n");
  const kept = lines.filter((line) => !isCursorCommitAttributionLine(line));

  while (kept.length > 0 && kept[kept.length - 1] === "") {
    kept.pop();
  }

  return kept.join("\n").concat(kept.length > 0 ? "\n" : "");
}
