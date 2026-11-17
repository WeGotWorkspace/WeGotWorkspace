import { median, oracleResult, percentile } from "./result.mjs";

/**
 * p50/p95 per request kind. A p95 above 1.5× the 7-night median of p95
 * (and at least 150 ms more) is flagged, never failed. `history` is
 * `{ nights: [{ date, kinds: { [kind]: { p50, p95, n } } }] }` from the data dir.
 */
export function timingOracle({ requests, requestKind, history, date }) {
  const byKind = {};
  for (const r of requests) {
    if (!r.status || r.ms == null || r.layer === "oracle") continue;
    (byKind[requestKind(r.method, r.path)] ??= []).push(r.ms);
  }
  const kinds = {};
  for (const [kind, ms] of Object.entries(byKind)) kinds[kind] = { p50: percentile(ms, 50), p95: percentile(ms, 95), n: ms.length };
  const prior = (history?.nights ?? []).filter((n) => n.date < date).slice(-7);
  const flagged = [];
  for (const [kind, now] of Object.entries(kinds)) {
    const past = prior.map((n) => n.kinds[kind]?.p95).filter((v) => v != null);
    if (past.length < 3) continue;
    const base = median(past);
    if (now.p95 > base * 1.5 && now.p95 - base >= 150) flagged.push({ kind, p95: now.p95, median7: base, detail: `${kind}: p95 ${now.p95} ms vs 7-night median ${base} ms` });
  }
  const nextHistory = { nights: [...(history?.nights ?? []).filter((n) => n.date !== date), { date, kinds }].slice(-30) };
  return { ...oracleResult("timing", { flagged, metrics: { kinds } }), nextHistory };
}
