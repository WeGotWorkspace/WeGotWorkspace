// Sheets spike 5 only: the live config, matching just the spike spec. Local
// WebRTC between two contexts needs raw host candidates, as the chaos suite does.
import live from "./playwright.live.config.mjs";

export default {
  ...live,
  // WGW_SPIKE_MATCH runs another spec with the same set-up (the Docs control run).
  testMatch: [process.env.WGW_SPIKE_MATCH ?? "sheets-spike-collab.spec.ts"],
  retries: 0,
  use: {
    ...live.use,
    launchOptions: {
      args: [
        ...(live.use.launchOptions?.args ?? []),
        "--disable-features=WebRtcHideLocalIpsWithMdns",
      ],
    },
  },
};
