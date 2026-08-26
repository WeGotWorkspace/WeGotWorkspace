import type React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarMeetCard } from "@/calendar-core/src/calendar-meet-card";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarMeetOperations } from "@/calendar-core/src/calendar-meet-link";
import { TooltipProvider } from "@/ui/tooltip";

const ORIGIN = "https://workspace.example.com";
const ROOM = "h8y8-ewp6-al8n";

function stubMeet(overrides: Partial<CalendarMeetOperations> = {}): CalendarMeetOperations {
  return {
    roomStatus: vi.fn().mockResolvedValue({ reserved: true, active: false }),
    reserveRoom: vi.fn().mockResolvedValue({ reserved: true, active: false }),
    patchRoomExpiresAt: vi.fn().mockResolvedValue({ reserved: true, active: false }),
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<React.ComponentProps<typeof CalendarMeetCard>> & {
    meetOperations?: CalendarMeetOperations;
  } = {},
) {
  const onChange = vi.fn();
  const onRecurrenceSaveScopeChange = vi.fn();
  const form = overrides.form ?? emptyCalendarEventForm("default", "2033-01-12");
  const meetOperations = overrides.meetOperations ?? stubMeet();
  render(
    <TooltipProvider delayDuration={0}>
      <CalendarMeetCard
        form={form}
        labels={defaultCalendarLabels}
        calendar={{ id: "default", name: "Personal", color: "#6366f1", scope: "personal" }}
        username="bob"
        workspaceOrigin={ORIGIN}
        meetOperations={meetOperations}
        onChange={onChange}
        onRecurrenceSaveScopeChange={onRecurrenceSaveScopeChange}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onChange, onRecurrenceSaveScopeChange, meetOperations };
}

describe("CalendarMeetCard", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stages one room code and disables Add Meet while POST is in-flight", async () => {
    let resolveReserve: ((value: { reserved: boolean; active: boolean }) => void) | undefined;
    const reserveRoom = vi.fn(
      () =>
        new Promise<{ reserved: boolean; active: boolean }>((resolve) => {
          resolveReserve = resolve;
        }),
    );
    const meetOperations = stubMeet({ reserveRoom });
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      const bytes = array as Uint32Array;
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = 0;
      return array;
    });

    const { onChange } = renderCard({ meetOperations });
    const add = screen.getByRole("button", { name: defaultCalendarLabels.eventMeetAdd });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(add.hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(reserveRoom).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ meetRoomCode: expect.any(String) }));
    const staged = (onChange.mock.calls[0]?.[0] as { meetRoomCode?: string } | undefined)
      ?.meetRoomCode;
    const reserved = (reserveRoom as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      room: string;
      ownerPrincipal: string;
      expiresAt: string | null;
    };
    expect(reserved).toMatchObject({
      room: staged,
      ownerPrincipal: "u:bob",
      expiresAt: expect.any(String),
    });
    expect(reserved.room).toBe(staged);
    resolveReserve?.({ reserved: true, active: false });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          meetRoomCode: staged,
          meetingUrl: expect.stringContaining(`/meet/guest?room=${staged}`),
        }),
      ),
    );
  });

  it("reserves series / this-and-future with expiresAt null", async () => {
    const meetOperations = stubMeet();
    renderCard({
      meetOperations,
      form: { ...emptyCalendarEventForm("default", "2033-01-12"), recurrencePreset: "weekly" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.eventMeetAdd }));
    await waitFor(() => expect(meetOperations.reserveRoom).toHaveBeenCalled());
    expect(meetOperations.reserveRoom).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: null, ownerPrincipal: "u:bob" }),
    );
  });

  it("mints a this-instance room with occurrence end + 7 days", async () => {
    const meetOperations = stubMeet();
    renderCard({
      meetOperations,
      recurrenceId: "2033-01-12T10:00:00",
      recurrenceSaveScope: "thisInstance",
      form: {
        ...emptyCalendarEventForm("default", "2033-01-12", "10:00"),
        recurrencePreset: "weekly",
        endTime: "11:00",
        timeZone: "UTC",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.eventMeetAdd }));
    await waitFor(() => expect(meetOperations.reserveRoom).toHaveBeenCalled());
    const body = (meetOperations.reserveRoom as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      expiresAt: string;
    };
    expect(body.expiresAt).toBe("2033-01-19T11:00:00.000Z");
  });

  it("Remove PATCHes expiresAt now+30d and clears the staged code", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2033-01-01T00:00:00.000Z"));
    const meetOperations = stubMeet();
    const { onChange } = renderCard({
      meetOperations,
      form: {
        ...emptyCalendarEventForm("default", "2033-01-12"),
        meetingUrl: `${ORIGIN}/meet/guest?room=${ROOM}`,
        meetRoomCode: ROOM,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.eventMeetRemove }));
    await waitFor(() => expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalled());
    expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalledWith({
      room: ROOM,
      expiresAt: "2033-01-31T00:00:00.000Z",
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meetingUrl: "", meetRoomCode: undefined }),
    );
  });

  it("invalidates a staged reserve when save-scope changes", async () => {
    const meetOperations = stubMeet();
    const { onRecurrenceSaveScopeChange } = renderCard({
      meetOperations,
      recurrenceId: "2033-01-12T10:00:00",
      recurrenceSaveScope: "thisAndFuture",
      form: {
        ...emptyCalendarEventForm("default", "2033-01-12"),
        recurrencePreset: "weekly",
        meetingUrl: `${ORIGIN}/meet/guest?room=${ROOM}`,
        meetRoomCode: ROOM,
      },
    });
    fireEvent.click(screen.getByRole("combobox", { name: defaultCalendarLabels.eventMeetApplyTo }));
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.recurrenceScopeThisInstance }));
    await waitFor(() => expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalled());
    expect(onRecurrenceSaveScopeChange).toHaveBeenCalledWith("thisInstance");
  });

  it("reserves a complete same-origin guest URL on blur as a draft, never per keystroke", async () => {
    const meetOperations = stubMeet();
    const href = `${ORIGIN}/meet/guest?room=${ROOM}`;
    const { onChange } = renderCard({ meetOperations });
    const input = screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel);
    fireEvent.change(input, { target: { value: href } });
    expect(meetOperations.reserveRoom).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ meetingUrl: href }));

    cleanup();
    renderCard({
      meetOperations,
      form: { ...emptyCalendarEventForm("default", "2033-01-12"), meetingUrl: href },
    });
    fireEvent.blur(screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel));
    await waitFor(() => expect(meetOperations.reserveRoom).toHaveBeenCalledTimes(1));
    expect(meetOperations.reserveRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        room: ROOM,
        expiresAt: expect.any(String),
      }),
    );
  });

  it("does not POST incomplete or other-origin values on blur", async () => {
    const meetOperations = stubMeet();
    const incomplete = `${ORIGIN}/meet/guest?room=abc`;
    renderCard({
      meetOperations,
      form: { ...emptyCalendarEventForm("default", "2033-01-12"), meetingUrl: incomplete },
    });
    fireEvent.blur(screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel));
    await waitFor(() => expect(meetOperations.reserveRoom).not.toHaveBeenCalled());

    cleanup();
    renderCard({
      meetOperations,
      form: {
        ...emptyCalendarEventForm("default", "2033-01-12"),
        meetingUrl: "https://zoom.us/j/123",
      },
    });
    fireEvent.blur(screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel));
    await waitFor(() => expect(meetOperations.reserveRoom).not.toHaveBeenCalled());
  });
});
