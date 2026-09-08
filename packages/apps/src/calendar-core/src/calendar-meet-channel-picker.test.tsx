import type React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const MIXED_CHANNELS: CalendarMeetChannelOption[] = [
  { id: "chat-merge", name: "Merge smoke channel", kind: "channel" },
  { id: "chat-onzin", name: "onzin", kind: "channel" },
  { id: "chat-ditjes", name: "ditjes en datjes", kind: "channel" },
  { id: "chat-jasja", name: "jasja", kind: "channel" },
  { id: "chat-test-meet", name: "Test Meet", kind: "meeting" },
  { id: "chat-week-start", name: "Week Start", kind: "meeting" },
  { id: "chat-email-guest", name: "Email guest create check", kind: "meeting" },
  { id: "chat-standup", name: "Standup", kind: "channel" },
  { id: "chat-admins", name: "Administrators", kind: "channel" },
  { id: "chat-dev", name: "Dev Team", kind: "channel" },
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

function meetMenuTrigger(): HTMLElement {
  return screen.getByRole("button", { name: L.eventMeetAdd });
}

function openMeetMenu(): HTMLElement {
  const trigger = meetMenuTrigger();
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  return screen.getByRole("menu");
}

describe("CalendarMeetChannelPicker (event-form Meet menu)", () => {
  beforeEach(() => {
    cleanup();
  });

  it("uses one Meet menu trigger instead of adjacent generate and channel buttons", () => {
    renderCard();
    const trigger = meetMenuTrigger();
    expect(screen.getAllByRole("button", { name: L.eventMeetAdd })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: L.eventMeetPickChannel })).toBeNull();
    expect(screen.queryByRole("button", { name: L.eventMeetNewLink })).toBeNull();
    expect(trigger.className).toContain("color-swatch-trigger");
    expect(trigger.className).toContain("calendar-event-dialog__meet-menu-trigger");
    expect(trigger.querySelector(".color-swatch-trigger__icon")).toBeTruthy();
    expect(trigger.querySelector(".color-swatch-trigger__chevron")).toBeTruthy();
  });

  it("lists New meeting link first, then a separator, then # channels (not meetings)", async () => {
    const { meetOperations } = renderCard();
    expect(meetOperations.listChannels).not.toHaveBeenCalled();

    const menu = openMeetMenu();
    expect(within(menu).getByRole("menuitem", { name: L.eventMeetNewLink })).toBeTruthy();

    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: "General" })).toBeTruthy(),
    );
    expect(meetOperations.listChannels).toHaveBeenCalledTimes(1);

    const items = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent?.trim());
    expect(items[0]).toBe(L.eventMeetNewLink);
    expect(items.slice(1)).toEqual(["General"]);
    expect(within(menu).queryByRole("menuitem", { name: "Standup" })).toBeNull();
    expect(within(menu).getByRole("separator")).toBeTruthy();
  });

  it("omits meeting-kind collections and sorts remaining channels A–Z", async () => {
    renderCard({
      meetOperations: stubMeet({ listChannels: vi.fn().mockResolvedValue(MIXED_CHANNELS) }),
    });
    const menu = openMeetMenu();
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: "Administrators" })).toBeTruthy(),
    );

    const items = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent?.trim());
    expect(items[0]).toBe(L.eventMeetNewLink);
    expect(items.slice(1)).toEqual([
      "Administrators",
      "Dev Team",
      "ditjes en datjes",
      "jasja",
      "Merge smoke channel",
      "onzin",
      "Standup",
    ]);
    expect(within(menu).queryByRole("menuitem", { name: "Test Meet" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Week Start" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Email guest create check" })).toBeNull();
  });

  it("still shows New meeting link when the operations layer has no channel source", () => {
    renderCard({ meetOperations: stubMeet({ listChannels: undefined }) });
    const menu = openMeetMenu();
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent?.trim()).toBe(L.eventMeetNewLink);
    expect(within(menu).queryByRole("separator")).toBeNull();
  });

  it("keeps New meeting link and the empty-channel state when the user has no channels", async () => {
    renderCard({ meetOperations: stubMeet({ listChannels: vi.fn().mockResolvedValue([]) }) });
    const menu = openMeetMenu();
    expect(within(menu).getByRole("menuitem", { name: L.eventMeetNewLink })).toBeTruthy();
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: L.eventMeetChannelsEmpty })).toBeTruthy(),
    );
    expect(within(menu).getByRole("separator")).toBeTruthy();
  });

  it("generates an ad-hoc meeting link from New meeting link", async () => {
    const { onChange, meetOperations } = renderCard();
    const menu = openMeetMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: L.eventMeetNewLink }));

    await waitFor(() => expect(meetOperations.reserveRoom).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingUrl: expect.stringContaining("/meet/meetings/"),
          meetRoomCode: expect.any(String),
        }),
      ),
    );
  });

  it("writes the picked channel URL into the visible Meet input", async () => {
    renderCard();
    const input = screen.getByLabelText(L.eventMeetUrlLabel);
    fireEvent.focus(input);
    const menu = openMeetMenu();
    fireEvent.blur(input);
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: "General" })).toBeTruthy(),
    );

    fireEvent.click(within(menu).getByRole("menuitem", { name: "General" }));

    await waitFor(() =>
      expect(input).toHaveProperty("value", `${ORIGIN}/meet/channels/01h455vb4pa9nnrjpznsav8hva`),
    );
  });

  it("attaches the channel-id room URL for a plain channel without reserving", async () => {
    const { onChange, meetOperations } = renderCard();
    const menu = openMeetMenu();
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: "General" })).toBeTruthy(),
    );

    fireEvent.click(within(menu).getByRole("menuitem", { name: "General" }));

    const channelHref = `${ORIGIN}/meet/channels/01h455vb4pa9nnrjpznsav8hva`;
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingUrl: channelHref,
          meetRoomCode: undefined,
        }),
      ),
    );
    expect(screen.getByLabelText(L.eventMeetUrlLabel)).toHaveProperty("value", channelHref);
    expect(meetOperations.reserveRoom).not.toHaveBeenCalled();
    expect(meetOperations.patchRoomExpiresAt).not.toHaveBeenCalled();
  });

  it("shows the empty-channel state when listChannels returns only meeting-kind collections", async () => {
    renderCard({
      meetOperations: stubMeet({
        listChannels: vi
          .fn()
          .mockResolvedValue([{ id: "chat-test-meet", name: "Test Meet", kind: "meeting" }]),
      }),
    });
    const menu = openMeetMenu();
    expect(within(menu).getByRole("menuitem", { name: L.eventMeetNewLink })).toBeTruthy();
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: L.eventMeetChannelsEmpty })).toBeTruthy(),
    );
    expect(within(menu).queryByRole("menuitem", { name: "Test Meet" })).toBeNull();
  });

  it("expires a staged ad-hoc room when a channel replaces it", async () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      meetingUrl: `${ORIGIN}/meet/guest?room=aaaa-bbbb-cccc`,
      meetRoomCode: "aaaa-bbbb-cccc",
    };
    const { onChange, meetOperations } = renderCard({ form });
    const menu = openMeetMenu();
    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: "General" })).toBeTruthy(),
    );

    fireEvent.click(within(menu).getByRole("menuitem", { name: "General" }));

    await waitFor(() =>
      expect(meetOperations.patchRoomExpiresAt).toHaveBeenCalledWith(
        expect.objectContaining({ room: "aaaa-bbbb-cccc" }),
      ),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingUrl: `${ORIGIN}/meet/channels/01h455vb4pa9nnrjpznsav8hva`,
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
    const menu = openMeetMenu();

    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: L.eventMeetChannelsError })).toBeTruthy(),
    );
    expect(within(menu).getByRole("menuitem", { name: L.eventMeetNewLink })).toBeTruthy();

    fireEvent.click(within(menu).getByRole("menuitem", { name: L.eventMeetChannelsError }));

    await waitFor(() =>
      expect(within(menu).getByRole("menuitem", { name: "General" })).toBeTruthy(),
    );
    expect(listChannels).toHaveBeenCalledTimes(2);
  });
});
