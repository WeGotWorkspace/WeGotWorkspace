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
        onCopyWebcal={vi.fn()}
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

  it("asks before unpublishing and copies both URLs", () => {
    const onToggle = vi.fn();
    const onCopyHttps = vi.fn();
    const onCopyWebcal = vi.fn();
    renderSection({ feed, onToggle, onCopyHttps, onCopyWebcal });

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.copyHttpsUrl }));
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.copyWebcalUrl }));
    expect(onCopyHttps).toHaveBeenCalled();
    expect(onCopyWebcal).toHaveBeenCalled();

    const toggle = screen.getByRole("group", { name: defaultCalendarLabels.publishCalendarTitle });
    fireEvent.click(toggle.querySelector('button[aria-label="Off"]')!);
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.unpublishCalendarConfirm }),
    );
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
