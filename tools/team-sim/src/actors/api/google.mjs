import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { roomCode, ulid, uuid } from "../../client/ids.mjs";
import { USING, jmap1, setOk } from "../../client/jmap.mjs";
import { calendarExecutors, createEvent } from "./calendar.mjs";
import { need, postMessage } from "./collab.mjs";
import { davMust, davPut, fileBytes, putNew } from "./files.mjs";
import { davUrl } from "./paths.mjs";
import { nativeCard, nativeEvent } from "./dav.mjs";

/**
 * The studio moved from Google Workspace. `habit` actions try the Google way
 * and report whether the suite has it; `migrate.import` brings in what a
 * persona still had in their Google export, through the suite's own import
 * path, and checks what arrived. Content an importer loses or changes fails
 * the action; a habit or import the suite has no way for is friction.
 */
export const TAKEOUT_DIR = fileURLToPath(new URL("../../../world/takeout/", import.meta.url));

const habitFriction = (ctx, a, what, workaround) => ctx.friction?.({ what, workaround, source: "habit", habit: a.params.habit });
const migrationFriction = (ctx, a, what, workaround) => ctx.friction?.({ what, workaround, source: "migration", importType: a.params.type });

/** Fixture text with fresh UIDs and the persona's own address, so each import is new. */
export function takeoutText(name, a, world) {
  const p = world.persona(a.persona);
  const [first, ...rest] = (name === "contacts.vcf.tmpl" ? clientOf(world, a) : p.displayName).split(" ");
  const tail = String(1000 + (a.n * 37) % 9000);
  return readFileSync(join(TAKEOUT_DIR, name), "utf8")
    .replaceAll("{persona}", a.persona).replaceAll("{uid}", `${a.persona}-${a.n}-${uuid().slice(0, 8)}`).replaceAll("{title}", `Studio stand-up (uit Google, #${a.n})`)
    .replaceAll("{name}", `${first} ${rest.join(" ")}`).replaceAll("{first}", first).replaceAll("{last}", rest.join(" ")).replaceAll("{first_lower}", first.toLowerCase())
    .replaceAll("{email}", `${first.toLowerCase()}.${(rest.at(-1) ?? "x").toLowerCase()}@example.org`).replaceAll("{org}", "Stichting Havenfestival").replaceAll("{tail}", tail);
}
const clientOf = (world, a) => world.clients[(a.n ?? 0) % world.clients.length].contact;

/** What a Google export's calendar holds, to compare with what arrived. */
const ICS_EXPECT = { recurring: "FREQ=WEEKLY", alarms: 1, location: "Studio Kade, grote tafel", allDay: "Studio dicht (kerst)", timeZone: "Europe/Amsterdam" };

async function checkImportedEvents(ctx, a, uidPrefix) {
  const c = ctx.client(a.persona);
  const q = await jmap1(c, USING.calendars, "CalendarEvent/query", { accountId: a.persona });
  const got = await jmap1(c, USING.calendars, "CalendarEvent/get", { accountId: a.persona, ids: q.ids ?? [], properties: ["uid", "title", "recurrenceRules", "alerts", "locations", "showWithoutTime", "timeZone", "start", "duration"] });
  const mine = (got.list ?? []).filter((e) => e.uid?.startsWith(uidPrefix));
  const lost = [];
  const standup = mine.find((e) => e.uid.endsWith("-standup@google.com"));
  const holiday = mine.find((e) => e.uid.endsWith("-kerst@google.com"));
  if (!standup) lost.push("the weekly stand-up");
  else {
    if (!standup.recurrenceRules?.length) lost.push("the stand-up's weekly recurrence");
    if (!Object.keys(standup.alerts ?? {}).length) lost.push("the stand-up's 10-minute reminder");
    if (!Object.values(standup.locations ?? {}).some((l) => l.name === ICS_EXPECT.location)) lost.push("the stand-up's location");
    if (standup.timeZone !== ICS_EXPECT.timeZone) lost.push(`the stand-up's time zone (got ${standup.timeZone})`);
    if (!String(standup.start).startsWith("2026-10-05T09:30")) lost.push(`the stand-up's start time (got ${standup.start})`);
  }
  if (!holiday) lost.push("the all-day closure");
  else if (!holiday.showWithoutTime) lost.push("the closure being all-day");
  return { lost, count: mine.length };
}

