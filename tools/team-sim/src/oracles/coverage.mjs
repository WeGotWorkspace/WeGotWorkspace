import { addDays } from "../planner/dates.mjs";
import { oracleResult } from "./result.mjs";

const HORIZON = 14;

/**
 * Records which API routes (method + OpenAPI template) and app screens
 * (client route paths) were reached tonight in a cumulative coverage map,
 * and lists what was not reached in the last 14 nights. Never fails.
 */
export function coverageOracle({ requests, screensVisited, templates, screens, coverage, date }) {
  const next = { routes: { ...(coverage?.routes ?? {}) }, screens: { ...(coverage?.screens ?? {}) }, unmatched: {} };
  for (const r of requests) {
    const hit = templates.find((t) => t.method === r.method && t.re.test(r.path));
    if (hit) next.routes[hit.key] = date;
    else if (r.path.startsWith("/api/v1/")) next.unmatched[`${r.method} ${r.path.replace(/\/[0-9a-f-]{8,}|\/\d+/gi, "/:id")}`] = date;
  }
  for (const s of screensVisited) next.screens[s] = date;
  const cutoff = addDays(date, -HORIZON + 1);
  const missingRoutes = templates.map((t) => t.key).filter((k) => !(next.routes[k] >= cutoff)).sort();
  const missingScreens = screens.filter((s) => !(next.screens[s] >= cutoff)).sort();
  const reachedTonight = new Set(requests.map((r) => templates.find((t) => t.method === r.method && t.re.test(r.path))?.key).filter(Boolean));
  return {
    ...oracleResult("coverage", {
      notes: [
        `${reachedTonight.size} of ${templates.length} contract routes reached tonight; ${missingRoutes.length} not reached in ${HORIZON} nights.`,
        `${screens.length - missingScreens.length} of ${screens.length} screens reached in ${HORIZON} nights.`,
      ],
      metrics: { missingRoutes, missingScreens, unmatched: Object.keys(next.unmatched).sort(), reachedTonight: reachedTonight.size, contractRoutes: templates.length },
    }),
    nextCoverage: next,
  };
}
