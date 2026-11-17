import { oracleResult } from "./result.mjs";

/** Kinds the harness predicts exactly. Others (chat.message_posted, …) are counted, not checked. */
export const CHECKED = new Set(["chat.mentioned", "calendar.invite"]);

/**
 * Every action that should notify a persona produces exactly one entry in
 * that persona's inbox; none for non-recipients; nothing ever reaches the dev
 * accounts. External invitees get at least one mail in MailHog.
 * `inboxes[persona]` = notifications created since the night started.
 */
export function notifyOracle({ world, expected, inboxes, devInboxes, mails, expectedMails, nightStart }) {
  const failures = [];
  const key = (to, kind, from) => `${to}|${kind}|${from ?? "?"}`;
  const want = new Map();
  for (const e of expected) {
    const k = key(e.to, `${e.domain}.${e.action}`, e.from);
    want.set(k, [...(want.get(k) ?? []), e]);
  }
  const got = new Map();
  const counts = {};
  for (const [persona, list] of Object.entries(inboxes)) {
    for (const n of list) {
      const kind = `${n.domain}.${n.action}`;
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (!CHECKED.has(kind)) continue;
      const from = n.data?.actorUsername ?? actorFromLabel(world, n.data?.actor) ?? n.data?.actor ?? "?";
      const k = key(persona, kind, from);
      got.set(k, [...(got.get(k) ?? []), n]);
    }
  }
  for (const [k, exp] of want) {
    const [to, kind, from] = k.split("|");
    const have = got.get(k)?.length ?? 0;
    if (have !== exp.length) {
      const layers = [...new Set(exp.map((e) => e.layer).filter(Boolean))].sort().join("+");
      failures.push({
        signature: `notify:${kind}:${have < exp.length ? "missing" : "extra"}${layers ? `:${layers}` : ""}`,
        persona: to,
        action: exp[0].n,
        detail: `${to} has ${have} ${kind} from ${from}, expected ${exp.length} (actions ${exp.map((e) => `#${e.n}`).join(", ")}${layers ? `, sent over ${layers}` : ""})`,
      });
    }
  }
  for (const [k, list] of got) {
    if (want.has(k)) continue;
    const [to, kind, from] = k.split("|");
    failures.push({ signature: `notify:${kind}:unexpected`, persona: to, detail: `${to} got ${list.length} ${kind} from ${from} that no action caused ("${list[0].title}")` });
  }
  for (const [dev, list] of Object.entries(devInboxes)) {
    const tonight = list.filter((n) => n.createdAt >= nightStart);
    if (tonight.length) failures.push({ signature: `notify:dev-account:${dev}`, persona: dev, private: true, detail: `dev account ${dev} received ${tonight.length} notification(s) from the studio ("${tonight[0].title}")` });
  }
  const mailTo = (addr) => mails.filter((m) => m.to.some((t) => t.toLowerCase() === addr.toLowerCase()));
  for (const m of expectedMails) {
    if (!mailTo(m.to).length) failures.push({ signature: "notify:mail:missing", action: m.n, detail: `no invitation mail reached ${m.to} for "${m.title}"` });
  }
  return oracleResult("notify", {
    failures,
    notes: [
      `${expected.length} predicted inbox entries (${[...CHECKED].join(", ")}); ${expectedMails.length} predicted mails, ${mails.length} captured by MailHog.`,
      `Inbox entries tonight by kind: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}.`,
    ],
    metrics: { counts, mails: mails.length },
  });
}

/** Calendar invites carry the organizer's label (display name or address), not the username. */
function actorFromLabel(world, label) {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  const p = world.personas.find((x) => x.displayName.toLowerCase() === l || x.id === l || world.email?.(x.id)?.toLowerCase() === l || l.startsWith(`${x.id}@`));
  return p?.id ?? null;
}
