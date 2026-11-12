import { oracleResult } from "./result.mjs";

/** Gap moments from the plan: listed for the product lead, never failed. */
export function gapOracle({ actions }) {
  const product = actions
    .filter((a) => a.kind === "gap")
    .map((a) => ({ kind: "gap", persona: a.persona, action: a.n, need: a.params.need, workaround: a.params.workaround }));
  return oracleResult("gap", { product });
}
