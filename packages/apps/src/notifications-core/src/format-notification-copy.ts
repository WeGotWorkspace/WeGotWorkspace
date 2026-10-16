import type {
  NotificationCopy,
  NotificationFacts,
  NotificationInboxItem,
} from "@/notifications-core/src/notifications-types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

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
    case "docs.thread_activity":
      return formatDocsThreadActivity(data);
    case "calendar.alert_due":
    case "tasks.alert_due":
      return formatAlertDue(item.domain, data);
    case "calendar.invite":
      return formatCalendarInvite(data);
    case "calendar.rsvp":
      return formatCalendarRsvp(data);
    case "calendar.shared":
    case "notes.shared":
    case "tasks.list_shared":
      return formatCollectionShared(item.domain, data);
    case "tasks.status_changed":
      return formatTaskStatusChanged(data);
    case "chat.message_posted":
      return formatChatMessagePosted(data);
    case "chat.mentioned":
      return formatChatMentioned(data);
    case "meet.started":
      return formatMeetStarted(data);
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
  return withActorTitle(
    actor,
    ` shared ${fileName} with you`,
    pathSubtitle(path || fileName, fileName),
  );
}

function formatDocsThreadActivity(data: NotificationFacts): NotificationCopy {
  const actor = trimStr(data.actor) || "Someone";
  let fileName = trimStr(data.fileName);
  const path = trimStr(data.path);
  if (!fileName) {
    fileName = path ? basename(path) || path : "a document";
  }
  const kind = trimStr(data.kind) || "comment";
  const isReply = data.isReply === true;
  const snippet = trimStr(data.snippet) || null;
  const noun = kind === "suggestion" ? "suggestion" : "comment";
  const titleRest = isReply ? ` replied on ${fileName}` : ` left a ${noun} on ${fileName}`;
  return withActorTitle(actor, titleRest, snippet);
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

function formatChatMentioned(data: NotificationFacts): NotificationCopy {
  const actor = trimStr(data.actor) || "Someone";
  const isDm =
    data.isDm === true ||
    trimStr(data.channelKind) === "dm" ||
    trimStr(data.channelUri).startsWith("chat-dm-");
  const where = channelTitle(trimStr(data.channelKind), trimStr(data.channelName));
  let snippet = trimStr(data.snippet);
  if (!snippet) {
    snippet = "mentioned you";
  }
  return withActorTitle(
    actor,
    isDm ? " mentioned you in a direct message" : ` mentioned you in ${where}`,
    snippet,
  );
}

function formatCalendarRsvp(data: NotificationFacts): NotificationCopy {
  const actor = trimStr(data.actor) || "Someone";
  let summary = trimStr(data.summary);
  if (!summary) {
    summary = "an event";
  }
  const status = rsvpStatusLabel(trimStr(data.participationStatus));
  const start = parseDate(data.start);
  const end = parseDate(data.end);
  return withActorTitle(
    actor,
    ` ${status} ${summary}`,
    start ? whenLabel("calendar", start, end) : null,
  );
}

function formatCollectionShared(domain: string, data: NotificationFacts): NotificationCopy {
  const actor = trimStr(data.actor) || "Someone";
  let name =
    trimStr(data.calendarName) ||
    trimStr(data.notebookName) ||
    trimStr(data.listName) ||
    trimStr(data.collectionName);
  if (!name) {
    name = domain === "notes" ? "a notebook" : domain === "tasks" ? "a task list" : "a calendar";
  }
  const access = trimStr(data.access) || "read";
  const noun = domain === "notes" ? "notebook" : domain === "tasks" ? "task list" : "calendar";
  return withActorTitle(actor, ` shared ${name} with you`, `${noun} access: ${access}`);
}

function formatTaskStatusChanged(data: NotificationFacts): NotificationCopy {
  const actor = trimStr(data.actor) || "Someone";
  let summary = trimStr(data.summary);
  if (!summary) {
    summary = "a task";
  }
  const to = trimStr(data.toStatus);
  const from = trimStr(data.fromStatus);
  const titleRest = to === "completed" ? ` completed ${summary}` : ` updated ${summary}`;
  const body = from && to ? `${from} → ${to}` : to || null;
  return withActorTitle(actor, titleRest, body);
}

function formatMeetStarted(data: NotificationFacts): NotificationCopy {
  const actor = trimStr(data.actor) || "Someone";
  const room = trimStr(data.room) || null;
  return withActorTitle(actor, " started a meeting", room);
}

function rsvpStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "accepted":
    case "accept":
      return "accepted";
    case "declined":
    case "decline":
      return "declined";
    case "tentative":
      return "tentatively accepted";
    default:
      return "responded to";
  }
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
