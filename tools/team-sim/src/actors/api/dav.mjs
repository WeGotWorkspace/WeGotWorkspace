import { uuid } from "../../client/ids.mjs";
import { USING, jmap1 } from "../../client/jmap.mjs";
import { need } from "./collab.mjs";

/**
 * Native calendar, contacts and reminders apps (Apple's on a Mac or iPhone,
 * DAVx5 on Android) over CalDAV/CardDAV. Each behaves like a client: it keeps
 * a local copy per collection, syncs with `sync-collection` at most every
 * SYNC_EVERY_MS, writes with `If-Match` from that copy, and on a 412 refetches,
 * applies its change again and retries once, as the real apps do. Each writes
 * its own dialect (see DIALECTS).
 */
export const SYNC_EVERY_MS = 3 * 60000;
const ZONE = "Europe/Amsterdam";

const stamp = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fold = (lines) => `${lines.filter(Boolean).join("\r\n")}\r\n`;
const local = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
};
const VTIMEZONE = ["BEGIN:VTIMEZONE", `TZID:${ZONE}`, "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "DTSTART:19810329T020000", "TZNAME:CEST", "TZOFFSETTO:+0200", "END:DAYLIGHT", "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "DTSTART:19961027T030000", "TZNAME:CET", "TZOFFSETTO:+0100", "END:STANDARD", "END:VTIMEZONE"];

/**
 * What each app writes. Approximations from the apps' documented output, not
 * yet recorded from the real apps (spec: record once, then make fictional).
 * `markers` are properties a round trip through the server must keep.
 */
export const DIALECTS = {
  apple: {
    recorded: false,
    prodid: (device) => (device === "phone" ? "-//Apple Inc.//iPhone OS 18.1//EN" : "-//Apple Inc.//macOS 15.1//EN"),
    eventExtra: () => ["X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC", "TRANSP:OPAQUE"],
    alarm: () => { const id = uuid().toUpperCase(); return ["BEGIN:VALARM", `X-WR-ALARMUID:${id}`, `UID:${id}`, "TRIGGER:-PT15M", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "X-APPLE-DEFAULT-ALARM:TRUE", "END:VALARM"]; },
    todoExtra: (seq) => ["PRIORITY:0", `X-APPLE-SORT-ORDER:${seq}`],
    vcardVersion: "3.0",
    card: (p) => [`EMAIL;type=INTERNET;type=WORK;type=pref:${p.email}`, `TEL;type=CELL;type=VOICE;type=pref:${p.phone}`, `item1.TEL:${p.phone.replace(/\d{2}$/, "00")}`, "item1.X-ABLabel:Studio"],
    markers: { event: ["X-APPLE-TRAVEL-ADVISORY-BEHAVIOR", "X-WR-ALARMUID"], card: ["X-ABLabel"], todo: ["X-APPLE-SORT-ORDER"] },
  },
  davx5: {
    recorded: false,
    prodid: () => "+//IDN bitfire.at//ical4android (org.fossify.calendar)",
    eventExtra: () => ["CLASS:PUBLIC", "STATUS:CONFIRMED"],
    alarm: () => ["BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM"],
    todoExtra: () => ["PRIORITY:5", "CLASS:PUBLIC"],
    vcardVersion: "4.0",
    card: (p) => [`EMAIL;TYPE=work:${p.email}`, `TEL;TYPE=cell:${p.phone}`],
    markers: { event: ["VALARM"], card: [], todo: [] },
  },
};

