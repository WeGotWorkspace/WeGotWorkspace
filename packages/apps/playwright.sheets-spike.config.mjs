// Sheets spike 5 only: the live config, matching just the spike spec.
import live from "./playwright.live.config.mjs";

export default { ...live, testMatch: ["sheets-spike-collab.spec.ts"], retries: 0 };
