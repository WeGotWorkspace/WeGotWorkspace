import test from "node:test";
import assert from "node:assert/strict";
import { loadWorld } from "../world/load.mjs";
import { infraOn } from "../world/infra.mjs";
import { MAIL_SETTINGS, planReconcile } from "./reconcile.mjs";

const world = loadWorld();
const devInstall = () => ({
  users: [
    { username: "admin", isAdmin: true, groups: ["principals/groups/team"] },
    { username: "member", isAdmin: false, groups: ["principals/groups/team"] },
  ],
  groups: [{ id: "principals/groups/team", name: "team" }],
  mail: { transport: "auto", smtpHost: "", smtpPort: 587, smtpSecurity: "starttls", smtpUsername: "", from: "" },
  infra: new Set(),
});

/** What the server looks like after the writes: the fake the second run reads. */
function apply(server, writes) {
  const s = structuredClone({ ...server, infra: [...server.infra] });
  for (const w of writes) {
    if (w.op === "user.create") s.users.push({ username: w.username, isAdmin: w.body.isAdmin, groups: [] });
    if (w.op === "team.create") s.groups.push({ id: `principals/groups/${w.slug}`, name: w.slug });
    if (w.op === "team.member") s.users.find((u) => u.username === w.username).groups.push(`principals/groups/${w.slug}`);
    if (w.op === "mail.settings") s.mail = { transport: "smtp", smtpHost: "mailhog", smtpPort: 1025, smtpSecurity: "none", smtpUsername: MAIL_SETTINGS.mail_delivery_smtp_username, from: MAIL_SETTINGS.mail_delivery_from };
    if (w.op === "infra.create") s.infra.push(w.item.key);
  }
  return { ...s, infra: new Set(s.infra) };
}

test("second run against the same state plans zero writes", () => {
  const date = "2026-11-12";
  const infra = infraOn(world, date);
  const first = planReconcile({ world, date, server: devInstall(), infra });
  assert.ok(first.length > 20);
  const second = planReconcile({ world, date, server: apply(devInstall(), first), infra });
  assert.deepEqual(second, []);
});

test("a persona with a later start date is not created yet", () => {
  const writes = planReconcile({ world, date: "2026-11-12", server: devInstall(), infra: [] });
  assert.ok(!writes.some((w) => w.username === "tom"));
  const later = planReconcile({ world, date: "2026-11-30", server: devInstall(), infra: [] });
  assert.ok(later.some((w) => w.op === "user.create" && w.username === "tom"));
  assert.ok(later.some((w) => w.op === "team.member" && w.username === "tom" && w.slug === "studio"));
});

test("Maarten is created as admin and Team team is left alone", () => {
  const writes = planReconcile({ world, date: "2026-11-12", server: devInstall(), infra: [] });
  assert.equal(writes.find((w) => w.username === "maarten" && w.op === "user.create").body.isAdmin, true);
  assert.ok(writes.filter((w) => w.op === "user.create" && w.username !== "maarten").every((w) => w.body.isAdmin === false));
  assert.ok(!writes.some((w) => w.slug === "team" || w.username === "admin" || w.username === "member"));
});

test("mail goes to MailHog with every value the spec names", () => {
  const writes = planReconcile({ world, date: "2026-11-12", server: devInstall(), infra: [] });
  assert.deepEqual(writes.find((w) => w.op === "mail.settings").values, MAIL_SETTINGS);
  assert.equal(MAIL_SETTINGS.mail_delivery_smtp_security, "none");
  assert.ok(MAIL_SETTINGS.mail_delivery_smtp_username);
});

test("project structure appears on the kick-off date", () => {
  assert.ok(!infraOn(world, "2026-11-18").some((i) => i.key === "channel:project:haven"));
  assert.ok(infraOn(world, "2026-11-19").some((i) => i.key === "channel:project:haven"));
  assert.ok(infraOn(world, "2026-11-19").some((i) => i.key === "folder:project:haven"));
});