function vevent(d, device, { uid, title, start, minutes, organizer, attendees, meet }) {
  const end = new Date(Date.parse(start) + minutes * 60000).toISOString();
  const now = stamp(new Date().toISOString());
  return fold(["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${d.prodid(device)}`, "CALSCALE:GREGORIAN", ...VTIMEZONE, "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${now}`, `CREATED:${now}`, `LAST-MODIFIED:${now}`,
    `DTSTART;TZID=${ZONE}:${local(start)}`, `DTEND;TZID=${ZONE}:${local(end)}`, "SEQUENCE:0", `SUMMARY:${title}`, ...(meet ? [`URL:${meet}`] : []),
    `ORGANIZER;CN=${organizer.name};EMAIL=${organizer.email}:mailto:${organizer.email}`,
    ...attendees.map((p) => `ATTENDEE;CN=${p.name};CUTYPE=INDIVIDUAL;EMAIL=${p.email};PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${p.email}`),
    ...d.eventExtra(), ...d.alarm(), "END:VEVENT", "END:VCALENDAR"]);
}

function vtodo(d, device, { uid, title, due, seq }) {
  const now = stamp(new Date().toISOString());
  return fold(["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${d.prodid(device)}`, "BEGIN:VTODO", `UID:${uid}`, `DTSTAMP:${now}`, `CREATED:${now}`, `LAST-MODIFIED:${now}`, `SUMMARY:${title}`,
    `DUE;VALUE=DATE:${due.slice(0, 10).replace(/-/g, "")}`, "STATUS:NEEDS-ACTION", ...d.todoExtra(seq), "END:VTODO", "END:VCALENDAR"]);
}

function vcard(d, device, p) {
  const [first, ...rest] = p.name.split(" ");
  return fold(["BEGIN:VCARD", `VERSION:${d.vcardVersion}`, `PRODID:${d.prodid(device)}`, `UID:${p.uid}`, `FN:${p.name}`, `N:${rest.join(" ")};${first};;;`, `ORG:${p.org};`, ...d.card(p), ...(p.note ? [`NOTE:${p.note}`] : []), `REV:${stamp(new Date().toISOString())}`, "END:VCARD"]);
}

/** Per persona and app: the local copy of each collection the app syncs. Lives for the night. */
const stores = new Map();
function store(persona, client) {
  const k = `${persona}:${client}`;
  if (!stores.has(k)) stores.set(k, { collections: new Map(), conflicts: 0, seq: 1 });
  return stores.get(k);
}
export const resetNativeClients = () => stores.clear();

const xmlEscape = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Where an item lives in the persona's collection. A synced native app already
 * knows every href; the harness only knows what made the item. Items made in
 * the web app or over JMAP carry a JMAP id, not an href or UID, so look the UID
 * up there first and then ask the collection for the matching UID.
 */
