import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalendarCalendarDialog,
  DEFAULT_CALENDAR_COLOR,
} from "@/calendar-core/src/calendar-calendar-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { shareLabels } from "@/share-ui/share-labels";
import { TooltipProvider } from "@/ui/tooltip";

function renderDialog(ui: ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

const groups = [
  { slug: "team", displayName: "Team" },
  { slug: "studio", displayName: "Studio Crew" },
];

describe("CalendarCalendarDialog", () => {
  beforeEach(() => {
    cleanup();
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
  });

  it("submits trimmed create payload with personal directory", () => {
    const onConfirm = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{ mode: "create" }}
        groups={groups}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.calendarNameLabel), {
      target: { value: "  Launch  " },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.save }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Launch",
      color: DEFAULT_CALENDAR_COLOR,
      groupSlug: null,
    });
  });

  it("submits group directory when a group is selected from the Owner dropdown", () => {
    const onConfirm = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{ mode: "create" }}
        groups={groups}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.calendarNameLabel), {
      target: { value: "Roadmap" },
    });
    const ownerSelect = screen.getByRole("combobox", {
      name: defaultCalendarLabels.calendarDirectoryLabel,
    });
    expect(ownerSelect.textContent).toContain("Only Me");
    fireEvent.click(ownerSelect);
    fireEvent.click(
      screen.getByRole("option", {
        name: defaultCalendarLabels.calendarDirectoryGroup("Team"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.save }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Roadmap",
      color: DEFAULT_CALENDAR_COLOR,
      groupSlug: "team",
    });
  });

  it("still shows the Owner dropdown when the user has no groups", () => {
    renderDialog(
      <CalendarCalendarDialog
        dialog={{ mode: "create" }}
        groups={[]}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const ownerSelect = screen.getByRole("combobox", {
      name: defaultCalendarLabels.calendarDirectoryLabel,
    });
    expect(ownerSelect.textContent).toContain("Only Me");
  });

  it("lets the owner change directory on edit", () => {
    const onConfirm = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "roadmap",
          name: "Roadmap",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: true,
          scope: "personal",
          canChangeOwner: true,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const ownerSelect = screen.getByRole("combobox", {
      name: defaultCalendarLabels.calendarDirectoryLabel,
    });
    expect(ownerSelect).toHaveProperty("disabled", false);
    fireEvent.click(ownerSelect);
    fireEvent.click(
      screen.getByRole("option", {
        name: defaultCalendarLabels.calendarDirectoryGroup("Team"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.save }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Roadmap",
      color: DEFAULT_CALENDAR_COLOR,
      groupSlug: "team",
    });
  });

  it("shows the same Owner dropdown disabled on edit", () => {
    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "cal-1",
          name: "Team sync",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: false,
          scope: "group",
          groupSlug: "team",
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const ownerSelect = screen.getByRole("combobox", {
      name: defaultCalendarLabels.calendarDirectoryLabel,
    });
    expect(ownerSelect).toHaveProperty("disabled", true);
    expect(ownerSelect.textContent).toContain("Team (Group)");

    fireEvent.click(ownerSelect);
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("submits a subscribe payload with URL and optional name", () => {
    const onConfirm = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{ mode: "subscribe" }}
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.subscribeUrlLabel), {
      target: { value: "webcal://feeds.example.test/holidays.ics" },
    });
    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.calendarNameLabel), {
      target: { value: "Company Holidays" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.subscribeCalendar }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Company Holidays",
      color: DEFAULT_CALENDAR_COLOR,
      groupSlug: null,
      url: "webcal://feeds.example.test/holidays.ics",
      nameTouched: true,
    });
  });

  it("prefills the name from the URL and does not overwrite a user edit", () => {
    const onConfirm = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{ mode: "subscribe" }}
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.subscribeUrlLabel), {
      target: { value: "https://feeds.example.test/us-public-holidays.ics" },
    });
    expect(
      (screen.getByLabelText(defaultCalendarLabels.calendarNameLabel) as HTMLInputElement).value,
    ).toBe("Us Public Holidays");

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.calendarNameLabel), {
      target: { value: "My Holidays" },
    });
    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.subscribeUrlLabel), {
      target: { value: "https://other.example.test/other.ics" },
    });
    expect(
      (screen.getByLabelText(defaultCalendarLabels.calendarNameLabel) as HTMLInputElement).value,
    ).toBe("My Holidays");

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.subscribeCalendar }));
    expect(onConfirm).toHaveBeenCalledWith({
      name: "My Holidays",
      color: DEFAULT_CALENDAR_COLOR,
      groupSlug: null,
      url: "https://other.example.test/other.ics",
      nameTouched: true,
    });
  });

  it("submits an inferred name as untouched so the API can prefer X-WR-CALNAME", () => {
    const onConfirm = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{ mode: "subscribe" }}
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.subscribeUrlLabel), {
      target: { value: "https://feeds.example.test/us-public-holidays.ics" },
    });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.subscribeCalendar }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Us Public Holidays",
      color: DEFAULT_CALENDAR_COLOR,
      groupSlug: null,
      url: "https://feeds.example.test/us-public-holidays.ics",
      nameTouched: false,
    });
  });

  it("lets subscribe pick a team directory", () => {
    const onConfirm = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{ mode: "subscribe" }}
        groups={groups}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.subscribeUrlLabel), {
      target: { value: "https://feeds.example.test/holidays.ics" },
    });
    fireEvent.click(
      screen.getByRole("combobox", {
        name: defaultCalendarLabels.calendarDirectoryLabel,
      }),
    );
    fireEvent.click(
      screen.getByRole("option", {
        name: defaultCalendarLabels.calendarDirectoryGroup("Team"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.subscribeCalendar }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Holidays",
      color: DEFAULT_CALENDAR_COLOR,
      groupSlug: "team",
      url: "https://feeds.example.test/holidays.ics",
      nameTouched: false,
    });
  });

  it("confirms delete on a writable calendar", () => {
    const onDelete = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "work",
          name: "Work",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: true,
        }}
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.deleteCalendar }));
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.delete }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps the source URL read-only on a subscription and offers unsubscribe", () => {
    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "holidays",
          name: "US Holidays",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: true,
          subscriptionId: "sub-holidays",
          sourceUrl: "https://feeds.example.test/holidays.ics",
        }}
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const url = screen.getByLabelText(defaultCalendarLabels.subscribeUrlLabel) as HTMLInputElement;
    expect(url.value).toBe("https://feeds.example.test/holidays.ics");
    expect(url).toHaveProperty("readOnly", true);
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.unsubscribeCalendar }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(defaultCalendarLabels.publishCalendarTitle)).toBeNull();
  });

  it("shows the publish section on an owned personal calendar", () => {
    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "default",
          name: "Personal",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: true,
          canPublish: true,
        }}
        labels={defaultCalendarLabels}
        publish={{
          feed: {
            httpsUrl: "https://example.test/api/v1/calendars/feeds/abc",
            webcalUrl: "webcal://example.test/api/v1/calendars/feeds/abc",
          },
          onToggle: vi.fn(),
          onCopyHttps: vi.fn(),
        }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(defaultCalendarLabels.publishCalendarTitle)).toBeTruthy();
    expect(
      (screen.getByLabelText(defaultCalendarLabels.publishCalendarHttpsLabel) as HTMLInputElement)
        .value,
    ).toBe("https://example.test/api/v1/calendars/feeds/abc");
  });

  it("shows team access on an owned calendar and hides it for a sharee", () => {
    const share = {
      calendar: {
        id: "default",
        name: "Personal",
        color: DEFAULT_CALENDAR_COLOR,
        mayShare: true,
        shareWith: {
          alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
        },
      },
      knownPrincipals: [{ id: "alice", displayName: "Alice", principalType: "user" as const }],
      onSearchPrincipals: vi.fn(async () => []),
      onPatchShareWith: vi.fn(async () => {}),
    };

    const { rerender } = renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "default",
          name: "Personal",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: true,
          canPublish: true,
        }}
        labels={defaultCalendarLabels}
        publish={{
          feed: null,
          onToggle: vi.fn(),
          onCopyHttps: vi.fn(),
        }}
        share={share}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(defaultCalendarLabels.publishCalendarTitle)).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.shareCalendarSectionTitle)).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();

    rerender(
      <TooltipProvider delayDuration={0}>
        <CalendarCalendarDialog
          dialog={{
            mode: "edit",
            calendarId: "shared",
            name: "Shared write",
            color: DEFAULT_CALENDAR_COLOR,
            mayDelete: false,
          }}
          labels={defaultCalendarLabels}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByText(defaultCalendarLabels.shareCalendarSectionTitle)).toBeNull();
    expect(screen.queryByLabelText(defaultCalendarLabels.publishCalendarTitle)).toBeNull();
  });

  it("shows public feed and team access on a group calendar", () => {
    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "group-editorial",
          name: "Editorial",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: false,
          scope: "group",
          groupSlug: "editorial",
          canPublish: true,
        }}
        labels={defaultCalendarLabels}
        publish={{
          feed: null,
          onToggle: vi.fn(),
          onCopyHttps: vi.fn(),
        }}
        share={{
          calendar: {
            id: "group-editorial",
            name: "Editorial",
            color: DEFAULT_CALENDAR_COLOR,
            scope: "group",
            groupSlug: "editorial",
            mayShare: true,
            mayWrite: true,
          },
          knownPrincipals: [],
          onSearchPrincipals: vi.fn(async () => []),
          onPatchShareWith: vi.fn(async () => {}),
        }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(defaultCalendarLabels.publishCalendarTitle)).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.shareCalendarSectionTitle)).toBeTruthy();
  });

  it("adds, edits, and revokes team access from the edit calendar surface", async () => {
    const onPatchShareWith = vi.fn(async () => {});
    const onSearchPrincipals = vi.fn(async (query: string) =>
      query.toLowerCase().includes("bob")
        ? [{ id: "bob", displayName: "Bob", principalType: "user" as const }]
        : [],
    );

    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "default",
          name: "Personal",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: true,
          canPublish: true,
        }}
        labels={defaultCalendarLabels}
        share={{
          calendar: {
            id: "default",
            name: "Personal",
            color: DEFAULT_CALENDAR_COLOR,
            mayShare: true,
            shareWith: {
              alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
            },
          },
          knownPrincipals: [
            { id: "alice", displayName: "Alice", principalType: "user" },
            { id: "bob", displayName: "Bob", principalType: "user" },
          ],
          onSearchPrincipals,
          onPatchShareWith,
        }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText(defaultCalendarLabels.shareCalendarAddPlaceholder),
      { target: { value: "bob" } },
    );
    await waitFor(() => expect(onSearchPrincipals).toHaveBeenCalledWith("bob"));
    fireEvent.mouseDown(screen.getByRole("option", { name: /Bob/ }));
    await waitFor(() => {
      expect(onPatchShareWith).toHaveBeenCalledWith("default", {
        bob: expect.objectContaining({ mayWrite: false, mayWriteAll: false }),
      });
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Can view" }));
    fireEvent.click(screen.getByRole("option", { name: "Can edit" }));
    await waitFor(() => {
      expect(onPatchShareWith).toHaveBeenCalledWith("default", {
        alice: expect.objectContaining({ mayWrite: true, mayWriteAll: true }),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: shareLabels.removeGrant }));
    fireEvent.click(screen.getByRole("button", { name: shareLabels.confirmContinue }));
    await waitFor(() => {
      expect(onPatchShareWith).toHaveBeenCalledWith("default", { alice: null });
    });
  });

  it("blocks team-access mutations while offline", () => {
    const onPatchShareWith = vi.fn(async () => {});

    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "default",
          name: "Personal",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: true,
        }}
        labels={defaultCalendarLabels}
        share={{
          calendar: {
            id: "default",
            name: "Personal",
            color: DEFAULT_CALENDAR_COLOR,
            mayShare: true,
            shareWith: {
              alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
            },
          },
          knownPrincipals: [{ id: "alice", displayName: "Alice", principalType: "user" }],
          online: false,
          onSearchPrincipals: vi.fn(async () => []),
          onPatchShareWith,
        }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(defaultCalendarLabels.shareCalendarOffline)).toBeTruthy();
    expect(
      (
        screen.getByPlaceholderText(
          defaultCalendarLabels.shareCalendarAddPlaceholder,
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: shareLabels.removeGrant }));
    expect(screen.queryByRole("button", { name: shareLabels.confirmContinue })).toBeNull();
    expect(onPatchShareWith).not.toHaveBeenCalled();
  });

  it("lets a sharee rename and recolor their instance", () => {
    const onConfirm = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "family",
          name: "Family",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: false,
          removeShared: true,
        }}
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const nameInput = screen.getByLabelText(
      defaultCalendarLabels.calendarNameLabel,
    ) as HTMLInputElement;
    expect(nameInput.disabled).toBe(false);
    expect(nameInput.readOnly).toBe(false);
    fireEvent.change(nameInput, { target: { value: "Family (mine)" } });

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.calendarColorLabel }));
    const colorInput = screen.getByLabelText("Custom color") as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: "#ef4444" } });
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.save }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Family (mine)",
      color: "#ef4444",
    });
  });

  it("offers Remove calendar for a sharee instead of Delete", () => {
    const onDelete = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "family",
          name: "Family",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: true,
          removeShared: true,
        }}
        labels={defaultCalendarLabels}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onDelete={onDelete}
      />,
    );

    expect(screen.queryByRole("button", { name: defaultCalendarLabels.deleteCalendar })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.removeSharedCalendar }),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: defaultCalendarLabels.removeSharedCalendar }).at(-1)!,
    );
    expect(onDelete).toHaveBeenCalled();
  });

  it("keeps the dialog open when the native color well changes", async () => {
    const onClose = vi.fn();

    renderDialog(
      <CalendarCalendarDialog
        dialog={{
          mode: "edit",
          calendarId: "cal-1",
          name: "Calendar",
          color: DEFAULT_CALENDAR_COLOR,
          mayDelete: false,
        }}
        groups={groups}
        personalOwnerLabel="Demo User"
        labels={defaultCalendarLabels}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.calendarColorLabel }));
    const colorInput = screen.getByLabelText("Custom color") as HTMLInputElement;
    expect(colorInput).toBeTruthy();
    expect(colorInput.getAttribute("type")).toBe("color");

    fireEvent.focus(colorInput);
    fireEvent.input(colorInput, { target: { value: "#31c75c" } });
    fireEvent.change(colorInput, { target: { value: "#31c75c" } });

    expect(onClose).not.toHaveBeenCalled();
    expect(colorInput.isConnected).toBe(true);
    expect(
      screen.getByRole("heading", { name: defaultCalendarLabels.editCalendarTitle }),
    ).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(document.documentElement);

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: defaultCalendarLabels.editCalendarTitle }),
    ).toBeTruthy();
  });
});