async function checkImportedCard(ctx, a, email) {
  const c = ctx.client(a.persona);
  const q = await jmap1(c, USING.contacts, "ContactCard/query", { accountId: a.persona });
  const got = await jmap1(c, USING.contacts, "ContactCard/get", { accountId: a.persona, ids: q.ids ?? [] });
  const card = (got.list ?? []).find((x) => Object.values(x.emails ?? {}).some((e) => e.address === email));
  if (!card) return { lost: ["the whole contact"] };
  const lost = [];
  if (Object.keys(card.emails ?? {}).length < 2) lost.push("the second email address");
  const phones = Object.values(card.phones ?? {});
  if (phones.length < 2) lost.push("the second phone number");
  else if (!phones.some((p) => /studio/i.test(p.label ?? ""))) lost.push("the phone label \"Studio\"");
  if (!Object.keys(card.organizations ?? {}).length) lost.push("the organisation");
  if (!Object.keys(card.addresses ?? {}).length) lost.push("the work address");
  if (!Object.keys(card.anniversaries ?? {}).length) lost.push("the birthday");
  if (!Object.keys(card.notes ?? {}).length) lost.push("the note");
  return { lost, id: card.id };
}

/** Every file under a fixture folder, as [relative dir, name, absolute path]. */
export function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, base) : [[relative(base, dir), n, p]];
  });
}

