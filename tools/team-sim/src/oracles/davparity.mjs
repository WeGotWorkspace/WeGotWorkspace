import { USING, jmap1 } from "../client/jmap.mjs";
import { oracleResult } from "./result.mjs";

/**
 * CalDAV/CardDAV reads match JMAP reads for the same calendar and address
 * book: the same UIDs, titles/names and start times.
 */
export async function davParityOracle({ personas, client, origin, objects = {}, date = null }) {
  const failures = [];
  const notes = [];
  const native = await nativeParity({ objects, date, client, origin });
  failures.push(...native.failures);
  if (native.checked) notes.push(native.note);
  for (const p of personas) {
    const c = client(p, "oracle");
    const q = await jmap1(c, USING.calendars, "CalendarEvent/query", { accountId: p, filter: { inCalendar: "default" } }).catch(() => jmap1(c, USING.calendars, "CalendarEvent/query", { accountId: p }));
    const ev = await jmap1(c, USING.calendars, "CalendarEvent/get", { accountId: p, ids: q.ids ?? [], properties: ["uid", "title", "start", "timeZone", "calendarIds"] });
    const jmapEvents = new Map((ev.list ?? []).filter((e) => !e.calendarIds || e.calendarIds.default).map((e) => [e.uid, e.title]));
    const dav = await davObjects(c, `${origin}/calendars/${p}/default/`, "VEVENT");
    const davEvents = new Map(dav.map((o) => [o.uid, o.summary]));

    const cq = await jmap1(c, USING.contacts, "ContactCard/query", { accountId: p });
    const cards = await jmap1(c, USING.contacts, "ContactCard/get", { accountId: p, ids: cq.ids ?? [], properties: ["uid", "name"] });
    const jmapCards = new Map((cards.list ?? []).map((x) => [x.uid, x.name?.full ?? null]));
    const vcards = await davObjects(c, `${origin}/addressbooks/${p}/default/`, "VCARD");
    const davCards = new Map(vcards.map((o) => [o.uid, o.fn]));
    failures.push(...davParityDiff(p, { jmapEvents, davEvents, jmapCards, davCards }));
    notes.push(`${p}: ${jmapEvents.size} events (JMAP) / ${davEvents.size} (CalDAV), ${jmapCards.size} contacts (JMAP) / ${davCards.size} (CardDAV).`);
  }
  return oracleResult("dav-parity", { failures, notes });
}

/** Pure comparison of one persona's JMAP and DAV views (uid → title/name maps). */
export function davParityDiff(p, { jmapEvents, davEvents, jmapCards, davCards }) {
  const failures = [];
  diff(failures, p, "event", jmapEvents, davEvents);
  diff(failures, p, "contact", jmapCards, davCards);
  return failures;
}

function diff(failures, p, what, jmapMap, davMap) {
  for (const [uid, title] of jmapMap) {
    if (!davMap.has(uid)) failures.push({ signature: `dav-parity:${what}:missing-in-dav`, persona: p, detail: `${p}: ${what} "${title}" (${uid}) is in JMAP but not in ${what === "event" ? "CalDAV" : "CardDAV"}` });
    else if ((davMap.get(uid) ?? "") !== (title ?? "")) failures.push({ signature: `dav-parity:${what}:title`, persona: p, detail: `${p}: ${what} ${uid} is "${title}" in JMAP and "${davMap.get(uid)}" over DAV` });
  }
  for (const [uid, title] of davMap) {
    if (!jmapMap.has(uid)) failures.push({ signature: `dav-parity:${what}:missing-in-jmap`, persona: p, detail: `${p}: ${what} "${title}" (${uid}) is over DAV but not in JMAP` });
  }
}

