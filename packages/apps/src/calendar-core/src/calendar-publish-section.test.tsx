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

    const toggle = screen.getByRole("group", { name: defaultCalendarLabels.publishCalendarTitle });
    fireEvent.click(toggle.querySelector('button[aria-label="On"]')!);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("asks before unpublishing, copies the https URL, and opens webcal", () => {
    const onToggle = vi.fn();
    const onCopyHttps = vi.fn();
    renderSection({ feed, onToggle, onCopyHttps });

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.copyHttpsUrl }));
    expect(onCopyHttps).toHaveBeenCalled();

    const openLink = screen.getByRole("link", { name: defaultCalendarLabels.openInCalendar });
    expect(openLink.getAttribute("href")).toBe(feed.webcalUrl);
    expect(screen.queryByDisplayValue(feed.webcalUrl)).toBeNull();

    const toggle = screen.getByRole("group", { name: defaultCalendarLabels.publishCalendarTitle });
    fireEvent.click(toggle.querySelector('button[aria-label="Off"]')!);
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.unpublishCalendarConfirm }),
    );
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
