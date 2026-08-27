import { describe, expect, it } from "vitest";
import {
  alertActionFromWire,
  alertMapsEqual,
  alertsFromWire,
  alertsToWire,
  alertsAfterOffsetChange,
  defaultEventAlert,
  formatAlertOffsetQuantity,
  formatUnmatchedAlertOffset,
  freeBusyStatusFromWire,
  matchAlertOffsetPreset,
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
    expect(matchAlertOffsetPreset("-PT45M")).toBeNull();
  });

  it("labels unmatched leftover offsets without coercing them", () => {
    expect(formatUnmatchedAlertOffset("-PT45M")).toBe("45 minutes before");
    expect(formatUnmatchedAlertOffset("-PT2H")).toBe("2 hours before");
    expect(formatUnmatchedAlertOffset("-P3D")).toBe("3 days before");
    expect(formatUnmatchedAlertOffset("not-a-duration")).toBe("not-a-duration");
  });

  it("formats compact duration quantities for reminder tooltips", () => {
    expect(formatAlertOffsetQuantity("-PT5M", "mins")).toBe("5 mins");
    expect(formatAlertOffsetQuantity("-PT1M", "mins")).toBe("1 min");
    expect(formatAlertOffsetQuantity("-PT1H", "mins")).toBe("1 hour");
    expect(formatAlertOffsetQuantity("-P1D", "mins")).toBe("1 day");
    expect(formatAlertOffsetQuantity("PT0S", "mins")).toBeNull();
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

describe("alertsAfterOffsetChange", () => {
  const existing = [{ id: "alert1", action: "display" as const, offset: "-PT15M" }];

  it("appends a real alert from the trailing None slot", () => {
    expect(alertsAfterOffsetChange({ alerts: [], rowId: null, value: "15m" })).toEqual([
      { id: "alert1", action: "display", offset: "-PT15M" },
    ]);
  });

  it("removes a set row when choosing None and does not store extra Nones", () => {
    expect(alertsAfterOffsetChange({ alerts: existing, rowId: "alert1", value: "none" })).toEqual(
      [],
    );
    expect(alertsAfterOffsetChange({ alerts: existing, rowId: null, value: "none" })).toEqual(
      existing,
    );
  });

  it("updates an existing row offset", () => {
    expect(alertsAfterOffsetChange({ alerts: existing, rowId: "alert1", value: "1h" })).toEqual([
      { id: "alert1", action: "display", offset: "-PT1H" },
    ]);
  });

  it("applies defaultRelatedTo end on new rows without changing calendar start defaults", () => {
    expect(alertsAfterOffsetChange({ alerts: [], rowId: null, value: "15m" })).toEqual([
      { id: "alert1", action: "display", offset: "-PT15M" },
    ]);
    expect(
      alertsAfterOffsetChange({
        alerts: [],
        rowId: null,
        value: "15m",
        defaultRelatedTo: "end",
      }),
    ).toEqual([{ id: "alert1", action: "display", offset: "-PT15M", relatedTo: "end" }]);
    expect(
      alertsAfterOffsetChange({
        alerts: [{ id: "alert1", action: "display", offset: "-PT15M", relatedTo: "start" }],
        rowId: "alert1",
        value: "1h",
        defaultRelatedTo: "end",
      }),
    ).toEqual([{ id: "alert1", action: "display", offset: "-PT1H", relatedTo: "start" }]);
  });

  it("clears an unmatched leftover offset when choosing None", () => {
    const leftover = [{ id: "alert1", action: "display" as const, offset: "-PT45M" }];
    expect(alertsAfterOffsetChange({ alerts: leftover, rowId: "alert1", value: "none" })).toEqual(
      [],
    );
  });
});
