/**
 * Shape every oracle returns. `failures[].private` routes a failure to the
 * report's Private section (visibility class); `product` items go to the
 * Product section; `notes` are plain lines for the oracle's own section.
 */
export function oracleResult(name, { failures = [], flagged = [], product = [], notes = [], metrics = {}, unchecked = false, privateClass = false } = {}) {
  const status = unchecked ? "unchecked" : failures.length ? "fail" : flagged.length ? "flag" : "pass";
  return {
    name,
    status,
    failures: failures.map((f) => ({ ...f, oracle: name, private: privateClass || !!f.private, signature: f.signature ?? `${name}:${f.detail}` })),
    flagged,
    product,
    notes,
    metrics,
  };
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export const median = (values) => percentile(values, 50);
