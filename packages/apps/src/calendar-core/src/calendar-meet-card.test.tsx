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

function generateMeetButton(): HTMLElement {
  return screen.getByRole("button", { name: defaultCalendarLabels.eventMeetAdd });
}

function clickGenerateMeet(): void {
  fireEvent.click(generateMeetButton());
}

describe("CalendarMeetCard", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stages one room code and disables generate while POST is in-flight", async () => {
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
    const urlInput = screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel);
    expect(urlInput.className).not.toContain("share-dialog__input--mono");
    expect(generateMeetButton().querySelector(".loading-spinner")).toBeNull();
    clickGenerateMeet();
    clickGenerateMeet();
    expect(generateMeetButton()).toHaveProperty("disabled", true);
    expect(generateMeetButton().querySelector(".loading-spinner")).toBeTruthy();
    await waitFor(() => expect(reserveRoom).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meetRoomCode: expect.any(String) }),
    );
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
    clickGenerateMeet();
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
    clickGenerateMeet();
    await waitFor(() => expect(meetOperations.reserveRoom).toHaveBeenCalled());
    const body = (meetOperations.reserveRoom as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      expiresAt: string;
    };
    expect(body.expiresAt).toBe("2033-01-19T11:00:00.000Z");
  });

  it("clearing the URL field expires a staged WGW room", async () => {
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
    const input = screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() => expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalled());
    expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalledWith({
      room: ROOM,
      expiresAt: "2033-01-31T00:00:00.000Z",
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meetingUrl: "", meetRoomCode: undefined }),
    );
  });

  it("dismiss after generate PATCHes a staged series reserve to now+30d", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2033-01-01T00:00:00.000Z"));
    const abandonStagedReserveRef: { current: (() => void) | null } = { current: null };
    const meetOperations = stubMeet();
    renderCard({
      meetOperations,
      abandonStagedReserveRef,
      form: { ...emptyCalendarEventForm("default", "2033-01-12"), recurrencePreset: "weekly" },
    });
    clickGenerateMeet();
    await waitFor(() => expect(meetOperations.reserveRoom).toHaveBeenCalled());
    const reserved = (meetOperations.reserveRoom as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      room: string;
      expiresAt: string | null;
    };
    expect(reserved.expiresAt).toBeNull();
    abandonStagedReserveRef.current?.();
    await waitFor(() => expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalled());
    expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalledWith({
      room: reserved.room,
      expiresAt: "2033-01-31T00:00:00.000Z",
    });
  });

  it("dismiss during in-flight generate PATCHes after the reserve lands", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2033-01-01T00:00:00.000Z"));
    let resolveReserve: ((value: { reserved: boolean; active: boolean }) => void) | undefined;
    const reserveRoom = vi.fn(
      () =>
        new Promise<{ reserved: boolean; active: boolean }>((resolve) => {
          resolveReserve = resolve;
        }),
    );
    const abandonStagedReserveRef: { current: (() => void) | null } = { current: null };
    const meetOperations = stubMeet({ reserveRoom });
    renderCard({
      meetOperations,
      abandonStagedReserveRef,
      form: { ...emptyCalendarEventForm("default", "2033-01-12"), recurrencePreset: "weekly" },
    });
    clickGenerateMeet();
    await waitFor(() => expect(reserveRoom).toHaveBeenCalledTimes(1));
    abandonStagedReserveRef.current?.();
    expect(meetOperations.patchRoomExpiresAt).not.toHaveBeenCalled();
    const reserved = (reserveRoom as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      room: string;
    };
    resolveReserve?.({ reserved: true, active: false });
    await waitFor(() => expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalled());
    expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalledWith({
      room: reserved.room,
      expiresAt: "2033-01-31T00:00:00.000Z",
    });
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
    fireEvent.click(
      screen.getByRole("option", { name: defaultCalendarLabels.recurrenceScopeThisInstance }),
    );
    await waitFor(() => expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalled());
    expect(onRecurrenceSaveScopeChange).toHaveBeenCalledWith("thisInstance");
  });

  it("always shows the URL field and generate, and does not confirm when empty", () => {
    renderCard();
    expect(screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel)).toBeTruthy();
    expect(generateMeetButton()).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: defaultCalendarLabels.copyHttpsUrl })).toHaveProperty(
      "disabled",
      true,
    );
    clickGenerateMeet();
    expect(screen.queryByText(defaultCalendarLabels.eventMeetReplaceTitle)).toBeNull();
  });

  it("shows an editable URL and copies the displayed href when Meet is on", async () => {
    const href = `${ORIGIN}/meet/guest?room=${ROOM}`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderCard({
      form: { ...emptyCalendarEventForm("default", "2033-01-12"), meetingUrl: href },
    });
    const input = screen.getByLabelText(
      defaultCalendarLabels.eventMeetUrlLabel,
    ) as HTMLInputElement;
    expect(input.value).toBe(href);
    expect(input.readOnly).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.copyHttpsUrl }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(href));
  });

  it("shows the stored href for invitees and copies it", async () => {
    const href = `${ORIGIN}/meet/guest?room=${ROOM}`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderCard({
      readOnly: true,
      form: { ...emptyCalendarEventForm("default", "2033-01-12"), meetingUrl: href },
    });
    const input = screen.getByLabelText(
      defaultCalendarLabels.eventMeetUrlLabel,
    ) as HTMLInputElement;
    expect(input.value).toBe(href);
    expect(input.readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.eventMeetAdd })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.copyHttpsUrl }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(href));
  });

  it("reserves a complete same-origin guest URL on blur as a draft", async () => {
    const meetOperations = stubMeet();
    const href = `${ORIGIN}/meet/guest?room=${ROOM}`;
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
    const incompleteCard = renderCard({
      meetOperations,
      form: { ...emptyCalendarEventForm("default", "2033-01-12"), meetingUrl: incomplete },
    });
    fireEvent.blur(screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel));
    await waitFor(() => expect(meetOperations.reserveRoom).not.toHaveBeenCalled());
    expect(incompleteCard.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meetingUrl: "" }),
    );

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

  it("replacing a WGW URL with a generic https link expires the staged room", async () => {
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
    const input = screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel);
    fireEvent.change(input, { target: { value: "https://meet.google.com/abc-defg-hij" } });
    fireEvent.blur(input);
    await waitFor(() => expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalled());
    expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalledWith({
      room: ROOM,
      expiresAt: "2033-01-31T00:00:00.000Z",
    });
    expect(meetOperations.reserveRoom).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        meetRoomCode: undefined,
      }),
    );
  });

  it("confirms before replacing an existing URL, and cancel leaves it", async () => {
    const meetOperations = stubMeet();
    const href = `${ORIGIN}/meet/guest?room=${ROOM}`;
    const { onChange } = renderCard({
      meetOperations,
      form: {
        ...emptyCalendarEventForm("default", "2033-01-12"),
        meetingUrl: href,
        meetRoomCode: ROOM,
      },
    });
    expect(generateMeetButton()).toHaveProperty("disabled", false);
    clickGenerateMeet();
    expect(meetOperations.reserveRoom).not.toHaveBeenCalled();
    expect(screen.getByText(defaultCalendarLabels.eventMeetReplaceTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.cancel }));
    expect(meetOperations.reserveRoom).not.toHaveBeenCalled();
    expect(meetOperations.patchRoomExpiresAt).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel)).toHaveProperty(
      "value",
      href,
    );
  });

  it("replacing an existing WGW URL expires the old room and mints a new one", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2033-01-01T00:00:00.000Z"));
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      const bytes = array as Uint32Array;
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = 0x11111111;
      return array;
    });
    const meetOperations = stubMeet();
    renderCard({
      meetOperations,
      form: {
        ...emptyCalendarEventForm("default", "2033-01-12"),
        meetingUrl: `${ORIGIN}/meet/guest?room=${ROOM}`,
        meetRoomCode: ROOM,
      },
    });
    clickGenerateMeet();
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.eventMeetReplaceConfirm }),
    );
    await waitFor(() => expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalled());
    expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalledWith({
      room: ROOM,
      expiresAt: "2033-01-31T00:00:00.000Z",
    });
    await waitFor(() => expect(meetOperations.reserveRoom).toHaveBeenCalled());
    const reserved = (meetOperations.reserveRoom as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      room: string;
    };
    expect(reserved.room).not.toBe(ROOM);
  });

  it("confirms before replacing a generic https URL and then mints a WGW room", async () => {
    const meetOperations = stubMeet();
    renderCard({
      meetOperations,
      form: {
        ...emptyCalendarEventForm("default", "2033-01-12"),
        meetingUrl: "https://zoom.us/j/123",
      },
    });
    expect(generateMeetButton()).toHaveProperty("disabled", false);
    clickGenerateMeet();
    expect(meetOperations.reserveRoom).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.eventMeetReplaceConfirm }),
    );
    await waitFor(() => expect(meetOperations.reserveRoom).toHaveBeenCalled());
    expect(meetOperations.patchRoomExpiresAt).not.toHaveBeenCalled();
  });

  it("clearing a pasted generic https URL does not PATCH a reservation", async () => {
    const meetOperations = stubMeet();
    const { onChange } = renderCard({
      meetOperations,
      form: {
        ...emptyCalendarEventForm("default", "2033-01-12"),
        meetingUrl: "https://zoom.us/j/123",
      },
    });
    const input = screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ meetingUrl: "", meetRoomCode: undefined }),
      ),
    );
    expect(meetOperations.patchRoomExpiresAt).not.toHaveBeenCalled();
  });
});