async function mkcolTree(ctx, persona, root, files) {
  const c = ctx.client(persona);
  const dirs = [...new Set(files.flatMap(([d]) => d.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"))))].filter(Boolean).sort();
  for (const d of dirs) {
    const res = await c.raw("MKCOL", `${davUrl(ctx.origin, `${root}/${d}`)}/`, { auth: "basic" });
    if (![201, 405].includes(res.status)) throw new Error(`MKCOL ${root}/${d} → HTTP ${res.status}`);
  }
  for (const [d, n, abs] of files) await davMust(await davPut(c, ctx.origin, `${root}/${d}/${n}`, readFileSync(abs)), `PUT ${root}/${d}/${n}`);
}

/** Folder tree as Drive has it now, for comparing with the dropped one. */
export async function driveTree(ctx, persona, root) {
  const c = ctx.client(persona);
  const out = [];
  const list = async (path) => {
    const body = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`;
    const res = await c.raw("PROPFIND", `${davUrl(ctx.origin, path)}/`, { auth: "basic", body, headers: { depth: "1", "content-type": "application/xml" } });
    if (res.status !== 207) return;
    for (const m of res.text.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)) {
      const href = decodeURIComponent(/<d:href>([^<]+)/.exec(m[1])?.[1] ?? "").replace(/\/$/, "");
      const name = href.slice(href.lastIndexOf("/") + 1);
      const full = `${path}/${name}`;
      if (href.endsWith(path.split("/").map(encodeURIComponent).map(decodeURIComponent).join("/")) || full === path) continue;
      if (/<d:collection\s*\/>/.test(m[1])) await list(full);
      else out.push(full.slice(root.length + 1));
    }
  };
  await list(root);
  return out.sort();
}

const HABITS = {
  async "mention-assign"(a, ctx) {
    const doc = need(ctx, a.params.doc);
    const c = ctx.client(a.persona);
    const mate = ctx.world.persona(a.params.mention);
    const since = new Date(Date.now() - 2000).toISOString();
    const thread = await c.post(`/api/v1/files/threads?path=${encodeURIComponent(doc.ids.path)}`, { id: ulid(), kind: "comment", body: `@${a.params.mention} ${a.params.text} Kun jij dit oppakken?` });
    // Google turns a comment mention into an assigned action item. Here: does the colleague hear about it, and do they get a to-do?
    const mc = ctx.client(a.params.mention, "oracle");
    let heard = false;
    for (let i = 0; i < 10 && !heard; i += 1) {
      const res = await mc.request("GET", "/api/v1/notifications");
      heard = (res.json?.list ?? res.json?.data ?? []).some((n) => n.createdAt >= since && n.domain === "docs");
      if (!heard) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!heard) habitFriction(ctx, a, "A @mention in a doc comment does not reach the colleague", "posted it in the project chat");
    habitFriction(ctx, a, "A @mention in a doc comment does not hand the colleague a to-do (Google's \"assign\")", "posted it in the project chat");
    const channel = ctx.registry.get(`channel:project:${doc.project}`) ?? ctx.registry.get("channel:team:studio");
    if (channel?.ids) await postMessage(c, channel.ids.channelId, `@${a.params.mention} zie mijn opmerking in ${doc.title ?? "het document"}: kun jij dit oppakken?`);
    return { note: `${mate.displayName} ${heard ? "was notified" : "was not notified"}; no to-do`, extra: { thread: thread?.id } };
  },

  async "team-share"(a, ctx) {
    const c = ctx.client(a.persona);
    const path = await putNew(c, ctx.origin, `/users/${a.persona}`, a.params.name, fileBytes(a.params.name, 40000));
    const share = await c.post("/api/v1/files/shares", { path, kind: "member", defaultAccess: "view", shareWith: { [`groups/${a.params.team}`]: { access: "edit" } } });
    const mate = ctx.world.teamMembersOn(a.params.team, ctx.date).find((m) => m !== a.persona);
    if (mate) {
      const seen = await ctx.client(mate, "oracle").request("GET", "/api/v1/files/shared-with-me");
      const names = JSON.stringify(seen.json ?? {});
      if (!names.includes(a.params.name)) throw new Error(`${a.persona} shared "${a.params.name}" with Team ${a.params.team}, but ${mate} does not see it in Shared with me`);
    }
    return { ids: { path, shareId: (share.data ?? share).id }, extra: { team: a.params.team } };
  },

  async "find-a-time"(a, ctx) {
    const c = ctx.client(a.persona);
    const start = new Date(a.params.start);
    const monday = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - ((start.getUTCDay() + 6) % 7)));
    const utcStart = `${monday.toISOString().slice(0, 10)}T00:00:00Z`;
    const utcEnd = `${new Date(monday.getTime() + 7 * 86400000).toISOString().slice(0, 10)}T00:00:00Z`;
    const r = await jmap1(c, USING.availability, "TeamMember/getAvailability", { accountId: a.persona, ids: a.params.attendees, utcStart, utcEnd });
    const seen = new Set((r.list ?? []).map((x) => x.id));
    const missing = a.params.attendees.filter((p) => !seen.has(p));
    // Google shows colleagues' free/busy by default; here each person has to switch availability sharing on first.
    if (missing.length) habitFriction(ctx, a, "Colleagues' free time is hidden until each of them switches on availability sharing", "asked in chat when people are free");
    // Pick the first hour in the persona's slot day that nobody is busy in.
    const busy = (r.list ?? []).flatMap((x) => x.periods ?? []);
    let at = Date.parse(a.params.start);
    for (let i = 0; i < 6 && busy.some((p) => Date.parse(p.utcStart ?? p.start) < at + a.params.minutes * 60000 && Date.parse(p.utcEnd ?? p.end) > at); i += 1) at += 3600000;
    const res = await calendarExecutors["cal.event"]({ ...a, params: { ...a.params, start: new Date(at).toISOString(), external: [] } }, ctx);
    return { ...res, note: missing.length ? `no availability for ${missing.join(", ")}` : `checked ${seen.size} calendars first` };
  },

  async "meet-in-invite"(a, ctx) {
    // One step, as in the event dialog's Meet card: the room is made and the invite is created with its link.
    const c = ctx.client(a.persona);
    const code = roomCode();
    await c.post("/api/v1/meetings/rooms", { room: code, ownerPrincipal: `u:${a.persona}` });
    const href = `${ctx.origin}/meet/meetings/${code}`;
    const ids = await createEvent({ ...a, params: { ...a.params, external: [] } }, ctx, { links: { meet: { "@type": "Link", href, rel: "describedby" } } });
    const mate = a.params.attendees[0];
    let copy = null;
    for (let i = 0; i < 5 && !copy; i += 1) {
      const mc = ctx.client(mate, "oracle");
      const q = await jmap1(mc, USING.calendars, "CalendarEvent/query", { accountId: mate });
      const ev = await jmap1(mc, USING.calendars, "CalendarEvent/get", { accountId: mate, ids: q.ids ?? [], properties: ["uid", "links"] });
      copy = (ev.list ?? []).find((e) => e.uid === ids.uid) ?? null;
      if (!copy) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!copy) throw new Error(`${mate} has no copy of the invite after 10 s`);
    if (!JSON.stringify(copy.links ?? {}).includes(code)) throw new Error(`${mate}'s copy of the invite has no Meet link`);
    return { ids: { ...ids, room: code }, extra: { attendees: a.params.attendees, title: a.params.title, start: a.params.start } };
  },
};

HABITS["expiring-link"] = async (a, ctx) => {
  // Over the API a link can carry an expiry date; then a guest opens it.
  const path = need(ctx, a.params.file).ids.path;
  const c = ctx.client(a.persona);
  const expiresAt = new Date(Date.now() + a.params.expiresInDays * 86400000).toISOString();
  const res = await c.request("POST", "/api/v1/files/shares", { body: JSON.stringify({ path, kind: "public", defaultAccess: "view", expiresAt }), headers: { "content-type": "application/json" } });
  if (res.status === 403) {
    habitFriction(ctx, a, "Only the file's owner can make a share link for a file in a Team folder", "asked the owner to share it");
    return { note: "not allowed to share this Team file" };
  }
  if (!res.ok) throw new Error(`public link with an expiry date → HTTP ${res.status}: ${res.text.slice(0, 160)}`);
  const share = res.json?.data ?? res.json;
  if (!share.expiresAt) throw new Error("asked for a link that expires, but the link has no expiry date");
  const guest = await fetch(`${ctx.origin}/api/v1/files/share-sessions`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ token: share.publicToken }) });
  if (!guest.ok) throw new Error(`a guest cannot open the new link: HTTP ${guest.status}`);
  return { ids: { shareId: share.id }, extra: { expiresAt: share.expiresAt }, note: `link expires ${share.expiresAt.slice(0, 10)}` };
};

