import { createHash } from "node:crypto";
import { USING, jmap1 } from "../client/jmap.mjs";
import { baseName, parentOf } from "../actors/api/paths.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const absent = { absent: true };
const gone = (res) => res.status === 404 || res.status === 403 || res.status === 410;

/**
 * Normalized reads of one object as one persona, for the convergence oracle.
 * Each returns `{ state }`, `{ absent: true }`, or `{ state, mismatch }` when
 * the server disagrees with what the registry says was written.
 */
export function createReaders({ client, origin }) {
  const channelCache = new Map();
  const dirCache = new Map();
  const c = (p) => client(p, "oracle");

  async function messages(p, channelId) {
    const k = `${p}:${channelId}`;
    if (!channelCache.has(k)) {
      const res = await c(p).request("GET", `/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages?limit=200`);
      channelCache.set(k, gone(res) ? null : res.ok ? res.json.list : Promise.reject(new Error(`messages HTTP ${res.status}`)));
    }
    return channelCache.get(k);
  }

  async function children(p, dir) {
    const k = `${p}:${dir}`;
    if (!dirCache.has(k)) {
      const res = await c(p).request("GET", `/api/v1/files/children?path=${encodeURIComponent(dir)}`);
      dirCache.set(k, gone(res) ? null : res.ok ? res.json.data.files : Promise.reject(new Error(`children HTTP ${res.status}`)));
    }
    return dirCache.get(k);
  }

  const readers = {
    async message(p, o) {
      const list = await messages(p, o.ids.channelId);
      if (!list) return absent;
      const m = list.find((x) => x.id === o.ids.messageId);
      if (!m) return list.length >= 200 ? { state: "outside-window" } : absent;
      return { state: { body: m.body, parentId: m.parentId ?? null, deleted: !!m.deletedAt } };
    },
    async dm(p, o) {
      return readers.message(p, o);
    },
    async task(p, o) {
      const res = await c(p).request("GET", `/api/v1/tasks/items/${encodeURIComponent(o.ids.taskId)}`);
      if (gone(res)) return absent;
      if (!res.ok) throw new Error(`task HTTP ${res.status}`);
      const t = res.json;
      const state = { title: t.title, status: t.workflowStatus ?? null, due: t.due ?? null };
      const want = { done: "completed", archived: "cancelled" }[o.status];
      return { state, mismatch: want && state.status !== want ? `status is ${state.status}, expected ${want}` : undefined };
    },
    async note(p, o) {
      const res = await c(p).request("GET", `/api/v1/notes/items/${encodeURIComponent(o.ids.noteId)}`);
      if (gone(res)) return absent;
      if (!res.ok) throw new Error(`note HTTP ${res.status}`);
      return { state: { title: res.json.title, body: sha(res.json.body ?? ""), status: res.json.status ?? null } };
    },
    async doc(p, o) {
      const res = await c(p).request("GET", `/api/v1/files/content?path=${encodeURIComponent(o.ids.path)}`, { headers: { accept: "*/*" } });
      if (gone(res)) return absent;
      if (!res.ok) throw new Error(`doc HTTP ${res.status}`);
      return { state: { content: sha(res.text) } };
    },
    async comment(p, o) {
      const res = await c(p).request("GET", `/api/v1/files/threads?path=${encodeURIComponent(o.ids.path)}`);
      if (gone(res)) return absent;
      if (!res.ok) throw new Error(`threads HTTP ${res.status}`);
      const t = (res.json.list ?? []).find((x) => x.id === o.ids.threadId);
      if (!t) return absent;
      const resolved = !!(t.resolved ?? t.resolvedAt);
      return { state: { resolved, body: t.body ?? t.comments?.[0]?.body ?? null }, mismatch: o.status === "resolved" && !resolved ? "resolved in the app, open on the server" : undefined };
    },
    async event(p, o) {
      // Every participant reads their own copy over CalDAV by UID: title and start must agree.
      if (!o.ids.uid) return { state: "no-uid" };
      const report = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">${o.ids.uid}</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
      const res = await c(p).raw("REPORT", `${origin}/calendars/${p}/default/`, { auth: "basic", body: report, headers: { "content-type": "application/xml", depth: "1" } });
      if (res.status !== 207) throw new Error(`REPORT HTTP ${res.status}`);
      const data = res.text.replace(/\r?\n[ \t]/g, "");
      if (!/BEGIN:VEVENT/.test(data)) return absent;
      const start = /DTSTART[^:\r\n]*:([0-9TZ]+)/.exec(data)?.[1] ?? null;
      const title = /SUMMARY[^:\r\n]*:([^\r\n]*)/.exec(data)?.[1]?.replace(/&amp;/g, "&") ?? null;
      return { state: { title, start: normalizeStart(start) } };
    },
    async contact(p, o) {
      if (o.ids.href) {
        const res = await c(p).raw("GET", `${origin}${o.ids.href}`, { auth: "basic", headers: { accept: "text/vcard" } });
        if (gone(res)) return absent;
        return { state: { name: /FN:([^\r\n]*)/.exec(res.text)?.[1] ?? null } };
      }
      const got = await jmap1(c(p), USING.contacts, "ContactCard/get", { accountId: p, ids: [o.ids.cardId], properties: ["name"] });
      const card = got.list?.[0];
      return card ? { state: { name: card.name?.full ?? null } } : absent;
    },
    async file(p, o) {
      const list = await children(p, parentOf(o.ids.path));
      if (!list) return absent;
      const f = list.find((x) => x.name === baseName(o.ids.path) || x.path === o.ids.path);
      if (!f) return absent;
      return { state: { size: f.size }, mismatch: o.bytes && f.size !== o.bytes ? `size ${f.size}, uploaded ${o.bytes}` : undefined };
    },
  };

  return async function read(persona, o) {
    const fn = readers[o.type];
    if (!fn) return { state: "unchecked-type" };
    return fn(persona, o);
  };
}

/** "20261118T100000Z" and "20261118T100000" (floating) compare equal when the instant is the same. */
function normalizeStart(s) {
  if (!s) return null;
  return s.endsWith("Z") ? s : `${s}(local)`;
}
