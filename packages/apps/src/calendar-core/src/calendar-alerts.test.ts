import { describe, expect, it } from "vitest";
import {
  alertActionFromWire,
  alertMapsEqual,
  alertsFromWire,
  alertsToWire,
  defaultEventAlert,
  formatCustomOffset,
  freeBusyStatusFromWire,
  matchAlertOffsetPreset,
  parseCustomOffset,
} from "@/calendar-core/src/calendar-alerts";

describe("freeBusyStatusFromWire", () => {
  it("defaults missing and leftover tentative values to busy", () => {
    expect(freeBusyStatusFromWire(undefined)).toBe("busy");
    expect(freeBusyStatusFromWire("free")).toBe("free");
    expect(freeBusyStatusFromWire("busy")).toBe("busy");
    // Non-RFC leftover on the wire — Show as is only busy | free.
    expect(freeBusyStatusFromWire("tentative")).toBe("busy");
  });
});

describe("alertActionFromWire", () => {
  it("maps missing, email, and leftover audio values to display", () => {
    expect(alertActionFromWire(undefined)).toBe("display");
    expect(alertActionFromWire("email")).toBe("display");
    expect(alertActionFromWire("display")).toBe("display");
    expect(alertActionFromWire("audio")).toBe("display");
  });
});

describe("alert offset presets", () => {
  it("matches common relative offsets", () => {
    expect(matchAlertOffsetPreset("PT0S")).toBe("at-start");
    expect(matchAlertOffsetPreset("-PT0S")).toBe("at-start");
    expect(matchAlertOffsetPreset("-PT15M")).toBe("15m");
    expect(matchAlertOffsetPreset("-PT1H")).toBe("1h");
    expect(matchAlertOffsetPreset("-P1D")).toBe("1d");
    expect(matchAlertOffsetPreset("-PT45M")).toBe("custom");
  });

  it("parses and formats custom before-offsets", () => {
    expect(parseCustomOffset("-PT45M")).toEqual({ amount: 45, unit: "minutes" });
    expect(parseCustomOffset("-PT2H")).toEqual({ amount: 2, unit: "hours" });
    expect(parseCustomOffset("-P3D")).toEqual({ amount: 3, unit: "days" });
    expect(formatCustomOffset(45, "minutes")).toBe("-PT45M");
    expect(formatCustomOffset(2, "hours")).toBe("-PT2H");
  });
});

describe("alerts wire round-trip", () => {
  it("maps leftover audio and email actions to display and treats them equal to display", () => {
    const rows = alertsFromWire({
      alert1: {
        "@type": "Alert",
        action: "audio",
        trigger: { "@type": "RelativeAlert", offset: "-PT15M" },
      },
      alert2: {
        "@type": "Alert",
        action: "email",
        trigger: { "@type": "RelativeAlert", offset: "-PT30M" },
      },
    });
    expect(rows).toEqual([
      { id: "alert1", action: "display", offset: "-PT15M" },
      { id: "alert2", action: "display", offset: "-PT30M" },
    ]);
    expect(
      alertMapsEqual(
        {
          alert1: {
            "@type": "Alert",
            action: "display",
            trigger: { "@type": "RelativeAlert", offset: "-PT15M" },
          },
        },
        {
          alert1: {
            "@type": "Alert",
            action: "audio",
            trigger: { "@type": "RelativeAlert", offset: "-PT15M" },
          },
        },
      ),
    ).toBe(true);
    expect(
      alertMapsEqual(
        {
          alert2: {
            "@type": "Alert",
            action: "display",
            trigger: { "@type": "RelativeAlert", offset: "-PT30M" },
          },
        },
        {
          alert2: {
            "@type": "Alert",
            action: "email",
            trigger: { "@type": "RelativeAlert", offset: "-PT30M" },
          },
        },
      ),
    ).toBe(true);
  });

  it("reads OpenAPI RelativeAlert and RFC OffsetTrigger", () => {
    const rows = alertsFromWire({
      alert1: {
        "@type": "Alert",
        action: "display",
        trigger: { "@type": "RelativeAlert", offset: "-PT15M" },
      },
      a2: {
        "@type": "Alert",
        action: "email",
        trigger: { "@type": "OffsetTrigger", offset: "-PT1H", relativeTo: "end" },
      },
    });
    expect(rows).toEqual([
      { id: "alert1", action: "display", offset: "-PT15M" },
      { id: "a2", action: "display", offset: "-PT1H", relatedTo: "end" },
    ]);
  });

  it("emits RelativeAlert / AbsoluteAlert as display and treats empty as none", () => {
    expect(alertsToWire([])).toBeNull();
    expect(
      alertsToWire([
        { id: "alert1", action: "display", offset: "-PT15M" },
        { id: "alert2", action: "display", offset: null, when: "2033-01-12T09:00:00" },
      ]),
    ).toEqual({
      alert1: {
        "@type": "Alert",
        action: "display",
        trigger: { "@type": "RelativeAlert", offset: "-PT15M" },
      },
      alert2: {
        "@type": "Alert",
        action: "display",
        trigger: { "@type": "AbsoluteAlert", when: "2033-01-12T09:00:00" },
      },
    });
  });

  it("compares maps ignoring OffsetTrigger vs RelativeAlert spelling", () => {
    expect(
      alertMapsEqual(
        {
          alert1: {
            "@type": "Alert",
            action: "display",
            trigger: { "@type": "OffsetTrigger", offset: "-PT15M" },
          },
        },
        {
          alert1: {
            "@type": "Alert",
            action: "display",
            trigger: { "@type": "RelativeAlert", offset: "-PT15M" },
          },
        },
      ),
    ).toBe(true);
  });

  it("allocates the next alertN id", () => {
    expect(defaultEventAlert([]).id).toBe("alert1");
    expect(defaultEventAlert([{ id: "alert1", action: "display", offset: "-PT15M" }]).id).toBe(
      "alert2",
    );
  });
});