async function locate(ctx, a, collection, item, kind) {
  if (item.ids.href) return item.ids.href;
  let uid = item.ids.uid;
  if (!uid) {
    const j = ctx.client(a.persona);
    const [using, method, id] = kind === "card" ? [USING.contacts, "ContactCard/get", item.ids.cardId] : [USING.calendars, "CalendarEvent/get", item.ids.eventId];
    if (!id) throw new Error(`${kind} has neither an href, a UID nor a JMAP id`);
    const got = await jmap1(j, using, method, { accountId: a.persona, ids: [id], properties: ["id", "uid"] });
    uid = got.list?.[0]?.uid;
    if (!uid) throw new Error(`${method} ${id} has no UID for ${a.persona}`);
  }
  const c = ctx.client(a.persona, "dav");
  const body = kind === "card"
    ? `<?xml version="1.0"?><r:addressbook-query xmlns:d="DAV:" xmlns:r="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/></d:prop><r:filter><r:prop-filter name="UID"><r:text-match collation="i;octet" match-type="equals">${xmlEscape(uid)}</r:text-match></r:prop-filter></r:filter></r:addressbook-query>`
    : `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">${xmlEscape(uid)}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const res = await c.raw("REPORT", `${ctx.origin}${collection}`, { auth: "basic", body, headers: { "content-type": "application/xml", depth: "1" } });
  if (res.status !== 207) throw new Error(`${kind === "card" ? "addressbook" : "calendar"}-query ${collection} → HTTP ${res.status}`);
  const href = [...res.text.matchAll(/<d:href>([^<]+)<\/d:href>/gi)].map((m) => m[1]).find((h) => h !== collection);
  if (!href) throw new Error(`${kind} ${uid} is not in ${collection} over ${kind === "card" ? "CardDAV" : "CalDAV"}`);
  return href;
}

/** Incremental sync (RFC 6578): first a full listing, then only changes since the token. */
async function sync(c, origin, url, st, { force = false } = {}) {
  const col = st.collections.get(url) ?? { token: "", etags: new Map(), at: 0 };
  if (!force && col.at && Date.now() - col.at < SYNC_EVERY_MS) return col;
  const body = `<?xml version="1.0"?><d:sync-collection xmlns:d="DAV:"><d:sync-token>${col.token}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`;
  const res = await c.raw("REPORT", `${origin}${url}`, { auth: "basic", body, headers: { "content-type": "application/xml", depth: "1" } });
  if (res.status === 403 || res.status === 409) { col.token = ""; col.etags.clear(); return sync(c, origin, url, st, { force: true }); } // token expired: full resync, as the apps do
  if (res.status !== 207) throw new Error(`sync-collection ${url} → HTTP ${res.status}`);
  for (const m of res.text.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)) {
    const href = /<d:href>([^<]+)<\/d:href>/.exec(m[1])?.[1];
    const etag = /<d:getetag>([^<]+)<\/d:getetag>/.exec(m[1])?.[1]?.replace(/&quot;/g, '"');
    if (!href || href === url) continue;
    if (/404/.test(/<d:status>([^<]+)/.exec(m[1])?.[1] ?? "")) col.etags.delete(href);
    else if (etag) col.etags.set(href, etag);
  }
  col.token = /<d:sync-token>([^<]+)<\/d:sync-token>/.exec(res.text)?.[1] ?? col.token;
  col.at = Date.now();
  st.collections.set(url, col);
  return col;
}

/**
 * Writes from the local copy: create with If-None-Match, update with the
 * etag the app last saw. A 412 means the server moved on: refetch, apply the
 * change to the fresh copy, retry once. Returns the new etag and whether a conflict happened.
 */
async function write(c, origin, st, collection, href, { create, body, edit }) {
  const col = await sync(c, origin, collection, st);
  const put = (text, etag) => c.raw("PUT", `${origin}${href}`, { auth: "basic", body: text, headers: { "content-type": href.endsWith(".vcf") ? "text/vcard; charset=utf-8" : "text/calendar; charset=utf-8", ...(create ? { "if-none-match": "*" } : etag ? { "if-match": etag } : {}) } });
  let text = body;
  if (!create) {
    const cur = await c.raw("GET", `${origin}${href}`, { auth: "basic" });
    if (cur.status !== 200) throw new Error(`GET ${href} → HTTP ${cur.status}`);
    text = edit(cur.text);
  }
  let res = await put(text, col.etags.get(href));
  let conflict = false;
  if (res.status === 412) {
    conflict = true;
    st.conflicts += 1;
    const fresh = await c.raw("GET", `${origin}${href}`, { auth: "basic" });
    if (fresh.status !== 200) throw new Error(`refetch ${href} after 412 → HTTP ${fresh.status}`);
    res = await put(edit ? edit(fresh.text) : body, fresh.headers.get("etag"));
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`PUT ${href} → HTTP ${res.status}${conflict ? " after a 412 retry" : ""}: ${res.text.slice(0, 160)}`);
  const etag = res.headers.get("etag");
  if (etag) col.etags.set(href, etag);
  return { conflict };
}

/** The persona's CalDAV collection for a task list, found by name in their calendar home. */
async function taskCollection(c, origin, persona, listName) {
  const body = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>`;
  const res = await c.raw("PROPFIND", `${origin}/calendars/${persona}/`, { auth: "basic", body, headers: { "content-type": "application/xml", depth: "1" } });
  if (res.status !== 207) throw new Error(`PROPFIND calendar home → HTTP ${res.status}`);
  const lists = [...res.text.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)].map((m) => m[1]).filter((x) => /name="VTODO"/.test(x))
    .map((x) => ({ href: /<d:href>([^<]+)/.exec(x)?.[1], name: /<d:displayname>([^<]*)/.exec(x)?.[1] }));
  return lists.find((l) => l.name === listName) ?? null;
}

const who = (ctx, id) => ({ name: ctx.world.persona(id).displayName, email: ctx.world.email(id) });
const dialectOf = (a) => DIALECTS[a.client ?? "apple"];
const appName = (a, app) => (a.client === "davx5" ? { calendar: "the Android calendar app (DAVx5)", contacts: "Android Contacts (DAVx5)", tasks: "the Android tasks app (DAVx5)" } : { calendar: a.device === "phone" ? "iOS Calendar" : "Apple Calendar", contacts: a.device === "phone" ? "iOS Contacts" : "Apple Contacts", tasks: "Reminders" })[app];

