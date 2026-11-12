// Morning report. Pure: takes the night's results and the cross-night state,
// returns markdown plus the next state. No network client lives in this
// module or its imports; the report never leaves the machine through it.
import { addDays, weekday } from "../planner/dates.mjs";
import { voiceLines } from "./voice.mjs";

const FILE_AT = 3;

/** Per-signature night counter. A signature seen on 3 nights moves to "file now". */
export function updateFlaky(flaky, date, signatures) {
  const next = structuredClone(flaky ?? {});
  for (const sig of signatures) {
    const entry = (next[sig] ??= { nights: [], firstSeen: date });
    if (!entry.nights.includes(date)) entry.nights.push(date);
  }
  return next;
}

export const nightCount = (flaky, sig) => flaky?.[sig]?.nights.length ?? 0;

/** Known-issues file: `[{ "match": "substring of signature", "issue": 1234 }]`. */
export function knownIssueFor(known, signature) {
  return (known ?? []).find((k) => signature.includes(k.match))?.issue ?? null;
}

/** Dates between the last completed night and tonight that have no run. */
export function missedNights(nightsLog, date) {
  const done = (nightsLog ?? []).filter((n) => n.date < date).map((n) => n.date).sort();
  if (!done.length) return [];
  const missed = [];
  for (let d = addDays(done[done.length - 1], 1); d < date; d = addDays(d, 1)) missed.push(d);
  return [...missed, ...(nightsLog ?? []).filter((n) => n.date < date && n.status === "missed").map((n) => n.date)].filter((d, i, a) => a.indexOf(d) === i).sort();
}

export function renderReport({ date, night, plan, outcomes = [], results = [], upgrade, flaky, known, nightsLog, disk, productHistory = [], voice = null }) {
  const all = results.flatMap((r) => r.failures);
  const publicFails = all.filter((f) => !f.private);
  const privateFails = all.filter((f) => f.private);
  const nextFlaky = updateFlaky(flaky, date, all.map((f) => f.signature));
  const missed = missedNights(nightsLog, date);
  const product = results.flatMap((r) => r.product ?? []);
  const failedActions = outcomes.filter((o) => o.status === "failed");
  const blocked = publicFails.filter((f) => knownIssueFor(known, f.signature));
  const fresh = publicFails.filter((f) => !knownIssueFor(known, f.signature));
  const fileNow = fresh.filter((f) => nightCount(nextFlaky, f.signature) >= FILE_AT);
  const L = [];

  L.push(`# Team simulation — ${date}`, "");
  L.push(...summaryLines({ night, plan, outcomes, publicFails: fresh, privateFails, upgrade, missed }), "");
  if (missed.length) L.push(`**Missed nights:** ${missed.join(", ")}`, "");
  if (night?.shortened) L.push(`> Shortened run: ${night.shortened}`, "");

  L.push("## Oracles", "", "| Oracle | Result | Failures |", "|---|---|---|");
  for (const r of results) L.push(`| ${r.name} | ${r.status} | ${r.private || r.failures.some((f) => f.private) ? "see Private" : r.failures.length} |`);
  L.push("");

  L.push("## Failures", "");
  if (!fresh.length) L.push("None.", "");
  for (const r of results) {
    const mine = fresh.filter((f) => f.oracle === r.name);
    if (!mine.length) continue;
    L.push(`### ${r.name}`, "");
    for (const f of mine) L.push(...failureLines(f, date, nightCount(nextFlaky, f.signature)));
    L.push("");
  }
  if (fileNow.length) {
    L.push("## File now", "", "Seen on 3 or more nights. Replay first; file as a public Bug (label `team-sim`) only if it reproduces.", "");
    for (const f of fileNow) L.push(`- \`${f.signature}\` — ${nightCount(nextFlaky, f.signature)} nights`);
    L.push("");
  }
  if (blocked.length) {
    L.push("## Known issues", "");
    for (const f of blocked) L.push(`- blocked-by #${knownIssueFor(known, f.signature)}: \`${f.signature}\` (${f.count ?? 1}×)`);
    L.push("");
  }

  L.push("## Actions", "");
  L.push(...actionLines(plan, outcomes), "");
  if (failedActions.length) {
    L.push("### Failed actions", "");
    for (const o of failedActions.slice(0, 60)) L.push(`- #${o.n} ${o.persona} ${o.kind} (${o.layer}): ${oneLine(o.error)}${o.trace ? ` — trace \`${o.trace}\`` : ""}`);
    if (failedActions.length > 60) L.push(`- … ${failedActions.length - 60} more in the run's outcomes.jsonl`);
    L.push("");
  }

  L.push("## Private", "", "Visibility-class findings. Advisory process only (pre-beta: fix and close, never publish). Do not copy into GitHub.", "");
  if (!privateFails.length) L.push("None.", "");
  for (const f of privateFails) L.push(...failureLines(f, date, nightCount(nextFlaky, f.signature)));
  L.push("");
  if (voice) L.push(...voiceLines({ date, ...voice }));

  L.push("## Product", "", "Gap moments, friction and feature requests. For the product lead; triage never files these.", "");
  if (!product.length) L.push("None tonight.", "");
  for (const p of product) L.push(`- ${p.persona}: ${p.need} → ${p.workaround}`);
  L.push("");
  if (weekday(date) === 0) L.push(...weeklyDigest([...productHistory, ...product.map((p) => ({ ...p, date }))], date), "");

  const timing = results.find((r) => r.name === "timing");
  if (timing) L.push(...timingLines(timing), "");
  const coverage = results.find((r) => r.name === "coverage");
  if (coverage) L.push(...coverageLines(coverage), "");
  L.push("## Disk", "");
  L.push(disk ? `Volume used: ${gb(disk.usedBytes)} (${disk.deltaBytes >= 0 ? "+" : ""}${gb(disk.deltaBytes)} since the last night). Drive data in the registry: ${gb(disk.driveBytes)}.` : "Not measured.", "");
  L.push("## Night", "");
  if (night) L.push(`Commit ${night.sha?.slice(0, 10) ?? "?"}, world v${plan?.worldVersion ?? "?"}, action list ${plan?.hash?.slice(0, 12) ?? "?"}; ${night.startedAt} → ${night.endedAt ?? "?"}.`, "");
  return { markdown: `${L.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`, nextFlaky };
}

