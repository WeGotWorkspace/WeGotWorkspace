import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarAttendee, CalendarInvitee } from "@/lib/models/calendar-attendees";
import {
  emptyCalendarEventForm,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import { CalendarEventFormSecondary } from "@/calendar-core/src/calendar-event-form-secondary";
import type {
  TeamAvailabilityPeriod,
  TeamAvailabilitySource,
} from "@/calendar-core/src/calendar-invitee-availability";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  INVITEE_AVAILABILITY_DEBOUNCE_MS,
  TeamAvailabilityProvider,
} from "@/calendar-core/src/use-invitee-availability";
import { TooltipProvider } from "@/ui/tooltip";

const connectivity = vi.hoisted(() => ({ online: true }));
vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: connectivity.online }),
}));
vi.mock("@/calendar-core/src/use-calendar-display-prefs", () => ({
  useCalendarDisplayPrefs: () => ({ locale: "en-GB", timeZone: "Europe/Amsterdam" }),
}));

const labels = defaultCalendarLabels;

const invitees: CalendarInvitee[] = [
  { username: "ann", email: "ann@example.test", name: "Ann" },
  { username: "bob", email: "bob@example.test", name: "Bob" },
  { username: "cy", email: "cy@example.test", name: "Cy" },
  { username: "dee", email: "dee@example.test", name: "Dee" },
];

const attendee = (email: string, name: string): CalendarAttendee => ({
  email,
  name,
  participationStatus: "needs-action",
});

const periods: Record<string, { periods: TeamAvailabilityPeriod[]; complete: boolean }> = {
  // Busy 10:30–11:30 Amsterdam on 8 Jan 2030, with details.
  ann: {
    complete: true,
    periods: [
      {
        start: "2030-01-08T10:30:00",
        timeZone: "Europe/Amsterdam",
        duration: "PT1H",
        showWithoutTime: false,
        title: "Design review",
      },
    ],
  },
  cy: { complete: true, periods: [] },
  // Something could not be read: never "Free".
  dee: { complete: false, periods: [] },
};

function fakeSource(): TeamAvailabilitySource & {
  availability: ReturnType<typeof vi.fn>;
  teamMembers: ReturnType<typeof vi.fn>;
} {
  return {
    teamMembers: vi.fn(async () => [
      { id: "ann", name: "Ann", isSelf: false, version: "1" },
      { id: "cy", name: "Cy", isSelf: false, version: "1" },
      { id: "dee", name: "Dee", isSelf: false, version: "1" },
      { id: "me", name: "Me", isSelf: true, version: "1" },
    ]),
    availability: vi.fn(async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({ id, ...(periods[id] ?? { periods: [], complete: true }) })),
    ),
  };
}

function baseForm(): CalendarEventFormValue {
  return {
    ...emptyCalendarEventForm("default", "2030-01-08", "10:00", "Europe/Amsterdam"),
    title: "Planning",
    attendees: [
      attendee("ann@example.test", "Ann"),
      attendee("bob@example.test", "Bob"),
      attendee("cy@example.test", "Cy"),
      attendee("dee@example.test", "Dee"),
      attendee("guest@elsewhere.test", "Guest"),
    ],
  };
}

function renderSecondary(
  source: TeamAvailabilitySource,
  form: CalendarEventFormValue,
  extra: { availabilityEventId?: string; readOnly?: boolean } = {},
) {
  const ui = (value: CalendarEventFormValue) => (
    <TeamAvailabilityProvider source={source}>
      <TooltipProvider>
        <CalendarEventFormSecondary
          form={value}
          labels={labels}
          invitees={invitees}
          contactCards={[]}
          busy={false}
          readOnly={extra.readOnly ?? false}
          fieldsDisabled={false}
          canSubmitEmail
          controlSize="sm"
          availabilityEventId={extra.availabilityEventId}
          onFieldChange={vi.fn()}
        />
      </TooltipProvider>
    </TeamAvailabilityProvider>
  );
  const view = render(ui(form));
  return { ...view, update: (next: CalendarEventFormValue) => view.rerender(ui(next)) };
}

/** Team list first, then the debounced availability call, then its answer. */
async function settle() {
  for (const ms of [10, INVITEE_AVAILABILITY_DEBOUNCE_MS + 10, 10]) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
}

function chipFor(name: string): HTMLElement {
  return screen.getByRole("group", { name: new RegExp(`^${name},`) });
}

/** Busy = the participant tag itself carries the warning wash, icon and status. */
function isBusy(name: string): boolean {
  const chip = chipFor(name);
  const busy = chip.classList.contains("calendar-invitees-card__chip--busy");
  const named = /, busy at this time$/.test(chip.getAttribute("aria-label") ?? "");
  const icon = chip.querySelector(".user-chip__adornment svg") != null;
  if (busy !== named || busy !== icon) throw new Error(`${name}: inconsistent busy state`);
  return busy;
}

