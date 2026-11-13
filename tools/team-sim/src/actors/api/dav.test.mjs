import assert from "node:assert/strict";
import { test } from "node:test";
import { DIALECTS, davExecutors, nativeCard, resetNativeClients } from "./dav.mjs";

const origin = "http://sim.test";
const href = "/addressbooks/joost/default/CARD-1.vcf";
const card = (note) => ["BEGIN:VCARD", "VERSION:3.0", "UID:CARD-1", "FN:Anouk Vos", ...(note ? [`NOTE:${note}`] : []), "item1.TEL:+31 20 555 0100", "item1.X-ABLabel:Studio", "END:VCARD", ""].join("\r\n");

/** A CardDAV server stand-in: someone else edits the card between the app's sync and its write. */
function fakeServer({ conflictOnce }) {
  let etag = '"v1"';
  let body = card(null);
  let conflicts = conflictOnce ? 1 : 0;
  const calls = [];
  const headers = (h) => ({ get: (k) => h[k.toLowerCase()] ?? null });
  const raw = async (method, url, { headers: h = {}, body: sent } = {}) => {
    calls.push([method, url.replace(origin, ""), h["if-match"] ?? h["if-none-match"] ?? null]);
    if (method === "REPORT") return { status: 207, text: `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${etag}</d:getetag></d:prop></d:propstat></d:response><d:sync-token>t1</d:sync-token></d:multistatus>`, headers: headers({}) };
    if (method === "GET") return { status: 200, text: body, headers: headers({ etag }) };
    if (method === "PUT") {
      if (conflicts > 0) {
        conflicts -= 1;
        body = body.replace("FN:Anouk Vos", "FN:Anouk Vos-de Wit");
        etag = '"v2"';
        return { status: 412, text: "", headers: headers({}) };
      }
      if (h["if-match"] && h["if-match"] !== etag) return { status: 412, text: "", headers: headers({}) };
      body = sent;
      etag = `"v${Number(etag.slice(2, -1)) + 1}"`;
      return { status: 204, text: "", headers: headers({ etag }) };
    }
    throw new Error(`unexpected ${method}`);
  };
  return { calls, client: { raw, setAction() {} }, body: () => body };
}

const ctxFor = (server) => ({
  origin,
  client: () => server.client,
  registry: { get: (k) => (k === "contact:1" ? { ids: { href, uid: "CARD-1" } } : null) },
});

test("a 412 is resolved the way the app does it: refetch, apply the edit to the fresh copy, retry once", async () => {
  resetNativeClients();
  const server = fakeServer({ conflictOnce: true });
  const r = await davExecutors["contact.edit"]({ n: 9, persona: "joost", client: "apple", device: "desk", params: { contact: "contact:1", note: "Belt liever dan mailt" } }, ctxFor(server));
  assert.match(r.note, /412 resolved/);
  const puts = server.calls.filter(([m]) => m === "PUT");
  assert.equal(puts.length, 2);
  assert.deepEqual(puts.map(([, , cond]) => cond), ['"v1"', '"v2"']);
  assert.match(server.body(), /FN:Anouk Vos-de Wit/, "the other edit is kept");
  assert.match(server.body(), /NOTE:Belt liever dan mailt/, "and ours is applied on top");
  assert.match(server.body(), /item1\.X-ABLabel:Studio/);
});

test("without a conflict the app writes once with the etag it synced", async () => {
  resetNativeClients();
  const server = fakeServer({ conflictOnce: false });
  const r = await davExecutors["contact.edit"]({ n: 10, persona: "joost", client: "apple", device: "desk", params: { contact: "contact:1", note: "Nieuw adres" } }, ctxFor(server));
  assert.doesNotMatch(r.note, /412/);
  assert.deepEqual(server.calls.filter(([m]) => m === "PUT").map(([, , c]) => c), ['"v1"']);
});

test("each app writes its own dialect", () => {
  const p = { uid: "U1", name: "Anouk Vos", org: "Bakkerij Vos", email: "anouk@example.org", phone: "+31 20 555 0101" };
  const apple = nativeCard(DIALECTS.apple, "phone", p);
  const davx5 = nativeCard(DIALECTS.davx5, "phone", p);
  assert.match(apple, /VERSION:3\.0/);
  assert.match(apple, /X-ABLabel/);
  assert.match(apple, /iPhone OS/);
  assert.match(davx5, /VERSION:4\.0/);
  assert.doesNotMatch(davx5, /X-ABLabel/);
});
