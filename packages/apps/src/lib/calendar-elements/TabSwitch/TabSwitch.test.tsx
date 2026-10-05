import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TabSwitchOption } from "../types/TabSwitch.js";
import { TabSwitch } from "./TabSwitch";
import "./TabSwitch";

async function mount(configure: (el: TabSwitch) => void = () => {}): Promise<TabSwitch> {
  const el = document.createElement("tab-switch") as TabSwitch;
  configure(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

function radios(el: TabSwitch): HTMLInputElement[] {
  return [...(el.shadowRoot?.querySelectorAll<HTMLInputElement>("input[type='radio']") ?? [])];
}

function labels(el: TabSwitch): HTMLLabelElement[] {
  return [...(el.shadowRoot?.querySelectorAll<HTMLLabelElement>("label") ?? [])];
}

const VIEW_OPTIONS: TabSwitchOption[] = [
  { label: "Day", value: "day", hotkey: "d" },
  { label: "Week", value: "week", hotkey: "w" },
];

afterEach(() => {
  document.body.replaceChildren();
});

describe("tab-switch rendering", () => {
  it("renders an empty radiogroup with the default name", async () => {
    const group = (await mount()).shadowRoot?.querySelector("[role='radiogroup']");
    expect(group?.getAttribute("aria-label")).toBe("Options");
    expect(group?.querySelectorAll("input")).toHaveLength(0);
  });

  it("renders one radio per option and checks the selected one", async () => {
    const el = await mount((node) => {
      node.options = VIEW_OPTIONS;
      node.value = "week";
    });

    expect(radios(el).map((input) => input.value)).toEqual(["day", "week"]);
    expect(radios(el).map((input) => input.checked)).toEqual([false, true]);
  });

  it("accepts plain strings as option label and value", async () => {
    const el = await mount((node) => (node.options = ["grid", "list"]));

    expect(radios(el).map((input) => input.value)).toEqual(["grid", "list"]);
    expect(labels(el).map((label) => label.textContent?.trim())).toEqual(["grid", "list"]);
  });

  it("groups the radios under an explicit name when given one", async () => {
    const el = await mount((node) => {
      node.options = VIEW_OPTIONS;
      node.name = "calendar-view";
    });

    expect(radios(el).map((input) => input.name)).toEqual(["calendar-view", "calendar-view"]);
  });

  it("gives each instance its own radio group by default", async () => {
    const first = await mount((node) => (node.options = VIEW_OPTIONS));
    const second = await mount((node) => (node.options = VIEW_OPTIONS));

    expect(radios(first)[0].name).not.toBe(radios(second)[0].name);
  });

  it("uses group-label for the radiogroup name", async () => {
    const el = await mount((node) => node.setAttribute("group-label", "Calendar view"));
    expect(el.shadowRoot?.querySelector("[role='radiogroup']")?.getAttribute("aria-label")).toBe(
      "Calendar view",
    );
  });

  it("migrates a deprecated host aria-label off the host", async () => {
    const el = await mount((node) => node.setAttribute("aria-label", "Legacy label"));

    expect(el.hasAttribute("aria-label")).toBe(false);
    expect(el.shadowRoot?.querySelector("[role='radiogroup']")?.getAttribute("aria-label")).toBe(
      "Legacy label",
    );
  });

  it("keeps group-label when a host aria-label is also present", async () => {
    const el = await mount((node) => {
      node.setAttribute("group-label", "Calendar view");
      node.setAttribute("aria-label", "Legacy label");
    });

    expect(el.shadowRoot?.querySelector("[role='radiogroup']")?.getAttribute("aria-label")).toBe(
      "Calendar view",
    );
  });
});

describe("tab-switch option naming", () => {
  it("leaves the radio unlabelled when the option label is readable text", async () => {
    const el = await mount((node) => (node.options = VIEW_OPTIONS));
    expect(radios(el)[0].hasAttribute("aria-label")).toBe(false);
  });

  it("names a markup-only option from its ariaLabel", async () => {
    const el = await mount(
      (node) => (node.options = [{ label: html`<svg></svg>`, value: "grid", ariaLabel: "Grid" }]),
    );

    expect(radios(el)[0].getAttribute("aria-label")).toBe("Grid");
  });

  it("falls back to the value when a markup-only option has no ariaLabel", async () => {
    const el = await mount(
      (node) => (node.options = [{ label: html`<svg></svg>`, value: "grid" }]),
    );

    expect(radios(el)[0].getAttribute("aria-label")).toBe("grid");
  });

  it("appends the hotkey to the option title", async () => {
    const el = await mount((node) => (node.options = VIEW_OPTIONS));

    expect(labels(el).map((label) => label.title)).toEqual(["Day (D)", "Week (W)"]);
  });

  it("titles an icon option with its ariaLabel", async () => {
    const el = await mount(
      (node) => (node.options = [{ label: html`<svg></svg>`, value: "grid", ariaLabel: "Grid" }]),
    );

    expect(labels(el)[0].title).toBe("Grid");
  });

  it("publishes the hotkey on the radio only while hotkeys are shown", async () => {
    const shown = await mount((node) => (node.options = VIEW_OPTIONS));
    expect(radios(shown)[0].getAttribute("aria-keyshortcuts")).toBe("d");

    const hidden = await mount((node) => {
      node.options = VIEW_OPTIONS;
      node.showHotkeys = false;
    });
    expect(radios(hidden)[0].hasAttribute("aria-keyshortcuts")).toBe(false);
  });
});

describe("tab-switch selection", () => {
  it("adopts the value a user picks and announces the change", async () => {
    const el = await mount((node) => {
      node.options = VIEW_OPTIONS;
      node.value = "day";
    });
    const onChange = vi.fn();
    el.addEventListener("value-changed", onChange);

    radios(el)[1].click();
    await el.updateComplete;

    expect(el.value).toBe("week");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("treats a null value as empty and keeps the radios unchecked", async () => {
    const el = await mount((node) => {
      node.options = VIEW_OPTIONS;
      node.value = null as unknown as string;
    });

    expect(el.value).toBe("");
    expect(radios(el).some((input) => input.checked)).toBe(false);
  });
});

describe("tab-switch hotkeys", () => {
  it("selects the matching option when its plain character is pressed", async () => {
    const el = await mount((node) => {
      node.options = VIEW_OPTIONS;
      node.value = "day";
    });

    const event = new KeyboardEvent("keydown", { key: "w", cancelable: true });
    window.dispatchEvent(event);
    await el.updateComplete;

    expect(el.value).toBe("week");
    expect(event.defaultPrevented).toBe(true);
  });

  it("does nothing when the pressed option is already selected", async () => {
    const el = await mount((node) => {
      node.options = VIEW_OPTIONS;
      node.value = "week";
    });
    const onChange = vi.fn();
    el.addEventListener("value-changed", onChange);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    await el.updateComplete;

    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores unmatched keys, handled events, and typing in a field", async () => {
    const el = await mount((node) => {
      node.options = VIEW_OPTIONS;
      node.value = "day";
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", metaKey: true }));

    const handled = new KeyboardEvent("keydown", { key: "w", cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);

    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    await el.updateComplete;

    expect(el.value).toBe("day");
  });

  it("stops listening once removed from the document", async () => {
    const el = await mount((node) => {
      node.options = VIEW_OPTIONS;
      node.value = "day";
    });
    el.remove();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));

    expect(el.value).toBe("day");
  });
});
