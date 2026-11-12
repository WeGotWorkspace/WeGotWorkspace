import { oracleResult } from "./result.mjs";

/**
 * No 5xx response and no uncaught console error during the night.
 * Network errors (status 0) during the action window count as failures too.
 */
export function errorsOracle({ requests, browserEvents = [], requestKind }) {
  const failures = [];
  for (const r of requests) {
    if (r.status >= 500 || (r.status === 0 && r.error)) {
      const kind = requestKind(r.method, r.path);
      failures.push({
        signature: `errors:${kind}:${r.status}`,
        persona: r.persona,
        action: r.action,
        detail: `${r.method} ${r.path} → ${r.status || r.error}${r.body ? ` (${r.body.replace(/\s+/g, " ").slice(0, 160)})` : ""}`,
      });
    }
  }
  const resourceErrors = {};
  for (const e of browserEvents) {
    // The browser's "Failed to load resource … 4xx" lines repeat responses the request log already has.
    const status = /status of (4\d\d)/.exec(e.text ?? "")?.[1];
    if (e.type === "console" && status) {
      resourceErrors[status] = (resourceErrors[status] ?? 0) + 1;
      continue;
    }
    // The harness takes a browser offline on purpose (offline flag); the browser logs each failed load.
    if (e.type === "console" && /ERR_INTERNET_DISCONNECTED/.test(e.text ?? "")) continue;
    if (e.type === "pageerror" || (e.type === "console" && e.level === "error")) {
      failures.push({
        signature: `errors:console:${(e.text ?? "").replace(/\d+/g, "N").slice(0, 80)}`,
        persona: e.persona,
        action: e.action,
        detail: `${e.type === "pageerror" ? "uncaught" : "console.error"} on ${e.route ?? "?"}: ${(e.text ?? "").slice(0, 200)}`,
        trace: e.trace,
      });
    }
  }
  const fourxx = requests.filter((r) => r.status >= 400 && r.status < 500 && r.layer !== "oracle");
  const by4 = {};
  for (const r of fourxx) {
    const k = `${requestKind(r.method, r.path)} → ${r.status}`;
    by4[k] = (by4[k] ?? 0) + 1;
  }
  const notes = Object.entries(by4).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `4xx (not failed): ${k} ×${n}`);
  return oracleResult("errors", { failures: dedupe(failures), notes, metrics: { requests: requests.length, browserEvents: browserEvents.length, resourceErrors } });
}

/** One failure per signature, with a count, so one broken route does not flood the report. */
export function dedupe(failures) {
  const by = new Map();
  for (const f of failures) {
    const seen = by.get(f.signature);
    if (seen) seen.count += 1;
    else by.set(f.signature, { ...f, count: 1 });
  }
  return [...by.values()];
}
