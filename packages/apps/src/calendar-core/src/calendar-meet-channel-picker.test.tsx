import type React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarMeetCard } from "@/calendar-core/src/calendar-meet-card";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type {
  CalendarMeetChannelOption,
  CalendarMeetOperations,
} from "@/calendar-core/src/calendar-meet-link";
import { TooltipProvider } from "@/ui/tooltip";

const L = defaultCalendarLabels;
const ORIGIN = "https://workspace.example.com";
const CHANNELS: CalendarMeetChannelOption[] = [
  { id: "chat-01h455vb4pa9nnrjpznsav8hva", name: "General", kind: "channel" },
  {
    id: "chat-01h455vb4pa9nnrjpznsav8hvb",
    name: "Standup",
    kind: "meeting",
    guestRoomCode: "h8y8-ewp6-al8n",
  },
];

function stubMeet(overrides: Partial<CalendarMeetOperations> = {}): CalendarMeetOperations {
  return {
    roomStatus: vi.fn().mockResolvedValue({ reserved: true, active: false }),
    reserveRoom: vi.fn().mockResolvedValue({ reserved: true, active: false }),
    patchRoomExpiresAt: vi.fn().mockResolvedValue({ reserved: true, active: false }),
    listChannels: vi.fn().mockResolvedValue(CHANNELS),
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<React.ComponentProps<typeof CalendarMeetCard>> & {
    meetOperations?: CalendarMeetOperations;
  } = {},
) {
  const onChange = vi.fn();
  const form = overrides.form ?? emptyCalendarEventForm("default", "2033-01-12");
  const meetOperations = overrides.meetOperations ?? stubMeet();
  render(
    <TooltipProvider delayDuration={0}>
      <CalendarMeetCard
        form={form}
        labels={L}
        calendar={{ id: "default", name: "Personal", color: "#6366f1", scope: "personal" }}
        username="bob"
        workspaceOrigin={ORIGIN}
        meetOperations={meetOperations}
        onChange={onChange}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onChange, meetOperations };
}

function openPicker(): void {
  const trigger = screen.getByRole("button", { name: L.eventMeetPickChannel });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

describe("CalendarMeetChannelPicker (event-form channel picker)", () => {
  beforeEach(() => {
    cleanup();
  });

  it("hides the picker when the operations layer has no channel source", () => {
    renderCard({ meetOperations: stubMeet({ listChannels: undefined }) });
    expect(screen.queryByRole("button", { name: L.eventMeetPickChannel })).toBeNull();
  });

  it("fetches lazily on open and lists channels as menu items", async () => {
    const { meetOperations } = renderCard();
    expect(meetOperations.listChannels).not.toHaveBeenCalled();

    openPicker();

    await waitFor(() => expect(screen.getByRole("menuitem", { name: "General" })).toBeTruthy());
    expect(meetOperations.listChannels).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menuitem", { name: "Standup" })).toBeTruthy();
  });

  it("attaches the channel-id room URL for a plain channel without reserving", async () => {
    const { onChange, meetOperations } = renderCard();
    openPicker();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "General" })).toBeTruthy());

    fireEvent.click(screen.getByRole("menuitem", { name: "General" }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingUrl: `${ORIGIN}/meet/guest?room=chat-01h455vb4pa9nnrjpznsav8hva`,
          meetRoomCode: undefined,
        }),
      ),
    );
    expect(meetOperations.reserveRoom).not.toHaveBeenCalled();
    expect(meetOperations.patchRoomExpiresAt).not.toHaveBeenCalled();
  });

  it("attaches the guestRoomCode URL for a meeting-kind channel", async () => {
    const { onChange } = renderCard();
    openPicker();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Standup" })).toBeTruthy());

    fireEvent.click(screen.getByRole("menuitem", { name: "Standup" }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingUrl: `${ORIGIN}/meet/guest?room=h8y8-ewp6-al8n`,
        }),
      ),
    );
  });

  it("expires a staged ad-hoc room when a channel replaces it", async () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      meetingUrl: `${ORIGIN}/meet/guest?room=aaaa-bbbb-cccc`,
      meetRoomCode: "aaaa-bbbb-cccc",
    };
    const { onChange, meetOperations } = renderCard({ form });
    openPicker();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "General" })).toBeTruthy());

    fireEvent.click(screen.getByRole("menuitem", { name: "General" }));

    await waitFor(() =>
      expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalledWith(
        expect.objectContaining({ room: "aaaa-bbbb-cccc" }),
      ),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingUrl: `${ORIGIN}/meet/guest?room=chat-01h455vb4pa9nnrjpznsav8hva`,
          meetRoomCode: undefined,
        }),
      ),
    );
  });

  it("shows a retryable error item when the channel fetch fails", async () => {
    const listChannels = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(CHANNELS);
    renderCard({ meetOperations: stubMeet({ listChannels }) });
    openPicker();

    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: L.eventMeetChannelsError })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("menuitem", { name: L.eventMeetChannelsError }));

    await waitFor(() => expect(screen.getByRole("menuitem", { name: "General" })).toBeTruthy());
    expect(listChannels).toHaveBeenCalledTimes(2);
  });

  it("shows an empty state when the user has no channels", async () => {
    renderCard({ meetOperations: stubMeet({ listChannels: vi.fn().mockResolvedValue([]) }) });
    openPicker();

    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: L.eventMeetChannelsEmpty })).toBeTruthy(),
    );
  });
});
