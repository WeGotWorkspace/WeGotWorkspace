import { uuid } from "../../client/ids.mjs";
import { need } from "./collab.mjs";

/**
 * CalDAV/CardDAV executors for the persona with the "desktop calendar app"
 * trait. Plain iCalendar/vCard over Basic auth, like a desktop client.
 */
const stamp = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fold = (lines) => `${lines.join("\r\n")}\r\n`;

function vevent({ uid, title, start, minutes, organizer, attendees, sequence = 0 }) {
  const end = new Date(Date.parse(start) + minutes * 60000).toISOString();
  return fold([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Studio Kade//Desktop Calendar (team-sim)//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${title}`,
    `ORGANIZER;CN=${organizer.name}:mailto:${organizer.email}`,
    ...attendees.map((p) => `ATTENDEE;CN=${p.name};PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${p.email}`),
    "END:VEVENT",
    "END:VCALENDAR",
  ]);
}

const vcard = ({ uid, name, org, email, phone, note }) =>
  fold(["BEGIN:VCARD", "VERSION:3.0", `UID:${uid}`, `FN:${name}`, `N:${name.split(" ").slice(-1)[0]};${name.split(" ").slice(0, -1).join(" ")};;;`, `ORG:${org}`, `EMAIL;TYPE=WORK:${email}`, `TEL;TYPE=WORK:${phone}`, ...(note ? [`NOTE:${note}`] : []), "END:VCARD"]);

async function must(res, what) {
  if (res.status >= 200 && res.status < 300) return res;
  throw new Error(`${what} → HTTP ${res.status}: ${res.text.slice(0, 200)}`);
}

export const davExecutors = {
  async "cal.event"(a, ctx) {
    const c = ctx.client(a.persona, "dav");
    const uid = uuid();
    const href = `/calendars/${a.persona}/default/${uid}.ics`;
    const who = (id) => ({ name: ctx.world.persona(id).displayName, email: ctx.world.email(id) });
    const body = vevent({ uid, title: a.params.title, start: a.params.start, minutes: a.params.minutes, organizer: who(a.persona), attendees: [...a.params.attendees.map(who), ...(a.params.external ?? []).map((email) => ({ name: email.split("@")[0], email }))] });
    await must(await c.raw("PUT", `${ctx.origin}${href}`, { auth: "basic", body, headers: { "content-type": "text/calendar; charset=utf-8", "if-none-match": "*" } }), `PUT ${href}`);
    for (const to of a.params.attendees) ctx.expectNotify({ to, domain: "calendar", action: "invite", from: a.persona, n: a.n, title: a.params.title });
    for (const to of a.params.external ?? []) ctx.expectMail({ to, n: a.n, title: a.params.title });
    return { ids: { href, uid }, extra: { attendees: a.params.attendees, external: a.params.external, title: a.params.title, start: a.params.start, minutes: a.params.minutes, via: "dav" } };
  },

  async "cal.reschedule"(a, ctx) {
    const ev = need(ctx, a.params.event);
    const c = ctx.client(a.persona, "dav");
    const cur = await must(await c.raw("GET", `${ctx.origin}${ev.ids.href}`, { auth: "basic", headers: { accept: "text/calendar" } }), `GET ${ev.ids.href}`);
    const start = new Date(Date.parse(ev.start) + a.params.shiftMinutes * 60000).toISOString();
    const end = new Date(Date.parse(start) + (ev.minutes ?? 60) * 60000).toISOString();
    const seq = Number(/SEQUENCE:(\d+)/.exec(cur.text)?.[1] ?? 0) + 1;
    const body = cur.text.replace(/DTSTART[^\r\n]*/, `DTSTART:${stamp(start)}`).replace(/DTEND[^\r\n]*/, `DTEND:${stamp(end)}`).replace(/SEQUENCE:\d+/, `SEQUENCE:${seq}`);
    const etag = cur.headers.get("etag");
    await must(await c.raw("PUT", `${ctx.origin}${ev.ids.href}`, { auth: "basic", body, headers: { "content-type": "text/calendar; charset=utf-8", ...(etag ? { "if-match": etag } : {}) } }), `PUT ${ev.ids.href}`);
    return { patch: { key: a.params.event, start } };
  },

  async "cal.rsvp"(a, ctx) {
    const ev = need(ctx, a.params.event);
    const c = ctx.client(a.persona, "dav");
    const report = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">${ev.ids.uid}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const res = await must(await c.raw("REPORT", `${ctx.origin}/calendars/${a.persona}/default/`, { auth: "basic", body: report, headers: { "content-type": "application/xml", depth: "1" } }), "REPORT calendar-query");
    const href = /<d:href>([^<]+)<\/d:href>/i.exec(res.text)?.[1];
    if (!href) throw new Error(`invitation "${ev.title}" is not in ${a.persona}'s CalDAV calendar`);
    const cur = await must(await c.raw("GET", `${ctx.origin}${href}`, { auth: "basic", headers: { accept: "text/calendar" } }), `GET ${href}`);
    const me = ctx.world.email(a.persona);
    const partstat = a.params.response.toUpperCase();
    const unfolded = cur.text.replace(/\r?\n[ \t]/g, "");
    const body = unfolded.replace(new RegExp(`(ATTENDEE[^\\r\\n]*?)PARTSTAT=[A-Z-]+([^\\r\\n]*mailto:${me.replace(/[.]/g, "\\.")})`, "i"), `$1PARTSTAT=${partstat}$2`);
    if (body === unfolded) throw new Error(`no ATTENDEE line for ${me} in ${href}`);
    const etag = cur.headers.get("etag");
    await must(await c.raw("PUT", `${ctx.origin}${href}`, { auth: "basic", body, headers: { "content-type": "text/calendar; charset=utf-8", ...(etag ? { "if-match": etag } : {}) } }), `PUT ${href}`);
    return {};
  },

  async "contact.create"(a, ctx) {
    const c = ctx.client(a.persona, "dav");
    const uid = uuid();
    const href = `/addressbooks/${a.persona}/default/${uid}.vcf`;
    await must(await c.raw("PUT", `${ctx.origin}${href}`, { auth: "basic", body: vcard({ uid, ...a.params }), headers: { "content-type": "text/vcard; charset=utf-8", "if-none-match": "*" } }), `PUT ${href}`);
    return { ids: { href, uid }, extra: { name: a.params.name, email: a.params.email, via: "dav" } };
  },

  async "contact.edit"(a, ctx) {
    const card = need(ctx, a.params.contact);
    const c = ctx.client(a.persona, "dav");
    const cur = await must(await c.raw("GET", `${ctx.origin}${card.ids.href}`, { auth: "basic", headers: { accept: "text/vcard" } }), `GET ${card.ids.href}`);
    const body = cur.text.replace(/NOTE:[^\r\n]*\r?\n/, "").replace(/END:VCARD/, `NOTE:${a.params.note}\r\nEND:VCARD`);
    const etag = cur.headers.get("etag");
    await must(await c.raw("PUT", `${ctx.origin}${card.ids.href}`, { auth: "basic", body, headers: { "content-type": "text/vcard; charset=utf-8", ...(etag ? { "if-match": etag } : {}) } }), `PUT ${card.ids.href}`);
    return { patch: { key: a.params.contact, note: a.params.note } };
  },
};
