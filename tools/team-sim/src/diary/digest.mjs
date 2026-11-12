// Sunday digest: the week's frustrations and opportunities, ranked by how
// often they came up and what they cost, each with its evidence (date and
// action number). The model only groups diary items into themes; counting
// and ranking are done here, so the order never depends on the model.
import { addDays } from "../planner/dates.mjs";

export const DIGEST_BUDGET_USD = 0.1;

export const DIGEST_SYSTEM = [
  "You group diary items written by fictional team members of a small design studio into themes for the product lead of their workspace suite.",
  "Each item has an id. Put items that describe the same underlying need, pain or opportunity in one theme; an item belongs to at most one theme; leave out items that fit no theme.",
  "Theme titles are short and concrete (at most 12 words) and name the need, not a feature you invent. kind is frustration (something gets in the way) or opportunity (something the suite could do).",
  'Return only JSON: {"themes": [{"title": string, "kind": "frustration" | "opportunity", "items": [ids]}]}.',
].join("\n");

/** The week's evidence: diary items and friction items from the nights in [date-6, date]. */
export function weekEvidence(nights, date) {
  const since = addDays(date, -6);
  const week = nights.filter((n) => n.date >= since && n.date <= date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const diaryItems = [];
  for (const n of week) {
    for (const d of n.diary?.diaries ?? []) {
      for (const it of d.items) {
        if (it.type === "went-well") continue;
        diaryItems.push({ id: diaryItems.length + 1, date: n.date, persona: d.persona, type: it.type, text: it.text, actions: it.actions });
      }
    }
  }
  return { week, diaryItems };
}

/** Cost of an action on a night: the wall time of the goal chain it sat in. */
function costOf(night, n) {
  const chain = (night.measure?.chains ?? []).find((c) => c.actions.includes(n));
  return chain ? (chain.wallMs ?? 0) + (chain.waitMs ?? 0) : 0;
}

/** Friction items across the week, by nights and personas hit, then cost. Deterministic. */
export function rankWeekFriction(week) {
  const by = new Map();
  for (const night of week) {
    for (const it of night.measure?.items ?? []) {
      const row = by.get(it.what) ?? by.set(it.what, { what: it.what, source: it.source, workaround: it.workaround, hits: new Set(), nights: new Set(), costMs: 0, evidence: [] }).get(it.what);
      for (const p of it.personas) row.hits.add(`${night.date}/${p}`);
      row.nights.add(night.date);
      row.costMs += it.costMs ?? 0;
      row.evidence.push(...it.actions.map((n) => `${night.date} #${n}`));
    }
  }
  return [...by.values()]
    .map((r) => ({ what: r.what, source: r.source, workaround: r.workaround, frequency: r.hits.size, nights: r.nights.size, costMs: r.costMs, evidence: r.evidence }))
    .sort((a, b) => Number(a.source === "scripted-gap") - Number(b.source === "scripted-gap") || b.frequency - a.frequency || b.costMs - a.costMs || (a.what < b.what ? -1 : 1));
}

/** Themes from the model, counted and ranked here: frequency = distinct date+persona, cost = goal time behind the cited actions. */
export function rankThemes(themes, diaryItems, week) {
  const items = new Map(diaryItems.map((i) => [i.id, i]));
  const nightOf = new Map(week.map((n) => [n.date, n]));
  const used = new Set();
  const ranked = [];
  for (const t of Array.isArray(themes) ? themes : []) {
    const mine = (t.items ?? []).map(Number).filter((id) => items.has(id) && !used.has(id)).map((id) => items.get(id));
    if (!mine.length || typeof t.title !== "string") continue;
    for (const i of mine) used.add(i.id);
    const evidence = [...new Set(mine.flatMap((i) => i.actions.map((n) => `${i.date} #${n}`)))];
    const costMs = [...new Set(mine.flatMap((i) => i.actions.map((n) => `${i.date}|${n}`)))].reduce((s, k) => {
      const [d, n] = k.split("|");
      return s + costOf(nightOf.get(d), Number(n));
    }, 0);
    ranked.push({
      title: t.title.slice(0, 120),
      kind: t.kind === "opportunity" ? "opportunity" : "frustration",
      frequency: new Set(mine.map((i) => `${i.date}/${i.persona}`)).size,
      personas: [...new Set(mine.map((i) => i.persona))].sort(),
      costMs,
      evidence,
      quotes: mine.slice(0, 3).map((i) => `${i.persona}, ${i.date}: “${i.text}”`),
    });
  }
  return ranked.sort((a, b) => b.frequency - a.frequency || b.costMs - a.costMs || (a.title < b.title ? -1 : 1));
}

/**
 * The digest for the week ending `date`. `nights`: [{ date, measure, diary }].
 * Without a runner (or without diary items) it still ranks the friction.
 */
export async function weeklyDigest({ nights, date, runner, budgetUsd = DIGEST_BUDGET_USD }) {
  const { week, diaryItems } = weekEvidence(nights, date);
  const digest = { date, nights: week.map((n) => n.date), friction: rankWeekFriction(week), themes: [], skipped: null, costUsd: 0, tokens: 0 };
  const missing = !diaryItems.length ? "no diary items this week" : runner ? runner.available() : "no runner configured";
  if (missing) {
    digest.skipped = `Themes skipped: ${missing}.`;
    return digest;
  }
  const list = diaryItems.map((i) => `${i.id}. [${i.type}] ${i.persona}: ${i.text}`).join("\n");
  try {
    const reply = await runner.run({ system: DIGEST_SYSTEM, content: [{ type: "text", text: `Diary items, week ending ${date}:\n${list}` }], budgetUsd });
    digest.costUsd = reply.costUsd;
    digest.tokens = reply.tokens;
    const text = reply.text;
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    digest.themes = rankThemes(parsed.themes, diaryItems, week);
  } catch (e) {
    digest.costUsd += e.costUsd ?? 0;
    digest.skipped = `Themes skipped: ${e.message.split("\n")[0]}`;
  }
  return digest;
}
