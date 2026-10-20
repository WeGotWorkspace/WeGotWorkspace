import { AlertTriangle, CheckCircle2, CircleX, type LucideIcon } from "lucide-react";

/** Browser origin plus the install base path, for the APP_URL warning button. */
export function appUrlFromBrowserLocation(origin: string, baseUri: string): string {
  const trimmedOrigin = origin.replace(/\/+$/, "");
  const base = baseUri.trim();
  if (base === "" || base === "/") return trimmedOrigin;
  return `${trimmedOrigin}/${base.replace(/^\/+|\/+$/g, "")}`;
}

/**
 * Same hosts the API treats as an unset APP_URL (PublicAppUrl::LOOPBACK_HOSTS).
 * URL.hostname keeps IPv6 brackets; the API strips them before comparing.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Matches the API's APP_URL warnings (unset, or a local address) by their text. */
export function isAppUrlWarning(warning: string): boolean {
  return (
    warning.startsWith("APP_URL is not set") || warning.startsWith("APP_URL is a local address")
  );
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export type UpdateLogRow = { id: string; date: string | null; level: string; message: string };

export type ServerCheckTone = "error" | "warning" | "success";

export type CheckVisual = { Icon: LucideIcon; tone: ServerCheckTone };

export function getServerCheckVisual(check: {
  ok: boolean;
  status?: string;
  detail?: string;
}): CheckVisual {
  const normalizedStatus = (check.status ?? "").toLowerCase();
  const normalizedDetail = (check.detail ?? "").toLowerCase();

  if (
    normalizedStatus === "error" ||
    normalizedStatus === "fail" ||
    normalizedStatus === "failed"
  ) {
    return { Icon: CircleX, tone: "error" };
  }

  if (
    normalizedStatus === "warn" ||
    normalizedStatus === "warning" ||
    normalizedStatus === "unknown"
  ) {
    return { Icon: AlertTriangle, tone: "warning" };
  }

  if (normalizedDetail.startsWith("unknown")) {
    return { Icon: AlertTriangle, tone: "warning" };
  }

  if (check.ok) {
    return { Icon: CheckCircle2, tone: "success" };
  }

  return { Icon: CircleX, tone: "error" };
}

export function parseUpdateLogLine(line: string, index: number): UpdateLogRow {
  const matchWithLevel = line.match(/^\[([^\]]+)\]\s+\[([A-Z]+)\]\s+(.*)$/);
  if (matchWithLevel) {
    return {
      id: `${index}`,
      date: matchWithLevel[1] ?? null,
      level: matchWithLevel[2] ?? "INFO",
      message: matchWithLevel[3] ?? "",
    };
  }
  const matchWithoutLevel = line.match(/^\[([^\]]+)\]\s+(.*)$/);
  if (matchWithoutLevel) {
    return {
      id: `${index}`,
      date: matchWithoutLevel[1] ?? null,
      level: "INFO",
      message: matchWithoutLevel[2] ?? "",
    };
  }

  return {
    id: `${index}`,
    date: null,
    level: "INFO",
    message: line,
  };
}

export const SECURITY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "starttls", label: "STARTTLS" },
  { value: "ssl", label: "SSL/TLS" },
] as const;

export const TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Stockholm",
  "Europe/Madrid",
  "Europe/Athens",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
] as const;

export const UPDATE_PROGRESS_STEPS: Array<{ label: string; phases: string[] }> = [
  { label: "Downloading", phases: ["downloading"] },
  { label: "Extracting", phases: ["extracting"] },
  { label: "Backing up database", phases: ["backing_up"] },
  { label: "Applying update", phases: ["applying_files", "running_migrations"] },
];

export function formatHumanDateTime(input: string | null): string {
  if (!input) return "-";
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return input;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function formatByteCount(input: number | null | undefined): string {
  const bytes = Math.max(0, Number(input ?? 0));
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function isProtectedGroup(groupId: string): boolean {
  return groupId === "principals/groups/administrators";
}
