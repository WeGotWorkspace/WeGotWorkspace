import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockCalendarAvailabilityPublicLinkOperations } from "@/lib/api/mock/calendar-availability-public-link";
import { createMockCalendarAvailabilitySettingsOperations } from "@/lib/api/mock/calendar-availability-settings";
import type { CalendarAvailabilityPublicLinkOperations } from "@/lib/api/wgw/calendar-availability-public-link";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { calendarAvailabilityLabels as labels } from "@/settings-core/src/settings-calendar-availability-labels";
import { SettingsCalendarAvailabilitySection } from "@/settings-core/src/settings-calendar-availability-section";
import { TooltipProvider } from "@/ui/tooltip";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const clipboard = vi.hoisted(() => ({ copy: vi.fn(async () => true) }));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ showSuccess: toast.success, showError: toast.error }),
}));
vi.mock("@/share-ui/share-path-utils", () => ({ copyShareText: clipboard.copy }));

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

function renderSection(publicLinkOperations: CalendarAvailabilityPublicLinkOperations) {
  return render(
    <TooltipProvider>
      <SettingsCalendarAvailabilitySection
        operations={createMockCalendarAvailabilitySettingsOperations()}
        publicLinkOperations={publicLinkOperations}
      />
    </TooltipProvider>,
  );
}

const address = () =>
  screen.getByRole<HTMLInputElement>("textbox", { name: labels.publicLinkAddress });
const toggle = () => screen.findByRole("switch", { name: labels.publicLink });

beforeEach(() => {
  setOnline(true);
  toast.success.mockClear();
  toast.error.mockClear();
  clipboard.copy.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  setOnline(true);
});

