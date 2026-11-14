import { convergenceOracle } from "./convergence.mjs";
import { coverageOracle } from "./coverage.mjs";
import { davParityOracle } from "./davparity.mjs";
import { errorsOracle } from "./errors.mjs";
import { gapOracle } from "./gap.mjs";
import { notifyOracle } from "./notify.mjs";
import { createReaders } from "./readers.mjs";
import { oracleResult } from "./result.mjs";
import { requestKind as kindOf } from "./routes.mjs";
import { timingOracle } from "./timing.mjs";
import { upgradeOracle } from "./upgrade.mjs";
import { createVisibilityProbes, visibilityOracle } from "./visibility.mjs";

export const ORACLE_CAP_MS = 15 * 60000;

/**
 * Runs every oracle after the settle period. Network oracles share one
 * 15-minute cap: whatever has not finished when it runs out reports
 * "unchecked", never "pass". Returns the results plus the next cross-night
 * state (timing history, coverage map).
 */
export async function runOracles(input) {
  const { world, date, plan, requests, browserEvents, screensVisited, templates, screens, objects, client, origin, expectedMails, nightStart, upgrade, history, coverage, nightIndex, capMs = ORACLE_CAP_MS, log = () => {}, fetchMail, saveInboxes } = input;
  const layerOf = new Map(plan.actions.map((a) => [a.n, a.layer]));
  const expected = input.expected.map((e) => ({ ...e, layer: e.layer ?? layerOf.get(e.n) }));
  const started = Date.now();
  const budget = { exceeded: () => Date.now() - started > capMs };
  const requestKind = (m, p) => kindOf(templates, m, p);
  const nightRequests = requests.filter((r) => r.layer !== "oracle" && r.layer !== "bootstrap");
  const results = [];

  const timed = async (name, fn) => {
    if (budget.exceeded()) {
      results.push(oracleResult(name, { unchecked: true, notes: ["Not run: the 15-minute oracle cap ran out first."] }));
      return;
    }
    const t = Date.now();
    try {
      results.push(await fn());
    } catch (e) {
      results.push(oracleResult(name, { unchecked: true, notes: [`The oracle itself failed: ${e.message.split("\n")[0]}`] }));
    }
    log(`oracle ${name}: ${results.at(-1).status} (${Math.round((Date.now() - t) / 1000)} s)`);
  };

  await timed("upgrade", () => upgradeOracle({ upgrade }));
  await timed("errors", () => errorsOracle({ requests: nightRequests, browserEvents, requestKind }));
  await timed("convergence", () => convergenceOracle({ world, date, objects, nightIndex, read: createReaders({ client, origin }), budget }));
  await timed("notify", async () => {
    const personas = world.personasOn(date);
    const inboxes = {};
    for (const p of personas) inboxes[p] = await inbox(client(p, "oracle"), nightStart);
    const devInboxes = {};
    for (const d of world.meta.devAccounts) devInboxes[d] = await inbox(client(d, "oracle"), nightStart);
    saveInboxes?.({ inboxes, devInboxes });
    const mails = fetchMail ? await fetchMail() : [];
    const r = notifyOracle({ world, expected, inboxes, devInboxes, mails, expectedMails, nightStart });
    const capped = Object.entries(inboxes).filter(([, l]) => l.capped).map(([p]) => p);
    if (capped.length) r.notes.push(`Inbox read is capped at 100 entries; ${capped.join(", ")} hit the cap, so older entries tonight were not seen.`);
    return r;
  });
  await timed("visibility", () => visibilityOracle({ world, date, probes: createVisibilityProbes({ client }), objects }));
  await timed("dav-parity", () => davParityOracle({ personas: world.personasOn(date), client, origin, objects, date }));
  const timing = timingOracle({ requests: nightRequests, requestKind, history, date });
  results.push(timing);
  const cov = coverageOracle({ requests: nightRequests, screensVisited, templates, screens, coverage, date });
  results.push(cov);
  results.push(gapOracle({ actions: plan.actions }));
  return { results, nextHistory: timing.nextHistory, nextCoverage: cov.nextCoverage, ms: Date.now() - started };
}

/** A persona's notifications created since the night started. */
async function inbox(c, since) {
  const res = await c.request("GET", "/api/v1/notifications");
  if (!res.ok) throw new Error(`notifications for ${c.username ?? "?"}: HTTP ${res.status}`);
  const all = res.json?.list ?? res.json?.data ?? res.json ?? [];
  const list = all.filter((n) => n.createdAt >= since);
  list.capped = all.length >= 100 && all.every((n) => n.createdAt >= since);
  return list;
}

/** MailHog capture on the instance's own mail API. */
export function mailHog(port) {
  const base = `http://127.0.0.1:${port}`;
  return {
    async messages() {
      const res = await fetch(`${base}/api/v2/messages?limit=500`);
      if (!res.ok) throw new Error(`MailHog HTTP ${res.status}`);
      const body = await res.json();
      return (body.items ?? []).map((m) => ({
        id: m.ID,
        to: (m.To ?? []).map((t) => `${t.Mailbox}@${t.Domain}`),
        subject: m.Content?.Headers?.Subject?.[0] ?? "",
        raw: m.Raw?.Data ?? "",
      }));
    },
    clear: () => fetch(`${base}/api/v1/messages`, { method: "DELETE" }),
  };
}
