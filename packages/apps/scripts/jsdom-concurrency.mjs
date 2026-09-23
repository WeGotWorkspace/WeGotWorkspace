/**
 * How many jsdom Vitest processes may run at once.
 *
 * GitHub-hosted ubuntu-latest is 4 vCPU and 16 GB. Packed shards budget about
 * 4 GB each and leave one core free. Solo RTL files are heap outliers, so they
 * stay on a lower cap. Outside CI the pool stays at 1 unless overridden.
 */

/**
 * @param {string | undefined} raw
 * @param {string} name
 * @returns {number | undefined}
 */
function parsePositive(raw, name) {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  return n;
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function isCiEnv(value) {
  return value === "true" || value === "1";
}

/**
 * @param {{
 *   ci: boolean,
 *   cpus: number,
 *   totalMemBytes: number,
 *   packedOverride?: string,
 *   soloOverride?: string,
 * }} input
 * @returns {{ packed: number, solo: number }}
 */
export function jsdomConcurrency(input) {
  const packedOverride = parsePositive(input.packedOverride, "JSDOM_CONCURRENCY");
  const soloOverride = parsePositive(input.soloOverride, "JSDOM_SOLO_CONCURRENCY");
  if (!input.ci) {
    return {
      packed: packedOverride ?? 1,
      solo: soloOverride ?? 1,
    };
  }

  const memGb = input.totalMemBytes / 1024 ** 3;
  const byCpu = Math.max(1, input.cpus - 1);
  const byMem = Math.max(1, Math.floor(memGb / 4));
  const soloBudget = memGb >= 14 && input.cpus >= 4 ? 2 : 1;

  return {
    packed: packedOverride ?? Math.min(byCpu, byMem, 4),
    solo: soloOverride ?? soloBudget,
  };
}
