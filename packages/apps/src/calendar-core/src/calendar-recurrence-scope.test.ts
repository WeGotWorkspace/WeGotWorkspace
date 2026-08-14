import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { expandEvents } from "@/lib/calendar-engine";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import {
  eventIsRecurringSeries,
  exclusionRecurrenceOverrides,
  forkSeriesDraftFromForm,
  forkSeriesDraftWithSplitOverrides,
  formAnchoredToOccurrence,
  occurrenceRecurrenceOverrides,
  resolveRecurrenceMasterRef,
  resolveSeriesRecurrenceOverrides,
  seriesRecurrenceRulesForSplit,
  shiftRecurrenceOverrides,
  splitOccurrenceKey,
  splitRecurrenceOverridesAt,
  toLocalRecurrenceId,
  truncateMasterSeriesPatch,
  truncateRecurrenceRules,
  untilBeforeRecurrenceId,
} from "@/calendar-core/src/calendar-recurrence-scope";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";

const appsSrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Recursively collect `.ts`/`.tsx`/`.js`/`.mjs` under `dir` (skips node_modules). */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("calendar-recurrence-scope", () => {
  it("apps sources have no native recurring-edit confirm string", () => {
    const forbidden = [
      "Edit only this instance of the recurring event",
      "Delete only this instance of the recurring event",
      "OK = only this instance",
      'window.confirm("Are you sure you want to delete this event?")',
    ] as const;
    const hits: string[] = [];
    for (const file of listSourceFiles(appsSrcRoot)) {
      // This test intentionally names the forbidden strings — skip self.
      if (file.endsWith(`${path.sep}calendar-recurrence-scope.test.ts`)) continue;
      const text = readFileSync(file, "utf8");
      for (const needle of forbidden) {
        if (text.includes(needle)) {
          hits.push(`${path.relative(appsSrcRoot, file)}: ${needle}`);
        }
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("splits occurrence keys", () => {
    expect(splitOccurrenceKey("master")).toEqual({ masterId: "master" });
    expect(splitOccurrenceKey("master::2026-01-01T10:00:00")).toEqual({
      masterId: "master",
      recurrenceId: "2026-01-01T10:00:00",
    });
    expect(splitOccurrenceKey("master::20260311T090000")).toEqual({
      masterId: "master",
      recurrenceId: "20260311T090000",
    });
  });

  it("resolves recurrence master by JMAP id or JSCalendar uid", () => {
    const wire = {
      id: "standup",
      uid: "urn:uuid:mock-standup",
      "@type": "Event",
      title: "Team standup",
      start: "2033-01-10T09:30:00",
      duration: "PT30M",
      calendarIds: { work: true },
      recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "weekly" }],
    } as JmapCalendarEvent;
    const surface = new Map([
      [
        "standup",
        {
          eventId: "urn:uuid:mock-standup",
          calendarId: "work",
          isRecurring: true,
          data: {
            start: Temporal.PlainDateTime.from("2033-01-10T09:30:00"),
            duration: Temporal.Duration.from("PT30M"),
            summary: "Team standup",
            recurrenceRule: { freq: "WEEKLY" as const },
          },
        },
      ],
    ]);

    expect(resolveRecurrenceMasterRef("standup", [wire], surface).masterKey).toBe("standup");
    expect(resolveRecurrenceMasterRef("urn:uuid:mock-standup", [wire], surface)).toEqual(
      expect.objectContaining({
        masterKey: "standup",
        original: wire,
      }),
    );
  });

  it("Lit this-and-future drag/delete passes engine master key not envelope uid", () => {
    const viewBase = readFileSync(
      path.join(appsSrcRoot, "lib/calendar-elements/CalendarViewBase/CalendarViewBase.ts"),
      "utf8",
    );
    expect(viewBase).toContain("seriesMasterKey");
    expect(viewBase).toContain("masterId: seriesMasterKey");
    expect(viewBase).not.toMatch(
      /recurrence-future-update[\s\S]*masterId:\s*detail\.envelope\.eventId/,
    );
    expect(viewBase).not.toMatch(
      /recurrence-future-delete[\s\S]*masterId:\s*detail\.envelope\.eventId/,
    );
  });

  it("detects recurring series from wire rules", () => {
    expect(eventIsRecurringSeries({ recurrenceRules: undefined })).toBe(false);
    expect(
      eventIsRecurringSeries({
        recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "weekly" }],
      }),
    ).toBe(true);
  });

  it("normalizes compact engine recurrence ids to LocalDateTime", () => {
    expect(toLocalRecurrenceId("20260311T090000", false)).toBe("2026-03-11T09:00:00");
    expect(toLocalRecurrenceId("20260311", true)).toBe("2026-03-11");
    expect(toLocalRecurrenceId("2026-03-11T09:00:00", false)).toBe("2026-03-11T09:00:00");
  });

  it("computes until before a timed recurrence id", () => {
    expect(untilBeforeRecurrenceId("2033-01-12T10:00:00", false)).toBe("2033-01-12T09:59:59");
    expect(untilBeforeRecurrenceId("20330112T100000", false)).toBe("2033-01-12T09:59:59");
  });

  it("computes until before an all-day recurrence id", () => {
    expect(untilBeforeRecurrenceId("2033-01-12", true)).toBe("2033-01-11");
    expect(untilBeforeRecurrenceId("20330112", true)).toBe("2033-01-11");
  });

  it("truncates recurrence rules with until and drops count", () => {
    expect(
      truncateRecurrenceRules(
        [{ "@type": "RecurrenceRule", frequency: "weekly", count: 10 }],
        "2033-01-11",
      ),
    ).toEqual([{ "@type": "RecurrenceRule", frequency: "weekly", until: "2033-01-11" }]);
  });

  it("resolves series rules from the form when wire original is missing", () => {
    const form: CalendarEventFormValue = {
      ...emptyCalendarEventForm("work", "2033-01-12", "09:30"),
      title: "Standup from here",
      recurrencePreset: "weekly",
    };
    expect(seriesRecurrenceRulesForSplit(undefined, form)).toEqual([
      expect.objectContaining({
        frequency: "weekly",
        byDay: [{ "@type": "NDay", day: "we" }],
      }),
    ]);
    expect(
      seriesRecurrenceRulesForSplit(
        {
          recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", interval: 2 }],
        },
        form,
      ),
    ).toEqual([{ "@type": "RecurrenceRule", frequency: "daily", interval: 2 }]);
  });

  it("forks a series from the form preset when originalRules are missing", () => {
    const form: CalendarEventFormValue = {
      ...emptyCalendarEventForm("work", "2033-01-12", "09:30"),
      title: "Standup from here",
      recurrencePreset: "weekly",
    };
    expect(forkSeriesDraftFromForm(form, undefined)).toEqual(
      expect.objectContaining({
        title: "Standup from here",
        start: "2033-01-12T09:30:00",
        recurrenceRules: [
          expect.objectContaining({
            frequency: "weekly",
            byDay: [{ "@type": "NDay", day: "we" }],
          }),
        ],
      }),
    );
  });

  it("anchors form wall times to the edited occurrence while keeping duration", () => {
    const form: CalendarEventFormValue = {
      ...emptyCalendarEventForm("work", "2033-01-10", "09:30"),
      title: "Team standup",
      endDate: "2033-01-10",
      endTime: "10:00",
      recurrencePreset: "weekly",
    };
    expect(formAnchoredToOccurrence(form, "2033-01-17T09:30:00")).toEqual(
      expect.objectContaining({
        startDate: "2033-01-17",
        startTime: "09:30",
        endDate: "2033-01-17",
        endTime: "10:00",
        recurrencePreset: "weekly",
      }),
    );
    expect(formAnchoredToOccurrence(form, "20330117T093000")).toEqual(
      expect.objectContaining({
        startDate: "2033-01-17",
        startTime: "09:30",
        endDate: "2033-01-17",
        endTime: "10:00",
      }),
    );
  });

  it("truncated master and fork do not expand overlapping occurrence starts", () => {
    const masterStart = "2033-01-10T09:30:00";
    const editedOccurrence = "2033-01-17T09:30:00";
    const until = untilBeforeRecurrenceId(editedOccurrence, false, masterStart);
    const seriesRules: NonNullable<JmapCalendarEvent["recurrenceRules"]> = [
      {
        "@type": "RecurrenceRule",
        frequency: "weekly",
        byDay: [{ "@type": "NDay", day: "mo" }],
      },
    ];
    const truncated = truncateRecurrenceRules(seriesRules, until);
    const form: CalendarEventFormValue = {
      ...emptyCalendarEventForm("work", "2033-01-10", "09:30"),
      title: "Standup from here",
      endDate: "2033-01-10",
      endTime: "10:00",
      recurrencePreset: "custom",
      customRecurrenceRules: seriesRules,
    };
    const forkDraft = forkSeriesDraftFromForm(
      formAnchoredToOccurrence(form, editedOccurrence),
      seriesRules,
    );

    const masterWire = {
      id: "master",
      "@type": "Event",
      uid: "u-master",
      title: "Team standup",
      start: masterStart,
      duration: "PT30M",
      calendarIds: { work: true },
      recurrenceRules: truncated,
    } as JmapCalendarEvent;
    const forkWire = {
      id: "fork",
      "@type": "Event",
      uid: "u-fork",
      title: forkDraft.title,
      start: forkDraft.start,
      duration: forkDraft.duration,
      calendarIds: { work: true },
      recurrenceRules: forkDraft.recurrenceRules ?? undefined,
    } as JmapCalendarEvent;

    const range = {
      start: Temporal.PlainDateTime.from("2033-01-01T00:00:00"),
      end: Temporal.PlainDateTime.from("2033-03-01T00:00:00"),
    };
    const masterExpanded = expandEvents(calendarEventsToEngineMap([masterWire]), range);
    const forkExpanded = expandEvents(calendarEventsToEngineMap([forkWire]), range);
    const masterStarts = [...masterExpanded.values()].map((event) => event.data.start.toString());
    const forkStarts = [...forkExpanded.values()].map((event) => event.data.start.toString());

    expect(masterStarts.length).toBeGreaterThan(0);
    expect(forkStarts.length).toBeGreaterThan(0);
    expect(masterStarts).not.toContain(editedOccurrence);
    expect(forkStarts[0]).toBe(editedOccurrence);
    expect(masterStarts.filter((start) => forkStarts.includes(start))).toEqual([]);
  });

  it("builds an exclusion override for only-this delete", () => {
    const original = {
      id: "ev-1",
      "@type": "Event",
      uid: "u1",
      start: "2026-03-09T09:00:00",
      calendarIds: { "cal-work": true },
      recurrenceOverrides: {
        "2026-03-11T09:00:00": { title: "Moved" },
      },
    } as JmapCalendarEvent;
    expect(exclusionRecurrenceOverrides(original, "20260316T090000")).toEqual({
      "2026-03-11T09:00:00": { title: "Moved" },
      "2026-03-16T09:00:00": { excluded: true },
    });
  });

  it("builds an occurrence override patch from the editor form", () => {
    const original = {
      id: "ev-1",
      "@type": "Event",
      uid: "u1",
      title: "Standup",
      start: "2026-03-09T09:00:00",
      duration: "PT30M",
      calendarIds: { "cal-work": true },
      recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "weekly" }],
    } as JmapCalendarEvent;
    const form: CalendarEventFormValue = {
      title: "Standup (moved)",
      calendarId: "cal-work",
      allDay: false,
      startDate: "2026-03-11",
      startTime: "11:00",
      endDate: "2026-03-11",
      endTime: "11:30",
      timeZone: null,
      location: "",
      description: "",
      recurrencePreset: "weekly",
    };
    expect(occurrenceRecurrenceOverrides(form, original, "20260311T090000")).toEqual({
      "2026-03-11T09:00:00": {
        title: "Standup (moved)",
        start: "2026-03-11T11:00:00",
      },
    });
  });

  it("splits recurrenceOverrides before vs at-or-after the this-and-future occurrence", () => {
    const overrides = {
      "2033-01-10T09:30:00": { title: "Past override" },
      "2033-01-17T09:30:00": { excluded: true },
      "2033-01-24T09:30:00": { title: "Future override", start: "2033-01-24T11:00:00" },
    };
    expect(
      splitRecurrenceOverridesAt(overrides, "2033-01-17T09:30:00", false, "2033-01-10T09:30:00"),
    ).toEqual({
      masterOverrides: {
        "2033-01-10T09:30:00": { title: "Past override" },
      },
      forkOverrides: {
        "2033-01-17T09:30:00": { excluded: true },
        "2033-01-24T09:30:00": { title: "Future override", start: "2033-01-24T11:00:00" },
      },
    });
  });

  it("shifts fork override keys when DTSTART moves on this-and-future", () => {
    expect(
      shiftRecurrenceOverrides(
        {
          "2033-01-24T09:30:00": { title: "Moved", start: "2033-01-24T10:00:00" },
          "2033-01-31T09:30:00": { excluded: true },
        },
        "2033-01-17T09:30:00",
        "2033-01-17T11:00:00",
        false,
        "2033-01-10T09:30:00",
      ),
    ).toEqual({
      "2033-01-24T11:00:00": { title: "Moved", start: "2033-01-24T11:30:00" },
      "2033-01-31T11:00:00": { excluded: true },
    });
  });

  it("truncateMasterSeriesPatch drops future-side overrides from the master", () => {
    expect(
      truncateMasterSeriesPatch(
        [{ "@type": "RecurrenceRule", frequency: "weekly" }],
        "2033-01-17T09:30:00",
        false,
        "2033-01-10T09:30:00",
        {
          "2033-01-10T09:30:00": { title: "Past" },
          "2033-01-24T09:30:00": { excluded: true },
        },
      ),
    ).toEqual({
      recurrenceRules: [
        expect.objectContaining({
          frequency: "weekly",
          until: "2033-01-17T09:29:59",
        }),
      ],
      recurrenceOverrides: {
        "2033-01-10T09:30:00": { title: "Past" },
        // Explicit null so deep-merge servers drop the migrated key.
        "2033-01-24T09:30:00": null,
      },
    });
  });

  it("this-and-future fork keeps future exclusions so they are not resurrected", () => {
    const masterStart = "2033-01-10T09:30:00";
    const splitAt = "2033-01-17T09:30:00";
    const excludedAfter = "2033-01-24T09:30:00";
    const seriesRules: NonNullable<JmapCalendarEvent["recurrenceRules"]> = [
      {
        "@type": "RecurrenceRule",
        frequency: "weekly",
        byDay: [{ "@type": "NDay", day: "mo" }],
      },
    ];
    const original = {
      id: "master",
      "@type": "Event",
      uid: "u-master",
      title: "Team standup",
      start: masterStart,
      duration: "PT30M",
      calendarIds: { work: true },
      recurrenceRules: seriesRules,
      recurrenceOverrides: {
        [excludedAfter]: { excluded: true },
      },
    } as JmapCalendarEvent;

    const masterPatch = truncateMasterSeriesPatch(
      seriesRules,
      splitAt,
      false,
      masterStart,
      original.recurrenceOverrides,
    );
    const form: CalendarEventFormValue = {
      ...emptyCalendarEventForm("work", "2033-01-10", "09:30"),
      title: "Standup from here",
      endDate: "2033-01-10",
      endTime: "10:00",
      recurrencePreset: "custom",
      customRecurrenceRules: seriesRules,
    };
    const forkDraft = forkSeriesDraftWithSplitOverrides(
      formAnchoredToOccurrence(form, splitAt),
      seriesRules,
      original,
      splitAt,
    );

    expect(masterPatch.recurrenceOverrides).toBeNull();
    expect(forkDraft.recurrenceOverrides).toEqual({
      [excludedAfter]: { excluded: true },
    });

    const masterWire = {
      ...original,
      id: "master",
      recurrenceRules: masterPatch.recurrenceRules ?? undefined,
      recurrenceOverrides: masterPatch.recurrenceOverrides ?? undefined,
    } as JmapCalendarEvent;
    const forkWire = {
      id: "fork",
      "@type": "Event",
      uid: "u-fork",
      title: forkDraft.title,
      start: forkDraft.start,
      duration: forkDraft.duration,
      calendarIds: { work: true },
      recurrenceRules: forkDraft.recurrenceRules ?? undefined,
      recurrenceOverrides: forkDraft.recurrenceOverrides ?? undefined,
    } as JmapCalendarEvent;

    const range = {
      start: Temporal.PlainDateTime.from("2033-01-01T00:00:00"),
      end: Temporal.PlainDateTime.from("2033-03-01T00:00:00"),
    };
    const masterExpanded = expandEvents(calendarEventsToEngineMap([masterWire]), range);
    const forkExpanded = expandEvents(calendarEventsToEngineMap([forkWire]), range);
    const masterStarts = [...masterExpanded.values()].map((event) => event.data.start.toString());
    const forkStarts = [...forkExpanded.values()].map((event) => event.data.start.toString());

    expect(masterStarts).not.toContain(excludedAfter);
    expect(forkStarts).not.toContain(excludedAfter);
    expect(forkStarts).toContain(splitAt);
  });

  it("this-and-future fork keeps future modified exceptions without duplicating the base slot", () => {
    const masterStart = "2033-01-10T09:30:00";
    const splitAt = "2033-01-17T09:30:00";
    const exceptionRid = "2033-01-24T09:30:00";
    const exceptionStart = "2033-01-24T11:00:00";
    const seriesRules: NonNullable<JmapCalendarEvent["recurrenceRules"]> = [
      {
        "@type": "RecurrenceRule",
        frequency: "weekly",
        byDay: [{ "@type": "NDay", day: "mo" }],
      },
    ];
    const original = {
      id: "master",
      "@type": "Event",
      uid: "u-master",
      title: "Team standup",
      start: masterStart,
      duration: "PT30M",
      calendarIds: { work: true },
      recurrenceRules: seriesRules,
      recurrenceOverrides: {
        [exceptionRid]: { title: "Standup (moved)", start: exceptionStart },
      },
    } as JmapCalendarEvent;

    const masterPatch = truncateMasterSeriesPatch(
      seriesRules,
      splitAt,
      false,
      masterStart,
      original.recurrenceOverrides,
    );
    const form: CalendarEventFormValue = {
      ...emptyCalendarEventForm("work", "2033-01-10", "09:30"),
      title: "Standup from here",
      endDate: "2033-01-10",
      endTime: "10:00",
      recurrencePreset: "custom",
      customRecurrenceRules: seriesRules,
    };
    const forkDraft = forkSeriesDraftWithSplitOverrides(
      formAnchoredToOccurrence(form, splitAt),
      seriesRules,
      original,
      splitAt,
    );

    expect(masterPatch.recurrenceOverrides).toBeNull();
    expect(forkDraft.recurrenceOverrides).toEqual({
      [exceptionRid]: { title: "Standup (moved)", start: exceptionStart },
    });

    const masterWire = {
      ...original,
      id: "master",
      uid: "u-master",
      recurrenceRules: masterPatch.recurrenceRules ?? undefined,
      recurrenceOverrides: masterPatch.recurrenceOverrides ?? undefined,
    } as JmapCalendarEvent;
    const forkWire = {
      id: "fork",
      "@type": "Event",
      uid: "u-fork",
      title: forkDraft.title,
      start: forkDraft.start,
      duration: forkDraft.duration,
      calendarIds: { work: true },
      recurrenceRules: forkDraft.recurrenceRules ?? undefined,
      recurrenceOverrides: forkDraft.recurrenceOverrides ?? undefined,
    } as JmapCalendarEvent;

    const range = {
      start: Temporal.PlainDateTime.from("2033-01-01T00:00:00"),
      end: Temporal.PlainDateTime.from("2033-03-01T00:00:00"),
    };
    const masterExpanded = expandEvents(calendarEventsToEngineMap([masterWire]), range);
    const forkExpanded = expandEvents(calendarEventsToEngineMap([forkWire]), range);
    const combined = expandEvents(calendarEventsToEngineMap([masterWire, forkWire]), range);

    const masterStarts = [...masterExpanded.values()].map((event) => event.data.start.toString());
    const forkStarts = [...forkExpanded.values()].map((event) => event.data.start.toString());
    const combinedStarts = [...combined.values()].map((event) => event.data.start.toString());

    // Exception must leave the truncated master and live only on the fork.
    expect(masterStarts).not.toContain(exceptionStart);
    expect(masterStarts).not.toContain(exceptionRid);
    expect(forkStarts).toContain(exceptionStart);
    expect(forkStarts).not.toContain(exceptionRid);
    // No duplicate: one rendered instance at the moved time, none at the base slot.
    expect(combinedStarts.filter((start) => start === exceptionStart)).toHaveLength(1);
    expect(combinedStarts.filter((start) => start === exceptionRid)).toHaveLength(0);
  });

  it("this-and-future from stale bootstrap still dedupes exception slots via surface engine map", () => {
    // Bug B: only-this updated the adapter, but React bootstrap still lacks overrides.
    // Partition must read detached exceptions from the surface map or the master keeps
    // the exception while the fork expands a regular twin beside it.
    const masterStart = "2033-01-10T09:30:00";
    const splitAt = "2033-01-17T09:30:00";
    const exceptionRid = "2033-01-24T09:30:00";
    const exceptionStart = "2033-01-24T11:00:00";
    const seriesRules: NonNullable<JmapCalendarEvent["recurrenceRules"]> = [
      {
        "@type": "RecurrenceRule",
        frequency: "weekly",
        byDay: [{ "@type": "NDay", day: "mo" }],
      },
    ];
    const staleWire = {
      id: "master",
      "@type": "Event",
      uid: "u-master",
      title: "Team standup",
      start: masterStart,
      duration: "PT30M",
      calendarIds: { work: true },
      recurrenceRules: seriesRules,
      // Intentionally missing — bootstrap lag after only-this.
    } as JmapCalendarEvent;
    const surfaceWire = {
      ...staleWire,
      recurrenceOverrides: {
        [exceptionRid]: { title: "Standup (moved)", start: exceptionStart },
      },
    } as JmapCalendarEvent;
    const surfaceEvents = calendarEventsToEngineMap([surfaceWire]);

    const seriesOverrides = resolveSeriesRecurrenceOverrides(staleWire, "master", surfaceEvents);
    expect(seriesOverrides).toEqual({
      [exceptionRid]: { title: "Standup (moved)", start: exceptionStart },
    });

    const masterPatch = truncateMasterSeriesPatch(
      seriesRules,
      splitAt,
      false,
      masterStart,
      seriesOverrides,
    );
    const form: CalendarEventFormValue = {
      ...emptyCalendarEventForm("work", "2033-01-10", "09:30"),
      title: "Standup from here",
      endDate: "2033-01-10",
      endTime: "10:00",
      recurrencePreset: "custom",
      customRecurrenceRules: seriesRules,
    };
    const forkDraft = forkSeriesDraftWithSplitOverrides(
      formAnchoredToOccurrence(form, splitAt),
      seriesRules,
      staleWire,
      splitAt,
      seriesOverrides,
    );

    expect(masterPatch.recurrenceOverrides).toBeNull();
    expect(forkDraft.recurrenceOverrides).toEqual({
      [exceptionRid]: { title: "Standup (moved)", start: exceptionStart },
    });

    // Simulate post-split wire as the adapter would ingest after patch+create.
    const masterWire = {
      ...staleWire,
      recurrenceRules: masterPatch.recurrenceRules ?? undefined,
      recurrenceOverrides: undefined,
    } as JmapCalendarEvent;
    const forkWire = {
      id: "fork",
      "@type": "Event",
      uid: "u-fork",
      title: forkDraft.title,
      start: forkDraft.start,
      duration: forkDraft.duration,
      calendarIds: { work: true },
      recurrenceRules: forkDraft.recurrenceRules ?? undefined,
      recurrenceOverrides: forkDraft.recurrenceOverrides ?? undefined,
    } as JmapCalendarEvent;

    const range = {
      start: Temporal.PlainDateTime.from("2033-01-01T00:00:00"),
      end: Temporal.PlainDateTime.from("2033-03-01T00:00:00"),
    };
    const combined = expandEvents(calendarEventsToEngineMap([masterWire, forkWire]), range);
    const combinedStarts = [...combined.values()].map((event) => event.data.start.toString());

    expect(combinedStarts.filter((start) => start === exceptionStart)).toHaveLength(1);
    expect(combinedStarts.filter((start) => start === exceptionRid)).toHaveLength(0);

    // Contrast: partitioning from stale wire alone resurrects the twin.
    const brokenFork = forkSeriesDraftWithSplitOverrides(
      formAnchoredToOccurrence(form, splitAt),
      seriesRules,
      staleWire,
      splitAt,
    );
    const brokenMaster = {
      ...surfaceWire,
      recurrenceRules: truncateMasterSeriesPatch(
        seriesRules,
        splitAt,
        false,
        masterStart,
        staleWire.recurrenceOverrides,
      ).recurrenceRules,
      // Stale truncate omitted recurrenceOverrides → server/adapter keep the exception.
    } as JmapCalendarEvent;
    const brokenForkWire = {
      ...forkWire,
      recurrenceOverrides: brokenFork.recurrenceOverrides ?? undefined,
    } as JmapCalendarEvent;
    const broken = expandEvents(calendarEventsToEngineMap([brokenMaster, brokenForkWire]), range);
    const brokenStarts = [...broken.values()].map((event) => event.data.start.toString());
    expect(brokenStarts.filter((start) => start === exceptionStart).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(brokenStarts.filter((start) => start === exceptionRid).length).toBeGreaterThanOrEqual(1);
  });
});