HABITS["folder-drop"] = async (a, ctx) => IMPORTS.folder(a, ctx);

const IMPORTS = {
  async ics(a, ctx) {
    const c = ctx.client(a.persona);
    const text = takeoutText("calendar.ics.tmpl", a, ctx.world);
    const prefix = /UID:([^-\r\n]+-\d+-[0-9a-f]+)-/.exec(text)[1];
    const res = await c.request("POST", "/api/v1/calendars/events/import?calendarId=default", { body: text, headers: { "content-type": "text/calendar" } });
    if (res.status !== 201) throw new Error(`calendar import → HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    const { lost, count } = await checkImportedEvents(ctx, a, prefix);
    if (lost.length) throw new Error(`Google calendar export imported ${count} of 2 events but lost ${lost.join(", ")}`);
    return { note: "2 events from the Google export, nothing lost" };
  },

  async vcf(a, ctx) {
    const c = ctx.client(a.persona);
    const text = takeoutText("contacts.vcf.tmpl", a, ctx.world);
    const email = /EMAIL;TYPE=INTERNET;TYPE=WORK:([^\r\n]+)/.exec(text)[1];
    const res = await c.request("POST", "/api/v1/contacts/cards/import?addressBookId=default", { body: text, headers: { "content-type": "text/vcard" } });
    if (res.status !== 201) throw new Error(`contacts import → HTTP ${res.status}: ${res.text.slice(0, 200)}`);
    const { lost } = await checkImportedCard(ctx, a, email);
    if (lost.length) throw new Error(`Google contacts export imported but lost ${lost.join(", ")}`);
    return { note: "contact from the Google export, nothing lost" };
  },

  async xlsx(a, ctx) {
    const folder = need(ctx, a.params.folder).ids.path;
    const name = "Planning Q4 (Google Sheets export).xlsx";
    const path = await putNew(ctx.client(a.persona), ctx.origin, folder, name, readFileSync(join(TAKEOUT_DIR, name)));
    return { ids: { path }, extra: { bytes: statSync(join(TAKEOUT_DIR, name)).size, name } };
  },

  async folder(a, ctx) {
    // Without a browser: the person recreates the tree (what Drive's folder drop does for them).
    const folder = need(ctx, a.params.folder).ids.path;
    const root = `${folder}/Uit Google ${a.persona} ${a.n}`;
    const files = walk(join(TAKEOUT_DIR, "folder"));
    const c = ctx.client(a.persona);
    const mk = await c.raw("MKCOL", `${davUrl(ctx.origin, root)}/`, { auth: "basic" });
    if (![201, 405].includes(mk.status)) throw new Error(`MKCOL ${root} → HTTP ${mk.status}`);
    await mkcolTree(ctx, a.persona, root, files);
    const tree = await driveTree(ctx, a.persona, root);
    const want = files.map(([d, n]) => `${d}/${n}`).sort();
    const missing = want.filter((f) => !tree.includes(f));
    if (missing.length) throw new Error(`folder from the Google export: ${missing.length} of ${want.length} files missing after upload (${missing.slice(0, 3).join(", ")})`);
    return { ids: { path: root }, extra: { files: want.length } };
  },

  async docx(a, ctx) {
    // The .docx import runs in the Docs app only (the browser converts it). Without a browser the file just lands in Drive.
    migrationFriction(ctx, a, "A Google Docs export (.docx) can only be turned into a doc in the browser", "kept the .docx in Drive for now");
    const folder = need(ctx, a.params.folder).ids.path;
    const name = "Briefing Noordlicht (Google Docs export).docx";
    const path = await putNew(ctx.client(a.persona), ctx.origin, folder, name, readFileSync(join(TAKEOUT_DIR, name)));
    return { ids: { path }, extra: { name } };
  },
};

export const googleExecutors = {
  async habit(a, ctx) {
    const fn = HABITS[a.params.habit];
    // Browser-only habits (a replay runs browser actions through the API) have nothing to do here.
    if (!fn) return { note: `${a.params.habit} is a browser habit; nothing to do through the API`, extra: { habit: a.params.habit } };
    const r = await fn(a, ctx);
    return { ...r, extra: { ...(r?.extra ?? {}), habit: a.params.habit } };
  },
  async "migrate.import"(a, ctx) {
    return IMPORTS[a.params.type](a, ctx);
  },
};

const icsStamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Calendar habits in Apple Calendar or the Android calendar app: free/busy over CalDAV scheduling, the link in the URL field. */
const DAV_HABITS = {
  async "find-a-time"(a, ctx) {
    // The availability panel asks the server for colleagues' free/busy (RFC 6638 outbox POST).
    const c = ctx.client(a.persona, "dav");
    const day = new Date(a.params.start);
    const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const to = new Date(from.getTime() + 86400000);
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//macOS 15.1//EN", "METHOD:REQUEST", "BEGIN:VFREEBUSY", `UID:${uuid().toUpperCase()}`, `DTSTAMP:${icsStamp(new Date().toISOString())}`, `DTSTART:${icsStamp(from.toISOString())}`, `DTEND:${icsStamp(to.toISOString())}`, `ORGANIZER:mailto:${ctx.world.email(a.persona)}`, ...a.params.attendees.map((p) => `ATTENDEE:mailto:${ctx.world.email(p)}`), "END:VFREEBUSY", "END:VCALENDAR", ""];
    const res = await c.raw("POST", `${ctx.origin}/calendars/${a.persona}/outbox/`, { auth: "basic", body: lines.join("\r\n"), headers: { "content-type": "text/calendar; charset=utf-8" } });
    if (res.status !== 200) throw new Error(`free/busy lookup in the calendar app → HTTP ${res.status}`);
    const blind = [];
    const busy = [];
    for (const m of res.text.matchAll(/<cal:response>([\s\S]*?)<\/cal:response>/g)) {
      const who = /mailto:([^<\s]+)/.exec(m[1])?.[1] ?? "?";
      const status = /<cal:request-status>([^<]+)/.exec(m[1])?.[1] ?? "";
      if (!status.startsWith("2.")) blind.push(`${who} (${status.trim()})`);
      for (const fb of m[1].matchAll(/FREEBUSY[^:]*:([0-9TZ]+)\/([0-9TZ]+)/g)) busy.push([fb[1], fb[2]]);
    }
    if (blind.length) habitFriction(ctx, a, "The calendar app's availability panel shows no free time for some colleagues", "asked in chat when people are free");
    const parse = (t) => Date.parse(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`);
    let at = Date.parse(a.params.start);
    for (let i = 0; i < 6 && busy.some(([s, e]) => parse(s) < at + a.params.minutes * 60000 && parse(e) > at); i += 1) at += 3600000;
    const r = await ctx.dav["cal.event"]({ ...a, params: { ...a.params, start: new Date(at).toISOString(), external: [] } }, ctx);
    return { ...r, note: `${r.note}; free/busy for ${a.params.attendees.length - blind.length} of ${a.params.attendees.length}${blind.length ? ` (none for ${blind.join(", ")})` : ""}` };
  },

  async "meet-in-invite"(a, ctx) {
    // Apple Calendar cannot make a suite video room: the person makes one in Meet and pastes the link into the invite's URL field.
    habitFriction(ctx, a, "A calendar app cannot add a suite video link to an invite in one step", "made the room in Meet and pasted the link into the invite");
    const code = roomCode();
    await ctx.client(a.persona).post("/api/v1/meetings/rooms", { room: code, ownerPrincipal: `u:${a.persona}` });
    const r = await ctx.dav["cal.event"]({ ...a, params: { ...a.params, external: [], meet: `${ctx.origin}/meet/meetings/${code}` } }, ctx);
    const mate = a.params.attendees[0];
    let copy = null;
    for (let i = 0; i < 5 && !copy; i += 1) {
      const mc = ctx.client(mate, "oracle");
      const q = await jmap1(mc, USING.calendars, "CalendarEvent/query", { accountId: mate });
      const ev = await jmap1(mc, USING.calendars, "CalendarEvent/get", { accountId: mate, ids: q.ids ?? [], properties: ["uid", "links", "description"] });
      copy = (ev.list ?? []).find((e) => e.uid === r.ids.uid) ?? null;
      if (!copy) await new Promise((res) => setTimeout(res, 2000));
    }
    if (!copy) throw new Error(`${mate} has no copy of the invite after 10 s`);
    if (!JSON.stringify(copy).includes(code)) throw new Error(`the video link pasted into the invite's URL field is not in ${mate}'s copy`);
    return { ...r, ids: { ...r.ids, room: code } };
  },
};

