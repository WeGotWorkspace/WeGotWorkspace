import type {
  NotificationCopy,
  NotificationFacts,
  NotificationInboxItem,
} from "@/notifications-core/src/notifications-types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Tray / OS toast copy. Storybook fixtures use the same raw `data` shape as live producers.
 * When `data` is missing/empty, stored title/body win (legacy rows).
 */
export function formatNotificationCopy(
  item: Pick<NotificationInboxItem, "domain" | "action" | "data" | "title" | "body">,
): NotificationCopy {
  const data = item.data;
  if (data == null || Object.keys(data).length === 0) {
    return { title: item.title, body: item.body };
  }
  const key = `${item.domain}.${item.action}`;
  switch (key) {
    case "docs.shared":
      return formatDocsShared(data);
    case "calendar.alert_due":
    case "tasks.alert_due":
      return formatAlertDue(item.domain, data);
    case "calendar.invite":
      return formatCalendarInvite(data);
    case "chat.message_posted":
      return formatChatMessagePosted(data);
    default:
      return { title: item.title, body: item.body };
  }
}

function formatDocsShared(data: NotificationFacts): NotificationCopy {
  const actor = trimStr(data.actor) || "Someone";
  let fileName = trimStr(data.fileName);
  const path = trimStr(data.path);
  if (!fileName) {
    fileName = path ? basename(path) || path : "a document";
  }
  return withActorTitle(actor, ` shared ${fileName} with you`, pathSubtitle(path || fileName, fileName));
}

function formatAlertDue(domain: string, data: NotificationFacts): NotificationCopy {
  let title = trimStr(data.summary);
  if (!title) {
    title = domain === "tasks" ? "Task reminder" : "Calendar reminder";
  }
  const start = parseDate(data.start);
  const end = parseDate(data.end);
  return {
    title,
    body: start ? whenLabel(domain, start, end) : null,
  };
}

function formatCalendarInvite(data: NotificationFacts): NotificationCopy {
  const actor = trimStr(data.actor) || "Someone";
  let summary = trimStr(data.summary);
  if (!summary) {
    summary = "an event";
  }
  const start = parseDate(data.start);
  const end = parseDate(data.end);
  const location = trimStr(data.location) || null;
  const parts: string[] = [];
  if (start) {
    parts.push(whenLabel("calendar", start, end));
  }
  if (location) {
    parts.push(location);
  }
  return withActorTitle(
    actor,
    ` invited you to ${summary}`,
    parts.length === 0 ? null : parts.join(" · "),
  );
}

function formatChatMessagePosted(data: NotificationFacts): NotificationCopy {
  const actor = trimStr(data.actor) || "Someone";
  const isDm =
    data.isDm === true ||
    trimStr(data.channelKind) === "dm" ||
    trimStr(data.channelUri).startsWith("chat-dm-");
  const where = channelTitle(trimStr(data.channelKind), trimStr(data.channelName));
  let snippet = trimStr(data.snippet);
  if (!snippet) {
    snippet = "New message";
  }
  return withActorTitle(
    actor,
    isDm ? " sent you a direct message" : ` sent a message in ${where}`,
    snippet,
  );
}

function withActorTitle(actor: string, titleRest: string, body: string | null): NotificationCopy {
  return {
    title: `${actor}${titleRest}`,
    titleActor: actor,
    titleRest,
    body,
  };
}

/** Match PHP AlertDueNotify::whenLabel (D j M · H:i). */
export function whenLabel(domain: string, start: Date, end: Date | null): string {
  const day = formatDay(start);
  const startTime = formatTime(start);
  if (domain === "tasks") {
    return `Due ${day} · ${startTime}`;
  }
  if (end && end.getTime() !== start.getTime()) {
    const endTime = formatTime(end);
    if (sameYmd(start, end)) {
      return `${day} · ${startTime} – ${endTime}`;
    }
    return `${day} · ${startTime} – ${formatDay(end)} · ${endTime}`;
  }
  return `${day} · ${startTime}`;
}

function channelTitle(kind: string, channelName: string): string {
  const name = channelName || "chat";
  if (kind === "meeting") {
    return name;
  }
  return `#${name.toLowerCase()}`;
}

function pathSubtitle(path: string, name: string): string | null {
  const normalized = path.trim();
  if (!normalized || normalized === name) {
    return null;
  }
  return normalized;
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function trimStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms);
}

/** Format in the instant's UTC components to match PHP ATOM Z fixtures. */
function formatDay(d: Date): string {
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function formatTime(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function sameYmd(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
