/** @vitest-environment jsdom */
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarPublishSection } from "@/calendar-core/src/calendar-publish-section";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { TooltipProvider } from "@/ui/tooltip";

const feed = {
  httpsUrl: "https://example.test/api/v1/calendars/feeds/abc",
  webcalUrl: "webcal://example.test/api/v1/calendars/feeds/abc",
  mode: "full" as const,
};

function renderSection(overrides: Partial<ComponentProps<typeof CalendarPublishSection>> = {}) {
  return render(
    <TooltipProvider>
      <CalendarPublishSection
        labels={defaultCalendarLabels}
        feed={null}
        onToggle={vi.fn()}
        onCopyHttps={vi.fn()}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

describe("CalendarPublishSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("publishes when the switch is turned on", () => {
    const onToggle = vi.fn();
    renderSection({ onToggle });

    const toggle = screen.getByRole("switch", { name: defaultCalendarLabels.publishCalendarTitle });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("asks before unpublishing and copies the https URL", () => {
    const onToggle = vi.fn();
    const onCopyHttps = vi.fn();
    renderSection({ feed, onToggle, onCopyHttps });

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.copyHttpsUrl }));
    expect(onCopyHttps).toHaveBeenCalled();

    const httpsField = screen.getByRole("textbox", {
      name: defaultCalendarLabels.publishCalendarHttpsLabel,
    }) as HTMLInputElement;
    expect(httpsField.value).toBe(feed.httpsUrl);
    expect(httpsField.classList.contains("share-dialog__input")).toBe(true);
    expect(httpsField.closest(".share-dialog__link-row")).not.toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: defaultCalendarLabels.openInCalendar })).toBeNull();
    expect(screen.queryByDisplayValue(feed.webcalUrl)).toBeNull();

    const toggle = screen.getByRole("switch", { name: defaultCalendarLabels.publishCalendarTitle });
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.unpublishCalendarConfirm }),
    );
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("switches a published feed to busy only and back", () => {
    const onToggle = vi.fn();
    renderSection({ feed, onToggle });

    const busyOnly = screen.getByRole("switch", {
      name: defaultCalendarLabels.publishCalendarBusyLabel,
    });
    expect(busyOnly.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(busyOnly);
    expect(onToggle).toHaveBeenCalledWith(true, "busy");

    cleanup();
    renderSection({ feed: { ...feed, mode: "busy" }, onToggle });
    fireEvent.click(
      screen.getByRole("switch", { name: defaultCalendarLabels.publishCalendarBusyLabel }),
    );
    expect(onToggle).toHaveBeenCalledWith(true, "full");
  });
});
