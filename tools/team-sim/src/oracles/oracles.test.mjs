import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWorld } from "../world/load.mjs";
import { OLDER_SAMPLE, convergenceOracle, pickChecked } from "./convergence.mjs";
import { coverageOracle } from "./coverage.mjs";
import { davParityDiff } from "./davparity.mjs";
import { errorsOracle } from "./errors.mjs";
import { gapOracle } from "./gap.mjs";
import { notifyOracle } from "./notify.mjs";
import { templateMatcher } from "./routes.mjs";
import { timingOracle } from "./timing.mjs";
import { upgradeOracle } from "./upgrade.mjs";
import { visibilityOracle } from "./visibility.mjs";

const world = loadWorld();
const date = "2026-11-12";
const kind = (m, p) => `${m} ${p}`;
const budget = { exceeded: () => false };

/** Probes for a clean workspace: every list shows exactly what the persona's Teams grant. */
function cleanProbes(overrides = {}) {
  return {
    async lists(p) {
      const mine = world.teamsOf(p);
      const mates = world.personasOn(date).filter((x) => x !== p && world.sharesTeam(x, p));
      return {
        invitees: world.persona(p).isAdmin ? [...world.personasOn(date), ...world.meta.devAccounts] : mates,
        inviteesShared: mates,
        sharePrincipals: [...mates, ...mine.map((t) => `groups/${t}`)],
        channels: mine.map((t) => ({ groupSlug: t })),
        groupFolders: mine,
        groupTaskLists: mine,
        groupNotebooks: mine,
        groupCalendars: mine,
        teamMembers: mates,
        ...(overrides.lists?.(p) ?? {}),
      };
    },
    dmStatus: async (p, peer) => overrides.dmStatus?.(p, peer) ?? 403,
    freeBusy: async () => false,
    folderStatus: async (p, path) => overrides.folderStatus?.(p, path) ?? 404,
    objectStatus: async (p, o) => overrides.objectStatus?.(p, o) ?? 404,
  };
}

test("every oracle reports a planted fault", async () => {
  // errors: a 500 response and an uncaught page error.
  const errors = errorsOracle({ requests: [{ persona: "priya", method: "POST", path: "/api/v1/chat/x", status: 500, layer: "api" }], browserEvents: [{ type: "pageerror", persona: "eva", text: "TypeError: x is undefined" }], requestKind: kind });
  assert.equal(errors.status, "fail");
  assert.equal(errors.failures.length, 2);

  // convergence: two readers see different titles.
  const objects = [{ key: "task:a", type: "task", scope: "studio", owner: "sanne", status: "active", ids: { taskId: "1" }, night: date }];
  const conv = await convergenceOracle({ world, date, objects, nightIndex: 0, budget, read: async (p) => ({ state: { title: p === "eva" ? "old" : "new" } }) });
  assert.equal(conv.status, "fail");
  assert.match(conv.failures[0].signature, /convergence:task:diverged/);

  // convergence: a lost write (completed in the app, open on the server).
  const lost = await convergenceOracle({ world, date, objects: [{ ...objects[0], status: "done" }], nightIndex: 0, budget, read: async () => ({ state: { status: "needs-action" }, mismatch: "status is needs-action, expected completed" }) });
  assert.match(lost.failures[0].signature, /lost-write/);

  // notify: one mention never arrived; one invite arrived twice.
  const notify = notifyOracle({
    world,
    expected: [
      { to: "eva", domain: "chat", action: "mentioned", from: "sanne", n: 4 },
      { to: "daan", domain: "calendar", action: "invite", from: "joost", n: 9 },
    ],
    inboxes: { eva: [], daan: [1, 2].map((i) => ({ id: i, domain: "calendar", action: "invite", data: { actor: "Joost Bakker" }, title: "Joost Bakker invited you", createdAt: "2026-11-12T01:00:00Z" })) },
    devInboxes: { admin: [], member: [] },
    mails: [],
    expectedMails: [{ to: "client@example.org", n: 9, title: "Kickoff" }],
    nightStart: "2026-11-12T00:00:00Z",
  });
  assert.equal(notify.status, "fail");
  assert.deepEqual(notify.failures.map((f) => f.signature).sort(), ["notify:calendar.invite:extra", "notify:chat.mentioned:missing", "notify:mail:missing"]);

  // visibility: a non-admin persona's invitee picker lists a dev account.
  const vis = await visibilityOracle({ world, date, objects: [], probes: cleanProbes({ lists: (p) => (p === "daan" ? { invitees: ["member"] } : {}) }) });
  assert.equal(vis.status, "fail");
  assert.ok(vis.failures.every((f) => f.private), "visibility failures are private");

  // dav-parity: an event missing over CalDAV and a renamed contact.
  const parity = davParityDiff("joost", { jmapEvents: new Map([["u1", "Kickoff"]]), davEvents: new Map(), jmapCards: new Map([["c1", "Ann"]]), davCards: new Map([["c1", "Anne"]]) });
  assert.deepEqual(parity.map((f) => f.signature), ["dav-parity:event:missing-in-dav", "dav-parity:contact:title"]);

  // upgrade: migrations failed.
  assert.equal(upgradeOracle({ upgrade: { ok: false, before: "abc", error: "migration 42 failed" } }).status, "fail");

  // timing: a slow kind is flagged, never failed.
  const history = { nights: ["2026-11-09", "2026-11-10", "2026-11-11"].map((d) => ({ date: d, kinds: { "GET /x": { p95: 100 } } })) };
  const timing = timingOracle({ requests: Array.from({ length: 20 }, () => ({ method: "GET", path: "/x", status: 200, ms: 900, layer: "api" })), requestKind: kind, history, date });
  assert.equal(timing.status, "flag");

  // gap and coverage never fail; gap lists the moment for the product lead.
  assert.equal(gapOracle({ actions: [{ kind: "gap", persona: "eva", n: 3, params: { need: "x", workaround: "y" } }] }).product.length, 1);
  const cov = coverageOracle({ requests: [], screensVisited: [], templates: [templateMatcher("GET", "/notes")], screens: ["/notes"], coverage: {}, date });
  assert.equal(cov.status, "pass");
  assert.deepEqual(cov.metrics.missingRoutes, ["GET /notes"]);
});

