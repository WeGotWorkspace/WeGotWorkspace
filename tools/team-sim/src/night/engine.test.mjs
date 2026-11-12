import test from "node:test";
import assert from "node:assert/strict";
import { runActions } from "./engine.mjs";

const plan = {
  actions: [
    { n: 1, persona: "a", kind: "chat.post", app: "chat", layer: "api", minute: 10, deps: [] },
    { n: 2, persona: "b", kind: "chat.reply", app: "chat", layer: "api", minute: 20, deps: [1] },
    { n: 3, persona: "a", kind: "drive.upload", app: "drive", layer: "api", minute: 30, deps: [] },
    { n: 4, persona: "b", kind: "drive.share", app: "drive", layer: "api", minute: 40, deps: [3] },
  ],
};

test("a dependent action is skipped when its dependency failed", async () => {
  const outcomes = await runActions({
    plan, windowMs: 0, deadline: Date.now() + 60000,
    execute: async (a) => { if (a.n === 3) throw new Error("upload 500"); },
  });
  assert.deepEqual(outcomes.map((o) => o.status), ["ok", "ok", "failed", "skipped"]);
  assert.match(outcomes[3].reason, /dependency #3 failed/);
});

test("actions past the time cap are skipped", async () => {
  const outcomes = await runActions({ plan, windowMs: 0, deadline: Date.now() - 1, execute: async () => {} });
  assert.ok(outcomes.every((o) => o.status === "skipped" && o.reason === "time cap"));
});
