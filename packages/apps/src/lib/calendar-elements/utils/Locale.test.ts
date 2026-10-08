import { describe, expect, it } from "vitest";
import { getLocaleDirection, getLocaleWeekInfo, resolveLocale } from "./Locale.js";

describe("resolveLocale", () => {
  it("keeps an explicit locale", () => {
    expect(resolveLocale("nl-NL")).toBe("nl-NL");
  });

  it("falls back to en-US when nothing usable is given", () => {
    expect(resolveLocale(undefined)).toBe("en-US");
    expect(resolveLocale(null)).toBe("en-US");
    expect(resolveLocale("   ")).toBe("en-US");
  });
});

describe("getLocaleWeekInfo", () => {
  it("reports the first day and weekend for a known locale", () => {
    expect(getLocaleWeekInfo("nl-NL")).toEqual({ firstDay: 1, weekend: [6, 7] });
  });

  it("reports a Sunday-first locale", () => {
    expect(getLocaleWeekInfo("en-US").firstDay).toBe(7);
  });

  it("returns an empty weekend when the locale cannot be read", () => {
    expect(getLocaleWeekInfo("not a locale")).toEqual({ weekend: [] });
  });
});

describe("getLocaleDirection", () => {
  it("reports right-to-left scripts", () => {
    expect(getLocaleDirection("ar-EG")).toBe("rtl");
    expect(getLocaleDirection("he-IL")).toBe("rtl");
  });

  it("reports left-to-right scripts", () => {
    expect(getLocaleDirection("en-US")).toBe("ltr");
  });

  it("falls back to left-to-right when the locale cannot be read", () => {
    expect(getLocaleDirection("not a locale")).toBe("ltr");
  });
});