test("dev accounts admin and member are known, never personas", async () => {
  assert.deepEqual(world.meta.devAccounts, ["admin", "member"]);
  for (const d of world.meta.devAccounts) assert.ok(!world.personas.some((p) => p.id === d), `${d} is not a persona`);
  // A DM that opens with a dev account is a visibility failure for any persona.
  const vis = await visibilityOracle({ world, date, objects: [], probes: cleanProbes({ dmStatus: (p, peer) => (p === "eva" && peer === "member" ? 201 : 403) }) });
  assert.deepEqual(vis.failures.map((f) => f.signature), ["visibility:dm-outsider"]);
  // Anything in a dev account's inbox tonight fails the notify oracle.
  const n = notifyOracle({ world, expected: [], inboxes: {}, devInboxes: { admin: [{ domain: "chat", action: "message_posted", title: "Eva posted", createdAt: "2026-11-12T02:00:00Z" }], member: [] }, mails: [], expectedMails: [], nightStart: "2026-11-12T00:00:00Z" });
  assert.deepEqual(n.failures.map((f) => f.signature), ["notify:dev-account:admin"]);
});

test("an admin persona listing every colleague is not a visibility failure", async () => {
  const admin = world.personas.find((p) => p.isAdmin).id;
  const vis = await visibilityOracle({ world, date, objects: [], probes: cleanProbes() });
  assert.equal(vis.status, "pass", JSON.stringify(vis.failures));
  // The same full list for a non-admin persona is a failure.
  const nonAdmin = world.teamsOf("daan").length === 1 ? "daan" : "bas";
  const leak = await visibilityOracle({ world, date, objects: [], probes: cleanProbes({ lists: (p) => (p === nonAdmin ? { invitees: [...world.personasOn(date), ...world.meta.devAccounts] } : {}) }) });
  assert.ok(leak.failures.length > 0);
  assert.ok(leak.failures.every((f) => f.persona === nonAdmin));
  assert.ok(admin);
});

test("an admin persona's DM or share outside his Teams is a visibility failure", async () => {
  const admin = world.personas.find((p) => p.isAdmin).id;
  const foreignTeam = world.teams.find((t) => !world.teamsOf(admin).includes(t.id)).id;
  const dm = await visibilityOracle({ world, date, objects: [], probes: cleanProbes({ dmStatus: (p, peer) => (p === admin && peer === "admin" ? 201 : 403) }) });
  assert.deepEqual(dm.failures.map((f) => [f.persona, f.signature]), [[admin, "visibility:dm-outsider"]]);
  const objects = [{ key: "doc:x", type: "doc", scope: foreignTeam, owner: "eva", status: "active", ids: { path: `/groups/${foreignTeam}/x.md` } }];
  const read = await visibilityOracle({ world, date, objects, probes: cleanProbes({ objectStatus: (p) => (p === admin ? 200 : 404) }) });
  assert.deepEqual(read.failures.map((f) => [f.persona, f.signature]), [[admin, "visibility:object-read:doc"]]);
  const folder = await visibilityOracle({ world, date, objects: [], probes: cleanProbes({ folderStatus: (p, path) => (p === admin && path === `/groups/${foreignTeam}` ? 207 : 404) }) });
  assert.deepEqual(folder.failures.map((f) => [f.persona, f.signature]), [[admin, "visibility:drive-folder"]]);
});

test("convergence checks touched objects plus a fixed-size sample", () => {
  const mk = (i, night) => ({ key: `note:${String(i).padStart(4, "0")}`, type: "note", scope: "own:eva", owner: "eva", status: "active", ids: { noteId: String(i) }, night });
  const objects = [...Array.from({ length: 900 }, (_, i) => mk(i, "2026-11-10")), ...Array.from({ length: 7 }, (_, i) => mk(1000 + i, date))];
  const a = pickChecked(objects, date, 0);
  assert.equal(a.tonight.length, 7);
  assert.equal(a.sample.length, OLDER_SAMPLE);
  assert.equal(a.intervalNights, 5);
  // The next night checks a different window; five nights cover every older object.
  const seen = new Set();
  for (let k = 0; k < 5; k += 1) for (const o of pickChecked(objects, date, k).sample) seen.add(o.key);
  assert.equal(seen.size, 900);
  // Deterministic.
  assert.deepEqual(pickChecked(objects, date, 3).sample.map((o) => o.key), pickChecked(objects, date, 3).sample.map((o) => o.key));
});
