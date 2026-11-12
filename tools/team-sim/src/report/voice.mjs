// Team voice: what the night cost the personas and what they would say about
// it. Pure markdown from measure.json, diary.json and digest.json. Private:
// product pains are never filed; only the product lead turns them into Goals.
import { rankGoals } from "../friction/measure.mjs";

const JUMP = 1.5;
const s = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`);
const pct = (x) => `${Math.round(x * 100)}%`;
const SOURCE = { detected: "seen tonight", "actor-workaround": "known workaround", "scripted-gap": "scripted gap" };

export function voiceLines({ date, measure, diary, digest }) {
  if (!measure) return [];
  const L = ["## Team voice — private (never filed)", "", "What the night cost each persona goal, the workarounds the personas needed, and their own words. For the product lead; triage never files these.", ""];

  L.push("### Goals by cost", "", `Median per goal chain tonight; trend against the 7-night median (needs 3 nights). Jumps over ${JUMP}× are flagged, never failed.`, "");
  L.push("| Goal | Chains | In trouble | Steps | Requests | Time | Waiting | Clicks+keys | 7-night time | Worst |", "|---|---|---|---|---|---|---|---|---|---|");
  const flagged = [];
  for (const [goal, g] of rankGoals(measure.goals)) {
    const t = measure.trend?.[goal];
    const jump = t?.wallMs && g.wallMs > t.wallMs * JUMP;
    if (jump) flagged.push(`${goal}: ${s(g.wallMs)} against a 7-night median of ${s(t.wallMs)}`);
    L.push(`| ${goal} | ${g.n} | ${pct(g.troubleRate)}${g.failures ? ` (${g.failures} failed)` : ""} | ${g.steps} | ${g.requests} | ${s(g.wallMs)} | ${s(g.waitMs)} | ${g.input ?? "–"} | ${t?.wallMs ? `${s(t.wallMs)}${jump ? " ⚑" : ""}` : `– (${t?.nights ?? 0} nights)`} | ${g.worst != null ? `#${g.worst}` : "–"} |`);
  }
  for (const f of flagged) L.push("", `- flagged: ${f}`);
  L.push("");

  L.push("### Friction", "", "Workarounds and missing pieces, observed first, then by how often. Evidence is the action numbers in tonight's run.", "");
  if (!measure.items.length) L.push("None tonight.");
  measure.items.forEach((it, i) => {
    const nights = measure.itemNights?.[it.what] ?? 1;
    L.push(`${i + 1}. **${it.what}** — ${it.count}× (${it.personas.join(", ")}), ${SOURCE[it.source] ?? it.source}${nights > 1 ? `, ${nights} of the last 8 nights` : ", first night"}`);
    if (it.workaround) L.push(`   workaround: ${it.workaround}`);
    L.push(`   evidence: ${it.actions.map((n) => `#${n}`).join(", ")}${it.goals.length ? ` (goal: ${it.goals.join(", ")}; ${s(it.costMs)} of goal time)` : ""}`);
  });
  L.push("");

  const screens = Object.entries(measure.screens ?? {}).sort((a, b) => b[1].p95 - a[1].p95);
  if (screens.length) {
    L.push("### Time to interactive", "", "Browser personas, from navigation to the screen's ready element.", "", "| Screen | n | p50 | p95 |", "|---|---|---|---|");
    for (const [screen, v] of screens) L.push(`| ${screen} | ${v.n} | ${s(v.p50)} | ${s(v.p95)} |`);
    L.push("");
  }

  L.push("### Diaries", "");
  if (!diary) L.push("Not written for this run.");
  else if (diary.skipped && !diary.diaries?.length) L.push(`> ${diary.skipped}`, "");
  for (const d of diary?.diaries ?? []) {
    const warn = d.check.invalid.length ? ` — ${d.check.invalid.length} citation(s) outside their own actions: ${d.check.invalid.map((n) => `#${n}`).join(", ")}` : "";
    L.push(`#### ${d.name}${warn}`, "", ...d.diary.split("\n").map((l) => `> ${l}`), "");
    for (const it of d.items) L.push(`- ${it.type}: ${it.text} (${it.actions.map((n) => `#${n}`).join(", ")})`);
    L.push("");
  }
  if (diary?.notes?.length) L.push(...diary.notes.map((n) => `- note: ${n}`), "");
  if (diary && diary.model && !diary.skipped) L.push(`Model ${diary.model}: ${diary.diaries.length} diaries, ${diary.tokens} tokens, $${diary.costUsd.toFixed(3)}, ${Math.round(diary.ms / 1000)} s.`, "");

  if (digest) L.push(...digestLines(digest), "");
  return L;
}

function digestLines(d) {
  const L = [`### Weekly digest (${d.nights[0] ?? d.date} → ${d.date}, ${d.nights.length} nights)`, ""];
  if (d.themes.length) {
    L.push("Themes from the diaries, ranked by how many persona-days raised them, then by the goal time behind them.", "");
    d.themes.forEach((t, i) => {
      L.push(`${i + 1}. **${t.title}** (${t.kind}) — ${t.frequency} persona-days (${t.personas.join(", ")}), ${s(t.costMs)} of goal time`);
      L.push(`   evidence: ${t.evidence.slice(0, 12).join(", ")}${t.evidence.length > 12 ? " …" : ""}`);
      for (const q of t.quotes) L.push(`   - ${q}`);
    });
    L.push("");
  } else if (d.skipped) L.push(`> ${d.skipped}`, "");
  L.push("Friction across the week, by persona-days hit, then goal time:", "");
  if (!d.friction.length) L.push("None this week.");
  d.friction.slice(0, 10).forEach((f, i) => L.push(`${i + 1}. ${f.what} — ${f.frequency} persona-days on ${f.nights} nights, ${s(f.costMs)}; evidence ${f.evidence.slice(0, 8).join(", ")}${f.evidence.length > 8 ? " …" : ""}`));
  if (d.costUsd) L.push("", `Digest model cost: $${d.costUsd.toFixed(3)}, ${d.tokens} tokens.`);
  return L;
}