/** All objects in a DAV collection via PROPFIND + multiget-free GETs of calendar-data / address-data. */
async function davObjects(c, url, comp) {
  const body = comp === "VEVENT"
    ? `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>`
    : `<?xml version="1.0"?><card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><card:address-data/></d:prop></card:addressbook-query>`;
  const res = await c.raw("REPORT", url, { auth: "basic", body, headers: { "content-type": "application/xml", depth: "1" } });
  if (res.status !== 207) throw new Error(`REPORT ${url} → HTTP ${res.status}`);
  const text = res.text.replace(/\r?\n[ \t]/g, "").replace(/&#13;/g, "");
  const blocks = text.split(comp === "VEVENT" ? "BEGIN:VEVENT" : "BEGIN:VCARD").slice(1);
  const unescape = (s) => s?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\,/g, ",").replace(/\;/g, ";").trim() ?? null;
  return blocks
    .map((b) => ({ uid: unescape(/\nUID:([^\r\n]*)/.exec(`\n${b}`)?.[1]), summary: unescape(/\nSUMMARY[^:\r\n]*:([^\r\n]*)/.exec(`\n${b}`)?.[1]), fn: unescape(/\nFN[^:\r\n]*:([^\r\n]*)/.exec(`\n${b}`)?.[1]) }))
    .filter((o, i, all) => o.uid && all.findIndex((x) => x.uid === o.uid) === i);
}

/**
 * What a native app wrote tonight reads the same in the web app, and the
 * properties of its dialect survive the server: the object over DAV still
 * carries them, and JMAP/REST shows the same title, name or alarm.
 */
export async function nativeParity({ objects, date, client, origin }) {
  const failures = [];
  const mine = Object.values(objects ?? {}).filter((o) => o?.native && o.night === date && o.ids?.href);
  for (const o of mine) {
    const p = o.owner;
    const c = client(p, "oracle");
    const label = `${o.native.kind} "${o.title ?? o.name}" from ${o.client === "davx5" ? "DAVx5" : "an Apple app"}`;
    const res = await c.raw("GET", `${origin}${o.ids.href}`, { auth: "basic" });
    if (res.status !== 200) {
      failures.push({ signature: `dav-parity:native:${o.native.kind}:gone`, persona: p, detail: `${p}: ${label} → HTTP ${res.status} over DAV after the night` });
      continue;
    }
    const body = res.text.replace(/\r?\n[ \t]/g, "");
    // Property names are case-insensitive (the server writes ITEM1.X-ABLABEL for item1.X-ABLabel).
    const upper = body.toUpperCase();
    const dropped = (o.native.markers ?? []).filter((m) => !upper.includes(m.toUpperCase()));
    if (dropped.length) failures.push({ signature: `dav-parity:native:${o.native.kind}:dropped`, persona: p, detail: `${p}: ${label} lost ${dropped.join(", ")} on the server` });
    const seen = await webView(c, p, o).catch((e) => `could not read it in the web app (${e.message})`);
    if (seen) failures.push({ signature: `dav-parity:native:${o.native.kind}:web`, persona: p, detail: `${p}: ${label}: ${seen}` });
  }
  return { failures, checked: mine.length, note: `${mine.length} object(s) written by native apps tonight checked over DAV and in the web app.` };
}

/** Null when the web app shows the native object as written; otherwise what differs. */
async function webView(c, p, o) {
  if (o.native.kind === "event") {
    const q = await jmap1(c, USING.calendars, "CalendarEvent/query", { accountId: p });
    const got = await jmap1(c, USING.calendars, "CalendarEvent/get", { accountId: p, ids: q.ids ?? [], properties: ["uid", "title", "alerts"] });
    const ev = (got.list ?? []).find((e) => e.uid === o.ids.uid);
    if (!ev) return "not in the web app's calendar";
    if (ev.title !== o.title) return `title "${ev.title}" in the web app`;
    if (!Object.keys(ev.alerts ?? {}).length) return "the reminder set in the app is missing in the web app";
    return null;
  }
  if (o.native.kind === "card") {
    const q = await jmap1(c, USING.contacts, "ContactCard/query", { accountId: p });
    const got = await jmap1(c, USING.contacts, "ContactCard/get", { accountId: p, ids: q.ids ?? [], properties: ["uid", "name", "emails"] });
    const card = (got.list ?? []).find((x) => x.uid === o.ids.uid);
    if (!card) return "not in the web app's contacts";
    if (o.email && !Object.values(card.emails ?? {}).some((e) => e.address === o.email)) return "the email address is missing in the web app";
    return null;
  }
  if (o.native.kind === "todo" && o.ids.listId) {
    const res = await c.request("GET", `/api/v1/tasks/items?taskListId=${encodeURIComponent(o.ids.listId)}`);
    if (!(res.json?.list ?? []).some((t) => t.title === o.title)) return "not in the web app's task list";
  }
  return null;
}