describe("public availability link in Settings → Calendar", () => {
  it("is off until turned on, with no address and no calendar list", async () => {
    renderSection(createMockCalendarAvailabilityPublicLinkOperations());
    expect((await toggle()).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("textbox", { name: labels.publicLinkAddress })).toBeNull();
    expect(screen.queryByText(labels.calendarsHeading)).toBeNull();
  });

  it("turns on, shows the address and the calendar choices even with Team sharing off", async () => {
    renderSection(createMockCalendarAvailabilityPublicLinkOperations());
    fireEvent.click(await toggle());

    await waitFor(() => expect(address().value).toMatch(/\/calendars\/availability\/feeds\/\w+$/));
    expect(address().readOnly).toBe(true);
    expect(screen.getByText(labels.calendarsHeading)).toBeTruthy();
    expect(screen.getByText(labels.calendarsHint)).toBeTruthy();
    expect(screen.getByRole("switch", { name: labels.switch }).getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(toast.success).toHaveBeenCalledWith(labels.publicLinkOn);
  });

  it("copies the address", async () => {
    renderSection(
      createMockCalendarAvailabilityPublicLinkOperations({
        enabled: true,
        httpsUrl: "https://workspace.example/api/v1/calendars/availability/feeds/abc",
        webcalUrl: "webcal://workspace.example/api/v1/calendars/availability/feeds/abc",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: labels.publicLinkCopy }));

    await waitFor(() =>
      expect(clipboard.copy).toHaveBeenCalledWith(
        "https://workspace.example/api/v1/calendars/availability/feeds/abc",
      ),
    );
    expect(toast.success).toHaveBeenCalledWith(labels.publicLinkCopied);
  });

  it("asks before turning off, and Cancel leaves the link as it was", async () => {
    const operations = createMockCalendarAvailabilityPublicLinkOperations();
    const turnOff = vi.spyOn(operations, "turnOff");
    renderSection(operations);
    fireEvent.click(await toggle());
    await waitFor(() => address());
    const before = address().value;

    fireEvent.click(screen.getByRole("switch", { name: labels.publicLink }));
    expect(await screen.findByText(labels.turnOffTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.cancel }));

    await waitFor(() => expect(screen.queryByText(labels.turnOffTitle)).toBeNull());
    expect(turnOff).not.toHaveBeenCalled();
    expect(address().value).toBe(before);
  });

  it("turns off after confirming and hides the address", async () => {
    const operations = createMockCalendarAvailabilityPublicLinkOperations();
    renderSection(operations);
    fireEvent.click(await toggle());
    await waitFor(() => address());

    fireEvent.click(screen.getByRole("switch", { name: labels.publicLink }));
    fireEvent.click(await screen.findByRole("button", { name: labels.turnOffConfirm }));

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: labels.publicLinkAddress })).toBeNull(),
    );
    expect(await operations.load()).toEqual({ enabled: false });
    expect(toast.success).toHaveBeenLastCalledWith(labels.publicLinkOff);
  });

  it("makes a new link after confirming; the address changes", async () => {
    renderSection(createMockCalendarAvailabilityPublicLinkOperations());
    fireEvent.click(await toggle());
    await waitFor(() => address());
    const before = address().value;

    fireEvent.click(screen.getByRole("button", { name: labels.publicLinkNew }));
    expect(await screen.findByText(labels.newLinkTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.newLinkConfirm }));

    await waitFor(() => expect(address().value).not.toBe(before));
    expect(toast.success).toHaveBeenLastCalledWith(labels.publicLinkRegenerated);
  });

  it("keeps the address when the regenerate confirm is cancelled", async () => {
    const operations = createMockCalendarAvailabilityPublicLinkOperations();
    const regenerate = vi.spyOn(operations, "regenerate");
    renderSection(operations);
    fireEvent.click(await toggle());
    await waitFor(() => address());
    const before = address().value;

    fireEvent.click(screen.getByRole("button", { name: labels.publicLinkNew }));
    expect(await screen.findByText(labels.newLinkDescription)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.cancel }));

    await waitFor(() => expect(screen.queryByText(labels.newLinkTitle)).toBeNull());
    expect(regenerate).not.toHaveBeenCalled();
    expect(address().value).toBe(before);
  });

  it("starts no read while a new link is in flight, so the old address never comes back", async () => {
    const link = (id: string) => ({
      enabled: true,
      httpsUrl: `https://workspace.example/api/v1/calendars/availability/feeds/${id}`,
      webcalUrl: `webcal://workspace.example/api/v1/calendars/availability/feeds/${id}`,
    });
    const operations = createMockCalendarAvailabilityPublicLinkOperations(link("old"));
    let finish: (value: ReturnType<typeof link>) => void = () => {};
    vi.spyOn(operations, "regenerate").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const load = vi.spyOn(operations, "load");
    renderSection(operations);
    await waitFor(() => expect(address().value).toBe(link("old").httpsUrl));

    fireEvent.click(screen.getByRole("button", { name: labels.publicLinkNew }));
    fireEvent.click(await screen.findByRole("button", { name: labels.newLinkConfirm }));
    const reads = load.mock.calls.length;
    fireEvent.focus(window);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(load.mock.calls.length).toBe(reads);

    finish(link("new"));
    await waitFor(() => expect(address().value).toBe(link("new").httpsUrl));
    expect(load.mock.calls.length).toBe(reads);
  });

  it("puts the public link below the calendar list", async () => {
    renderSection(createMockCalendarAvailabilityPublicLinkOperations());
    fireEvent.click(await toggle());
    await waitFor(() => address());
    const calendars = screen.getByRole("heading", { name: labels.calendarsHeading });
    const publicLink = screen.getByRole("switch", { name: labels.publicLink });
    expect(
      calendars.compareDocumentPosition(publicLink) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows an error toast and keeps the state when the server refuses", async () => {
    const operations = createMockCalendarAvailabilityPublicLinkOperations();
    vi.spyOn(operations, "turnOn").mockRejectedValue(new WgwRequestError("boom", 500));
    renderSection(operations);
    fireEvent.click(await toggle());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(labels.publicLinkSaveError));
    expect((await toggle()).getAttribute("aria-checked")).toBe("false");
  });

  it("reads nothing offline: the card says it needs a connection", async () => {
    setOnline(false);
    const operations = createMockCalendarAvailabilityPublicLinkOperations();
    const load = vi.spyOn(operations, "load");
    renderSection(operations);

    expect(await screen.findByText(labels.offline)).toBeTruthy();
    expect(screen.queryByRole("switch", { name: labels.publicLink })).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("says it needs a connection when the connection drops after the card loaded", async () => {
    const operations = createMockCalendarAvailabilityPublicLinkOperations();
    renderSection(operations);
    const link = await toggle();
    setOnline(false);
    fireEvent.click(link);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(labels.publicLinkSaveOffline));
    expect(await operations.load()).toEqual({ enabled: false });
  });

  it("offers a retry when the link cannot be read", async () => {
    const operations = createMockCalendarAvailabilityPublicLinkOperations();
    vi.spyOn(operations, "load").mockRejectedValueOnce(new WgwRequestError("down", 500));
    renderSection(operations);

    expect(await screen.findByText(labels.publicLinkLoadError)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: labels.retry })[0]);
    expect(await toggle()).toBeTruthy();
  });
});
