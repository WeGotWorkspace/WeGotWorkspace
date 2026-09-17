import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarMeetChannelEmailDialog } from "@/calendar-core/src/calendar-meet-channel-email-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";

describe("CalendarMeetChannelEmailDialog", () => {
  beforeEach(() => {
    cleanup();
  });

  it("offers ignore, strip emails, and a primary meeting-link action in the footer", () => {
    const onChoice = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CalendarMeetChannelEmailDialog
        open
        labels={defaultCalendarLabels}
        onOpenChange={onOpenChange}
        onChoice={onChoice}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(defaultCalendarLabels.eventMeetChannelEmailTitle);
    expect(dialog.textContent).toContain(defaultCalendarLabels.eventMeetChannelEmailDescription);
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.cancel })).toBeNull();
    expect(dialog.querySelector(".calendar-meet-channel-email-dialog__footer")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.eventMeetChannelEmailKeepBoth }),
    );
    expect(onChoice).toHaveBeenCalledWith("keep-both");
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.eventMeetChannelEmailStripEmails }),
    );
    expect(onChoice).toHaveBeenCalledWith("strip-emails");
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.eventMeetChannelEmailReplaceLink }),
    );
    expect(onChoice).toHaveBeenCalledWith("replace-with-room");
    const ignore = screen.getByRole("button", {
      name: defaultCalendarLabels.eventMeetChannelEmailKeepBoth,
    });
    const stripEmails = screen.getByRole("button", {
      name: defaultCalendarLabels.eventMeetChannelEmailStripEmails,
    });
    const meetingLink = screen.getByRole("button", {
      name: defaultCalendarLabels.eventMeetChannelEmailReplaceLink,
    });
    expect(ignore.className).toContain("calendar-meet-channel-email-dialog__action");
    expect(ignore.className).not.toMatch(/button--variant-primary/);
    expect(stripEmails.className).not.toMatch(/button--variant-primary/);
    expect(meetingLink.className).toMatch(/button--variant-primary/);
    expect(ignore.textContent).toBe("Ignore");
    expect(stripEmails.textContent).toBe("Remove Email Invites");
    expect(meetingLink.textContent).toBe("Use Meeting Link");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