function descriptionOf(name: string): string {
  const id = chipFor(name).getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? "") : "";
}

const busyChips = () => document.querySelectorAll(".calendar-invitees-card__chip--busy");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  connectivity.online = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("busy invitee participant tags (#1614)", () => {
  it("marks only busy teammates; free, partial data and others keep a plain tag", async () => {
    const source = fakeSource();
    renderSecondary(source, baseForm());
    await settle();

    expect(isBusy("Ann")).toBe(true);
    expect(chipFor("Ann").getAttribute("aria-label")).toBe(
      "Ann, Needs response, busy at this time",
    );
    expect(isBusy("Cy")).toBe(false); // free: no label at all
    expect(isBusy("Dee")).toBe(false); // complete: false
    expect(isBusy("Bob")).toBe(false); // not a teammate sharing availability
    expect(isBusy("Guest")).toBe(false); // external guest
    expect(busyChips()).toHaveLength(1);
    expect(document.querySelector(".tag__label")).toBeNull(); // no separate Free/Busy tags
    expect(source.availability).toHaveBeenCalledWith({
      ids: ["ann", "cy", "dee"],
      utcStart: "2030-01-07T00:00:00Z",
      utcEnd: "2030-01-14T00:00:00Z",
    });
  });

  it("explains Busy with the overlapping time and title", async () => {
    renderSecondary(fakeSource(), baseForm());
    await settle();
    expect(descriptionOf("Ann")).toMatch(/10:30.*11:30 · Design review/);
    expect(descriptionOf("Cy")).toBe("");
    fireEvent.pointerMove(chipFor("Ann"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toMatch(
      /Needs response.*Busy at this time.*10:30.*11:30 · Design review/,
    );
  });

  it("passes the saved event as excludeEventId when editing", async () => {
    const source = fakeSource();
    renderSecondary(source, baseForm(), { availabilityEventId: "ev-42" });
    await settle();
    expect(source.availability).toHaveBeenCalledWith(
      expect.objectContaining({ excludeEventId: "ev-42" }),
    );
  });

  it("debounces time changes and moving to a free slot clears the warning", async () => {
    const source = fakeSource();
    const { update } = renderSecondary(source, baseForm());
    await settle();
    expect(source.availability).toHaveBeenCalledTimes(1);

    update({ ...baseForm(), startTime: "10:45", endTime: "11:15" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(isBusy("Ann")).toBe(false); // the old answer never shows for a new time
    update({ ...baseForm(), startTime: "11:00", endTime: "12:00" });
    await settle();
    expect(source.availability).toHaveBeenCalledTimes(2);
    expect(isBusy("Ann")).toBe(true);

    update({ ...baseForm(), startTime: "14:00", endTime: "15:00" });
    await settle();
    expect(source.availability).toHaveBeenCalledTimes(3);
    expect(isBusy("Ann")).toBe(false);
  });

  it("an all-day busy period on the event's date makes the invitee Busy", async () => {
    const source = fakeSource();
    source.availability.mockImplementation(async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({
        id,
        complete: true,
        periods:
          id === "cy"
            ? [{ start: "2030-01-08", timeZone: null, duration: "P1D", showWithoutTime: true }]
            : [],
      })),
    );
    renderSecondary(source, baseForm());
    await settle();
    expect(isBusy("Cy")).toBe(true);
    expect(descriptionOf("Cy")).toMatch(/All day · Busy/);
  });

  it("asks nothing and shows nothing offline", async () => {
    connectivity.online = false;
    const source = fakeSource();
    renderSecondary(source, baseForm());
    await settle();
    expect(source.teamMembers).not.toHaveBeenCalled();
    expect(source.availability).not.toHaveBeenCalled();
    expect(busyChips()).toHaveLength(0);
  });

  it("shows no tags when the request fails and never blocks the form", async () => {
    const source = fakeSource();
    source.availability.mockRejectedValue(new Error("invalidArguments"));
    renderSecondary(source, baseForm());
    await settle();
    expect(busyChips()).toHaveLength(0);
    const notes = screen.getByRole("textbox", { name: labels.eventNotesLabel });
    fireEvent.change(notes, { target: { value: "Agenda" } });
    expect(notes).toBeTruthy();
  });

  it("asks nothing on a read-only view", async () => {
    const source = fakeSource();
    renderSecondary(source, baseForm(), { readOnly: true });
    await settle();
    expect(source.availability).not.toHaveBeenCalled();
  });
});
