import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openRegistry } from "../../state/registry.mjs";
import { loadWorld } from "../../world/load.mjs";
import { executeApi, recordResult } from "./index.mjs";
import { davUrl, projectFolder } from "./paths.mjs";

const world = loadWorld();

/** A client that records calls and answers posts with the posted body. */
function fakeClient(calls) {
  return {
    setAction() {},
    async post(path, json) {
      calls.push(["POST", path, json]);
      return { ...json };
    },
    async request(method, path) {
      calls.push([method, path]);
      return { ok: false, status: 403 };
    },
  };
}

test("project folders sit in their Team folder and DAV paths are encoded per segment", () => {
  const p = world.projects[0];
  assert.equal(projectFolder(world, p.id), `/groups/${p.team}/${p.name}`);
  assert.equal(davUrl("http://x", "/groups/studio/Huis & Haven/a b.md"), "http://x/files/groups/studio/Huis%20%26%20Haven/a%20b.md");
});

test("a mention posts to the registry's channel, expects one notification and lands in the registry", async () => {
  const registry = openRegistry(mkdtempSync(join(tmpdir(), "sim-api-")));
  registry.put("channel:team:studio", { type: "channel", scope: "studio", ids: { channelId: "chat-grp-1" } });
  const calls = [];
  const expected = [];
  const ctx = { world, registry, client: () => fakeClient(calls), expectNotify: (e) => expected.push(e) };
  const action = { n: 7, persona: "sanne", layer: "api", kind: "chat.mention", creates: "message:x", object: { type: "message", scope: "studio" }, params: { channel: "channel:team:studio", mention: "eva", text: "kun je kijken?" }, refs: ["channel:team:studio"] };
  const result = await executeApi(action, ctx);
  assert.equal(calls[0][1], "/api/v1/chat/channels/chat-grp-1/messages");
  assert.deepEqual(calls[0][2].mentions, [{ id: "eva", displayName: world.persona("eva").displayName }]);
  assert.deepEqual(expected, [{ to: "eva", domain: "chat", action: "mentioned", from: "sanne", n: 7 }]);
  recordResult(registry, action, result, "2026-11-12");
  assert.equal(registry.get("message:x").owner, "sanne");
  assert.equal(registry.get("message:x").ids.channelId, "chat-grp-1");
  assert.equal(registry.get("channel:team:studio").touched, "2026-11-12");
});

test("a refused leave is reported as unsupported, not as a failure", async () => {
  const registry = openRegistry(mkdtempSync(join(tmpdir(), "sim-api-")));
  registry.put("channel:project:vos", { type: "channel", scope: "studio", ids: { channelId: "chat-1" } });
  const ctx = { world, registry, client: () => fakeClient([]) };
  await assert.rejects(executeApi({ n: 1, persona: "bas", layer: "api", kind: "chat.leave", params: { channel: "channel:project:vos" } }, ctx), (e) => e.unsupported === true);
});

test("an unknown object fails the action with the logical key", async () => {
  const ctx = { world, registry: openRegistry(mkdtempSync(join(tmpdir(), "sim-api-"))), client: () => fakeClient([]) };
  await assert.rejects(executeApi({ n: 2, persona: "eva", layer: "api", kind: "chat.post", params: { channel: "channel:project:nope", text: "x" } }, ctx), /channel:project:nope/);
});