/** A native calendar or contacts app imports a Google export by writing each item over CalDAV/CardDAV. */
export const googleDavExecutors = {
  async habit(a, ctx) {
    const fn = DAV_HABITS[a.params.habit];
    if (!fn) return googleExecutors.habit({ ...a, layer: "api" }, ctx);
    const r = await fn(a, ctx);
    return { ...r, extra: { ...(r?.extra ?? {}), habit: a.params.habit } };
  },
  async "migrate.import"(a, ctx) {
    const c = ctx.client(a.persona, "dav");
    if (a.params.type === "ics") {
      const text = takeoutText("calendar.ics.tmpl", a, ctx.world);
      const prefix = /UID:([^-\r\n]+-\d+-[0-9a-f]+)-/.exec(text)[1];
      const tz = text.slice(text.indexOf("BEGIN:VTIMEZONE"), text.indexOf("END:VTIMEZONE") + "END:VTIMEZONE".length);
      const head = text.slice(0, text.indexOf("BEGIN:VTIMEZONE")).replace(/METHOD:PUBLISH\r\n/, "").replace(/X-WR-[^\r\n]*\r\n/g, "");
      for (const ev of text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g)) {
        const uid = /UID:([^\r\n]+)/.exec(ev)[1];
        const href = `/calendars/${a.persona}/default/${encodeURIComponent(uid.replace(/@/g, "-"))}.ics`;
        const res = await c.raw("PUT", `${ctx.origin}${href}`, { auth: "basic", body: `${head}${tz}\r\n${ev}\r\nEND:VCALENDAR\r\n`, headers: { "content-type": "text/calendar; charset=utf-8", "if-none-match": "*" } });
        if (res.status < 200 || res.status >= 300) throw new Error(`PUT ${href} → HTTP ${res.status}: ${res.text.slice(0, 160)}`);
      }
      const { lost, count } = await checkImportedEvents(ctx, a, prefix);
      if (lost.length) throw new Error(`Google calendar export added in the native app (${count} of 2 events in the web app) but lost ${lost.join(", ")}`);
      return { note: "2 events from the Google export via the native app, nothing lost" };
    }
    const text = takeoutText("contacts.vcf.tmpl", a, ctx.world);
    const email = /EMAIL;TYPE=INTERNET;TYPE=WORK:([^\r\n]+)/.exec(text)[1];
    const uid = uuid().toUpperCase();
    const body = text.replace("VERSION:3.0", `VERSION:3.0\r\nUID:${uid}`);
    const res = await c.raw("PUT", `${ctx.origin}/addressbooks/${a.persona}/default/${uid}.vcf`, { auth: "basic", body, headers: { "content-type": "text/vcard; charset=utf-8", "if-none-match": "*" } });
    if (res.status < 200 || res.status >= 300) throw new Error(`PUT contact → HTTP ${res.status}: ${res.text.slice(0, 160)}`);
    const { lost } = await checkImportedCard(ctx, a, email);
    if (lost.length) throw new Error(`Google contacts export added in the native app but lost ${lost.join(", ")}`);
    return { note: "contact from the Google export via the native app, nothing lost" };
  },
};

export { nativeCard, nativeEvent };
