import type { BrowserContext } from "@playwright/test";

export type RtcTestOverrides = { debug: boolean; forceRelay: boolean };

/** Applies to every later navigation in the context. The last call wins. */
export async function setRtcTestOverrides(
  context: BrowserContext,
  overrides: RtcTestOverrides,
): Promise<void> {
  await context.addInitScript((value) => {
    (window as Window & { __WGW_RTC_TEST_OVERRIDES__?: unknown }).__WGW_RTC_TEST_OVERRIDES__ =
      value;
  }, overrides);
}
