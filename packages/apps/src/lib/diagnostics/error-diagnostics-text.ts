import type {
  ErrorDiagnosticEntry,
  ErrorDiagnosticSource,
} from "@/lib/diagnostics/error-diagnostics-store";

export type ErrorDiagnosticsTextHeader = {
  build: string;
  userAgent: string;
  copiedAt: Date;
};

const SOURCE_LABELS: Record<ErrorDiagnosticSource, string> = {
  error: "uncaught error",
  unhandledrejection: "unhandled promise rejection",
  render: "app crashed while drawing",
  route: "page failed to load",
};

function entryBlock(
  entry: ErrorDiagnosticEntry,
  index: number,
  header: ErrorDiagnosticsTextHeader,
): string[] {
  const repeats = entry.count > 1 ? ` (${entry.count} times, last shown)` : "";
  const lines = [
    `--- Error ${index + 1} ---`,
    `Time: ${entry.time}${repeats}`,
    `App: ${entry.app}`,
    `Route: ${entry.route}`,
  ];
  // Only when it differs: an error from before an update or from another browser profile.
  if (entry.build !== header.build) lines.push(`Build: ${entry.build}`);
  if (entry.userAgent !== header.userAgent) lines.push(`Browser: ${entry.userAgent}`);
  lines.push(`Source: ${SOURCE_LABELS[entry.source] ?? entry.source}`);
  lines.push(`Message: ${entry.name}: ${entry.message}`);
  if (entry.stack.trim()) {
    lines.push("Stack:", entry.stack.trimEnd());
  } else {
    lines.push("Stack: (none)");
  }
  lines.push("");
  return lines;
}

/** Plain text for a bug report: a short header, then one block per error, newest first. */
export function formatErrorDiagnosticsText(
  entries: readonly ErrorDiagnosticEntry[],
  header: ErrorDiagnosticsTextHeader,
): string {
  const lines = [
    "WeGotWorkspace diagnostics",
    `Build: ${header.build}`,
    `Browser: ${header.userAgent}`,
    `Copied: ${header.copiedAt.toISOString()}`,
    entries.length > 0
      ? `Errors: ${entries.length}, newest first`
      : "Errors: none recorded on this device",
    "",
  ];
  entries.forEach((entry, index) => {
    lines.push(...entryBlock(entry, index, header));
  });
  return lines.join("\n");
}