function summaryLines({ night, plan, outcomes, publicFails, privateFails, upgrade, missed }) {
  const ok = outcomes.filter((o) => o.status === "ok").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const what = upgrade && !upgrade.ok
    ? `The upgrade failed, so the team did nothing tonight; data and code are back on the previous night.`
    : `${plan?.present?.length ?? 0} people worked (${(plan?.ui ?? []).join(", ") || "nobody"} in the browser): ${ok} of ${outcomes.length} actions went through, ${failed} failed.`;
  const fails = publicFails.length || privateFails.length
    ? `${publicFails.length} new or repeating problems${privateFails.length ? `, plus ${privateFails.length} in the private section` : ""}.`
    : "No oracle found a problem.";
  const look = missed.length ? `${missed.length} earlier night(s) did not run.` : night?.incomplete ? "This night did not finish; treat results as partial." : "Nothing else needs attention.";
  return [`**What happened:** ${what}`, `**What failed:** ${fails}`, `**What else:** ${look}`];
}

function failureLines(f, date, nights) {
  const head = `- **${f.detail}**${f.count > 1 ? ` (${f.count}×)` : ""}${nights > 1 ? ` — ${nights} nights` : " — new"}`;
  const meta = [f.persona && `persona ${f.persona}`, f.action && `action #${f.action}`, f.trace && `trace \`${f.trace}\``].filter(Boolean).join(", ");
  const lines = [head];
  if (meta) lines.push(`  ${meta}`);
  if (f.action) lines.push(`  replay: \`sim replay ${date} --action ${f.action}\``);
  lines.push(`  signature: \`${f.signature}\``);
  return lines;
}

function actionLines(plan, outcomes) {
  if (!plan) return ["No plan."];
  const by = {};
  for (const o of outcomes) {
    const row = (by[o.persona] ??= { ok: 0, failed: 0, skipped: 0, apps: new Set(), layer: new Set() });
    row[o.status] = (row[o.status] ?? 0) + 1;
    if (o.app !== "none") row.apps.add(o.app);
    row.layer.add(o.layer);
  }
  const lines = ["| Persona | Layer | OK | Failed | Skipped | Apps |", "|---|---|---|---|---|---|"];
  for (const [p, r] of Object.entries(by)) lines.push(`| ${p} | ${[...r.layer].join("+")} | ${r.ok} | ${r.failed} | ${r.skipped} | ${[...r.apps].sort().join(", ")} |`);
  const absent = Object.entries(plan.absent ?? {}).map(([p, why]) => `${p} (${why})`);
  if (absent.length) lines.push("", `Away: ${absent.join(", ")}.`);
  return lines;
}

function weeklyDigest(items, date) {
  const since = addDays(date, -6);
  const counts = {};
  for (const p of items.filter((x) => x.date >= since)) counts[p.need] = (counts[p.need] ?? 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return ["### Weekly product digest", "", ...(ranked.length ? ranked.map(([need, n]) => `- ${n}× ${need}`) : ["Nothing this week."])];
}

function timingLines(t) {
  const kinds = Object.entries(t.metrics.kinds ?? {}).sort((a, b) => b[1].p95 - a[1].p95).slice(0, 15);
  const lines = ["## Timing", "", "Slowest request kinds tonight (p95). Jumps over the 7-night median are flagged, never failed.", "", "| Request | n | p50 ms | p95 ms |", "|---|---|---|---|"];
  for (const [k, v] of kinds) lines.push(`| \`${k}\` | ${v.n} | ${v.p50} | ${v.p95} |`);
  for (const f of t.flagged) lines.push("", `- flagged: ${f.detail}`);
  return lines;
}

function coverageLines(c) {
  const m = c.metrics;
  const lines = ["## Coverage", "", ...c.notes];
  if (m.missingRoutes?.length) lines.push("", `<details><summary>Contract routes not reached in 14 nights (${m.missingRoutes.length})</summary>`, "", ...m.missingRoutes.map((r) => `- \`${r}\``), "", "</details>");
  if (m.missingScreens?.length) lines.push("", `Screens not reached: ${m.missingScreens.map((s) => `\`${s}\``).join(", ")}`);
  if (m.unmatched?.length) lines.push("", `Requests outside the OpenAPI contract (${m.unmatched.length}): ${m.unmatched.slice(0, 25).map((s) => `\`${s}\``).join(", ")}${m.unmatched.length > 25 ? " …" : ""}`);
  return lines;
}

const gb = (b) => `${((b ?? 0) / 1024 ** 3).toFixed(2)} GB`;
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").slice(0, 220);
