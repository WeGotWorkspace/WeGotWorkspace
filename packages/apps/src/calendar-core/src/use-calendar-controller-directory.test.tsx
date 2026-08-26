import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";

const toastApi = {
  show: vi.fn(() => "toast-1"),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

const bootstrap = createCalendarAppBootstrap();

function mockMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useCalendarController create calendar directory", () => {
  beforeEach(() => {
    mockMatchMedia();
  });

  it("forwards groupSlug when creating a calendar in a group directory", async () => {
    const createCalendar = vi.fn().mockResolvedValue({
      id: "roadmap",
      name: "Roadmap",
      color: "#22c55e",
      scope: "group",
      groupSlug: "team",
      mayWrite: true,
      mayDelete: true,
    });

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          createCalendar,
        },
      }),
    );

    act(() => {
      result.current.openCreateCalendarDialog();
    });
    await act(async () => {
      result.current.saveCalendarDialog({
        name: "Roadmap",
        color: "#22c55e",
        groupSlug: "team",
      });
    });

    expect(createCalendar).toHaveBeenCalledWith({
      name: "Roadmap",
      color: "#22c55e",
      groupSlug: "team",
    });
  });

  it("patches a team calendar name and color", async () => {
    const patchCalendar = vi.fn().mockResolvedValue({
      id: "group-editorial",
      name: "Desk",
      color: "#ec4899",
      scope: "group",
      groupSlug: "editorial",
      mayWrite: true,
      mayDelete: false,
    });

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          patchCalendar,
        },
      }),
    );

    act(() => {
      result.current.openEditCalendarDialog("group-editorial");
    });
    await act(async () => {
      result.current.saveCalendarDialog({
        name: "Desk",
        color: "#ec4899",
      });
    });

    expect(patchCalendar).toHaveBeenCalledWith("group-editorial", {
      name: "Desk",
      color: "#ec4899",
    });
    expect(result.current.calendars.find((entry) => entry.id === "group-editorial")).toMatchObject({
      name: "Desk",
      color: "#ec4899",
    });
  });

  it("lets a sharee patch their instance name and color", async () => {
    const patchCalendar = vi.fn().mockResolvedValue({
      id: "family",
      name: "Family (mine)",
      color: "#ef4444",
      mayWrite: false,
      mayShare: false,
      mayDelete: false,
    });

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          patchCalendar,
        },
      }),
    );

    act(() => {
      result.current.openEditCalendarDialog("family");
    });
    expect(result.current.calendarDialog).toMatchObject({
      mode: "edit",
      calendarId: "family",
      nameReadOnly: false,
      removeShared: true,
      canPublish: false,
    });

    await act(async () => {
      result.current.saveCalendarDialog({
        name: "Family (mine)",
        color: "#ef4444",
      });
    });

    expect(patchCalendar).toHaveBeenCalledWith("family", {
      name: "Family (mine)",
      color: "#ef4444",
    });
  });

  it("removes a shared calendar through deleteCalendar without treating it as owner delete", async () => {
    const deleteCalendar = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          deleteCalendar,
        },
      }),
    );

    act(() => {
      result.current.openEditCalendarDialog("family");
    });
    expect(result.current.calendarDialog).toMatchObject({
      removeShared: true,
      mayDelete: true,
    });

    await act(async () => {
      result.current.deleteCalendarFromDialog();
    });

    expect(deleteCalendar).toHaveBeenCalledWith("family");
    expect(result.current.calendars.find((entry) => entry.id === "family")).toBeUndefined();
    expect(result.current.calendarDialog).toBeNull();
  });

  it("subscribes through operations and adds the read-only calendar", async () => {
    const subscribeCalendar = vi.fn().mockResolvedValue({
      id: "subscribed-1",
      name: "Holidays",
      color: "#8b5cf6",
      mayWrite: false,
      mayDelete: true,
      subscriptionId: "sub-1",
      subscriptionUrl: "https://feeds.example.test/holidays.ics",
    });

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          subscribeCalendar,
        },
      }),
    );

    act(() => {
      result.current.openSubscribeCalendarDialog();
    });
    await act(async () => {
      result.current.saveCalendarDialog({
        name: "Holidays",
        color: "#8b5cf6",
        url: "webcal://feeds.example.test/holidays.ics",
        nameTouched: true,
        groupSlug: "team",
      });
    });

    expect(subscribeCalendar).toHaveBeenCalledWith({
      url: "webcal://feeds.example.test/holidays.ics",
      name: "Holidays",
      color: "#8b5cf6",
      groupSlug: "team",
    });
    expect(result.current.calendars.find((entry) => entry.id === "subscribed-1")).toMatchObject({
      subscriptionId: "sub-1",
      mayWrite: false,
    });
  });

  it("omits inferred names so the API can prefer X-WR-CALNAME", async () => {
    const subscribeCalendar = vi.fn().mockResolvedValue({
      id: "subscribed-2",
      name: "ICS Holidays",
      color: "#8b5cf6",
      mayWrite: false,
      mayDelete: true,
      subscriptionId: "sub-2",
    });

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          subscribeCalendar,
        },
      }),
    );

    act(() => {
      result.current.openSubscribeCalendarDialog();
    });
    await act(async () => {
      result.current.saveCalendarDialog({
        name: "Us Public Holidays",
        color: "#8b5cf6",
        url: "https://feeds.example.test/us-public-holidays.ics",
        nameTouched: false,
      });
    });

    expect(subscribeCalendar).toHaveBeenCalledWith({
      url: "https://feeds.example.test/us-public-holidays.ics",
      color: "#8b5cf6",
    });
    expect(result.current.calendars.find((entry) => entry.id === "subscribed-2")?.name).toBe(
      "ICS Holidays",
    );
  });
});
