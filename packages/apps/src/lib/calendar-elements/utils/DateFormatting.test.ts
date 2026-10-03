import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { formatDateRangeShort } from "./DateFormatting.js";

describe("formatDateRangeShort", () => {
  it("joins both ends with short month and numeric day", () => {
    expect(
      formatDateRangeShort(
        "en-US",
        Temporal.PlainDate.from("2033-01-10"),
        Temporal.PlainDate.from("2033-01-16"),
      ),
    ).toBe("Jan 10 - Jan 16");
  });

  it("formats each end in the requested locale", () => {
    expect(
      formatDateRangeShort(
        "nl-NL",
        Temporal.PlainDate.from("2033-03-01"),
        Temporal.PlainDate.from("2033-03-07"),
      ),
    ).toBe("1 mrt - 7 mrt");
  });

  it("passes an undefined locale straight through to the formatter", () => {
    const calls: Array<string | undefined> = [];
    const stub = {
      toLocaleString(locale: string | undefined) {
        calls.push(locale);
        return "x";
      },
    };
    expect(formatDateRangeShort(undefined, stub, stub)).toBe("x - x");
    expect(calls).toEqual([undefined, undefined]);
  });
});