export const davExecutors = {
  async "cal.event"(a, ctx) {
    const c = ctx.client(a.persona, "dav");
    const uid = uuid().toUpperCase();
    const collection = `/calendars/${a.persona}/default/`;
    const href = `${collection}${uid}.ics`;
    const body = vevent(dialectOf(a), a.device, { uid, title: a.params.title, start: a.params.start, minutes: a.params.minutes, organizer: who(ctx, a.persona), meet: a.params.meet, attendees: [...a.params.attendees.map((p) => who(ctx, p)), ...(a.params.external ?? []).map((email) => ({ name: email.split("@")[0], email }))] });
    const { conflict } = await write(c, ctx.origin, store(a.persona, a.client), collection, href, { create: true, body });
    for (const to of a.params.attendees) ctx.expectNotify({ to, domain: "calendar", action: "invite", from: a.persona, n: a.n, title: a.params.title });
    for (const to of a.params.external ?? []) ctx.expectMail({ to, n: a.n, title: a.params.title });
    return { ids: { href, uid }, extra: { attendees: a.params.attendees, external: a.params.external, title: a.params.title, start: a.params.start, minutes: a.params.minutes, via: "dav", client: a.client, device: a.device, native: { kind: "event", markers: dialectOf(a).markers.event } }, note: `${appName(a, "calendar")}${conflict ? "; 412 resolved" : ""}` };
  },

  async "cal.reschedule"(a, ctx) {
    const ev = need(ctx, a.params.event);
    const c = ctx.client(a.persona, "dav");
    const start = new Date(Date.parse(ev.start) + a.params.shiftMinutes * 60000).toISOString();
    const end = new Date(Date.parse(start) + (ev.minutes ?? 60) * 60000).toISOString();
    const edit = (text) => {
      const seq = Number(/SEQUENCE:(\d+)/.exec(text)?.[1] ?? 0) + 1;
      return text.replace(/DTSTART[^\r\n]*/, `DTSTART;TZID=${ZONE}:${local(start)}`).replace(/DTEND[^\r\n]*/, `DTEND;TZID=${ZONE}:${local(end)}`).replace(/SEQUENCE:\d+/, `SEQUENCE:${seq}`);
    };
    const href = await locate(ctx, a, `/calendars/${a.persona}/default/`, ev, "event");
    const { conflict } = await write(c, ctx.origin, store(a.persona, a.client), `/calendars/${a.persona}/default/`, href, { edit });
    return { patch: { key: a.params.event, start }, note: `${appName(a, "calendar")}${conflict ? "; 412 resolved" : ""}` };
  },

  async "cal.rsvp"(a, ctx) {
    const ev = need(ctx, a.params.event);
    const c = ctx.client(a.persona, "dav");
    const collection = `/calendars/${a.persona}/default/`;
    const report = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">${ev.ids.uid}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const res = await c.raw("REPORT", `${ctx.origin}${collection}`, { auth: "basic", body: report, headers: { "content-type": "application/xml", depth: "1" } });
    const href = /<d:href>([^<]+)<\/d:href>/i.exec(res.text)?.[1];
    if (!href) throw new Error(`invitation "${ev.title}" is not in ${a.persona}'s CalDAV calendar`);
    const me = ctx.world.email(a.persona).replace(/[.]/g, "\\.");
    const partstat = a.params.response.toUpperCase();
    const edit = (text) => {
      const unfolded = text.replace(/\r?\n[ \t]/g, "");
      const out = unfolded.replace(new RegExp(`(ATTENDEE[^\\r\\n]*?)PARTSTAT=[A-Z-]+([^\\r\\n]*mailto:${me})`, "i"), `$1PARTSTAT=${partstat}$2`);
      if (out === unfolded) throw new Error(`no ATTENDEE line for ${a.persona} in ${href}`);
      return out;
    };
    const { conflict } = await write(c, ctx.origin, store(a.persona, a.client), collection, href, { edit });
    return { note: `${appName(a, "calendar")}${conflict ? "; 412 resolved" : ""}` };
  },

  async "contact.create"(a, ctx) {
    const c = ctx.client(a.persona, "dav");
    const uid = uuid().toUpperCase();
    const collection = `/addressbooks/${a.persona}/default/`;
    const href = `${collection}${uid}.vcf`;
    await write(c, ctx.origin, store(a.persona, a.client), collection, href, { create: true, body: vcard(dialectOf(a), a.device, { uid, ...a.params }) });
    return { ids: { href, uid }, extra: { name: a.params.name, email: a.params.email, via: "dav", client: a.client, device: a.device, native: { kind: "card", markers: dialectOf(a).markers.card } }, note: appName(a, "contacts") };
  },

  async "contact.edit"(a, ctx) {
    const card = need(ctx, a.params.contact);
    const c = ctx.client(a.persona, "dav");
    const href = await locate(ctx, a, `/addressbooks/${a.persona}/default/`, card, "card");
    const edit = (text) => text.replace(/NOTE:[^\r\n]*\r?\n/, "").replace(/END:VCARD/, `NOTE:${a.params.note}\r\nEND:VCARD`);
    const { conflict } = await write(c, ctx.origin, store(a.persona, a.client), `/addressbooks/${a.persona}/default/`, href, { edit });
    return { patch: { key: a.params.contact, note: a.params.note }, note: `${appName(a, "contacts")}${conflict ? "; 412 resolved" : ""}` };
  },

  async "task.create"(a, ctx) {
    const list = need(ctx, a.params.list);
    const c = ctx.client(a.persona, "dav");
    const col = await taskCollection(c, ctx.origin, a.persona, list.name);
    if (!col) {
      // The project's list is not among the persona's CalDAV task lists: the app cannot see it. The person adds it in the web app.
      ctx.friction?.({ what: `A Team's project task list does not show up in ${a.client === "davx5" ? "the Android tasks app" : "Reminders"} (CalDAV)`, workaround: "added the task in the web app instead", source: "device" });
      const r = await ctx.api["task.create"]({ ...a, layer: "api" }, ctx);
      return { ...r, note: `${appName(a, "tasks")}: list "${list.name}" not over CalDAV; added in the web app` };
    }
    const uid = uuid().toUpperCase();
    const st = store(a.persona, a.client);
    const due = new Date(Date.parse(`${ctx.date}T16:00:00Z`) + a.params.dueInDays * 86400000).toISOString();
    await write(c, ctx.origin, st, col.href, `${col.href}${uid}.ics`, { create: true, body: vtodo(dialectOf(a), a.device, { uid, title: a.params.title, due, seq: st.seq++ }) });
    return { ids: { href: `${col.href}${uid}.ics`, uid, listId: list.ids.listId }, extra: { status: "open", title: a.params.title, via: "dav", client: a.client, device: a.device, native: { kind: "todo", markers: dialectOf(a).markers.todo } }, note: appName(a, "tasks") };
  },

  async "task.complete"(a, ctx) {
    const t = need(ctx, a.params.task);
    if (!t.ids.href) {
      ctx.friction?.({ what: `A Team's project task list does not show up in ${a.client === "davx5" ? "the Android tasks app" : "Reminders"} (CalDAV)`, workaround: "ticked the task off in the web app instead", source: "device" });
      const r = await ctx.api["task.complete"]({ ...a, layer: "api" }, ctx);
      return { ...r, note: `${appName(a, "tasks")}: task not over CalDAV; done in the web app` };
    }
    const c = ctx.client(a.persona, "dav");
    const now = stamp(new Date().toISOString());
    const edit = (text) => text.replace(/STATUS:[A-Z-]+/, "STATUS:COMPLETED").replace(/END:VTODO/, `COMPLETED:${now}\r\nPERCENT-COMPLETE:100\r\nEND:VTODO`);
    const { conflict } = await write(c, ctx.origin, store(a.persona, a.client), t.ids.href.replace(/[^/]+$/, ""), t.ids.href, { edit });
    return { patch: { key: a.params.task, status: "done" }, note: `${appName(a, "tasks")}${conflict ? "; 412 resolved" : ""}` };
  },
};

export { vevent as nativeEvent, vcard as nativeCard, ZONE };
