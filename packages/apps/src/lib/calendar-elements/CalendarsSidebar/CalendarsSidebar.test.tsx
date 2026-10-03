import { afterEach, describe, expect, it, vi } from "vitest";
import type { Calendar, CalendarsMap } from "@/lib/calendar-engine";
import { CalendarsSidebar } from "./CalendarsSidebar";
import "./CalendarsSidebar";

function calendar(accountId: string, displayName: string, sortOrder?: number): Calendar {
  return {
    accountId,
    url: `https://dav.example/${accountId}/${displayName}`,
    displayName,
    color: "#336699",
    ...(sortOrder === undefined ? {} : { sortOrder }),
  };
}

function calendars(): CalendarsMap {
  return new Map([
    ["work", calendar("acc-a", "Work", 1)],
    ["home", calendar("acc-a", "Home", 2)],
    ["team", calendar("acc-b", "Team")],
  ]);
}

async function mount(configure: (el: CalendarsSidebar) => void = () => {}) {
  const el = document.createElement("calendars-sidebar") as CalendarsSidebar;
  configure(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

function checkboxes(el: CalendarsSidebar): HTMLInputElement[] {
  return [
    ...(el.shadowRoot?.querySelectorAll<HTMLInputElement>(".calendar-visibility-input") ?? []),
  ];
}

function defaultButtons(el: CalendarsSidebar): HTMLButtonElement[] {
  return [...(el.shadowRoot?.querySelectorAll<HTMLButtonElement>(".calendar-default") ?? [])];
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("calendars-sidebar rendering", () => {
  it("renders an empty list when no calendars are set", async () => {
    const el = await mount();

    expect(el.shadowRoot?.querySelector(".calendars-sidebar")).toBeTruthy();
    expect(defaultButtons(el)).toHaveLength(0);
  });

  it("groups calendars under their account heading in sidebar order", async () => {
    const el = await mount((node) => (node.calendars = calendars()));

    const headings = [...(el.shadowRoot?.querySelectorAll(".calendar-account-label") ?? [])].map(
      (node) => node.textContent?.trim(),
    );
    expect(headings).toEqual(["acc-a", "acc-b"]);
    expect(defaultButtons(el).map((button) => button.ariaLabel)).toEqual(["Work", "Home", "Team"]);
  });

  it("links each account heading to its section", async () => {
    const el = await mount((node) => (node.calendars = calendars()));
    const section = el.shadowRoot?.querySelector(".calendar-account-group");

    expect(section?.getAttribute("aria-labelledby")).toBe(
      el.shadowRoot?.querySelector(".calendar-account-label")?.id,
    );
  });

  it("shows every calendar when visibility is unset", async () => {
    const el = await mount((node) => (node.calendars = calendars()));

    expect(checkboxes(el).map((input) => input.checked)).toEqual([true, true, true]);
    expect(el.shadowRoot?.querySelectorAll(".calendar-row--hidden")).toHaveLength(0);
  });

  it("marks calendars outside the visible list as hidden", async () => {
    const el = await mount((node) => {
      node.calendars = calendars();
      node.visibleCalendarIds = ["work"];
    });

    expect(checkboxes(el).map((input) => input.checked)).toEqual([true, false, false]);
    expect(el.shadowRoot?.querySelectorAll(".calendar-row--hidden")).toHaveLength(2);
  });

  it("marks the selected calendar on its radio", async () => {
    const el = await mount((node) => {
      node.calendars = calendars();
      node.selectedCalendarId = "home";
    });

    expect(defaultButtons(el).map((button) => button.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(el.shadowRoot?.querySelectorAll(".calendar-row--selected")).toHaveLength(1);
  });

  it("mirrors a writing direction onto the landmark", async () => {
    const rtl = await mount((node) => (node.dir = "rtl"));
    expect(rtl.shadowRoot?.querySelector(".calendars-sidebar")?.getAttribute("dir")).toBe("rtl");

    const unset = await mount((node) => (node.dir = "auto"));
    expect(unset.shadowRoot?.querySelector(".calendars-sidebar")?.hasAttribute("dir")).toBe(false);
  });
});

describe("calendars-sidebar visibility", () => {
  it("drops a calendar from the visible list when its checkbox is cleared", async () => {
    const el = await mount((node) => (node.calendars = calendars()));
    const onChange = vi.fn();
    el.addEventListener("visibleCalendarIds-changed", onChange);

    checkboxes(el)[1].click();
    await el.updateComplete;

    expect(el.visibleCalendarIds).toEqual(["work", "team"]);
    expect(onChange).toHaveBeenCalled();
  });

  it("adds a calendar back in sidebar order", async () => {
    const el = await mount((node) => {
      node.calendars = calendars();
      node.visibleCalendarIds = ["team"];
    });

    checkboxes(el)[0].click();
    await el.updateComplete;

    expect(el.visibleCalendarIds).toEqual(["work", "team"]);
  });

  it("keeps the visibility toggle from reaching the row", async () => {
    const el = await mount((node) => (node.calendars = calendars()));
    const onRowClick = vi.fn();
    el.shadowRoot?.querySelector(".calendar-row")?.addEventListener("click", onRowClick);

    checkboxes(el)[0].click();
    await el.updateComplete;

    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("calendars-sidebar default calendar", () => {
  it("selects the calendar whose name was activated", async () => {
    const el = await mount((node) => (node.calendars = calendars()));
    const onChange = vi.fn();
    el.addEventListener("selectedCalendarId-changed", onChange);

    defaultButtons(el)[2].click();
    await el.updateComplete;

    expect(el.selectedCalendarId).toBe("team");
    expect(onChange).toHaveBeenCalled();
  });

  it("makes a hidden calendar visible again when it is chosen as the default", async () => {
    const el = await mount((node) => {
      node.calendars = calendars();
      node.visibleCalendarIds = ["work"];
    });

    defaultButtons(el)[1].click();
    await el.updateComplete;

    expect(el.selectedCalendarId).toBe("home");
    expect(el.visibleCalendarIds).toEqual(["work", "home"]);
  });

  it("leaves the selection alone when the calendar is already the default", async () => {
    const el = await mount((node) => {
      node.calendars = calendars();
      node.selectedCalendarId = "work";
    });
    const onChange = vi.fn();
    el.addEventListener("selectedCalendarId-changed", onChange);

    defaultButtons(el)[0].click();
    await el.updateComplete;

    expect(el.selectedCalendarId).toBe("work");
    expect(onChange).not.toHaveBeenCalled();
  });
});
