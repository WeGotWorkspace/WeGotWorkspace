import { afterEach, describe, expect, it, vi } from "vitest";
import type { DropdownOption } from "../types/Dropdown.js";
import { Dropdown } from "./Dropdown";
import "./Dropdown";

const OPTIONS: DropdownOption[] = [
  { label: "Day", value: "day", hotkey: "d" },
  { label: "Week", value: "week", hotkey: "w" },
  { label: "Year", value: "year", hotkey: "y", disabled: true },
];

async function mount(configure: (el: Dropdown) => void = () => {}): Promise<Dropdown> {
  const el = document.createElement("lc-dropdown") as Dropdown;
  configure(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

function select(el: Dropdown): HTMLSelectElement {
  const node = el.shadowRoot?.querySelector("select");
  expect(node).toBeInstanceOf(HTMLSelectElement);
  return node as HTMLSelectElement;
}

function optionValues(el: Dropdown): string[] {
  return [...select(el).options].map((option) => option.value);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("lc-dropdown rendering", () => {
  it("shows a disabled placeholder while nothing is selected", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.placeholder = "Pick a view";
    });

    expect(select(el).dataset.state).toBe("placeholder");
    expect(select(el).options[0].disabled).toBe(true);
    expect(select(el).options[0].textContent?.trim()).toBe("Pick a view");
    expect(select(el).value).toBe("");
  });

  it("drops the placeholder once a listed option is selected", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.value = "week";
    });

    expect(select(el).dataset.state).toBe("selected");
    expect(optionValues(el)).toEqual(["day", "week", "year"]);
    expect(select(el).value).toBe("week");
  });

  it("accepts plain strings as option label and value", async () => {
    const el = await mount((node) => (node.options = ["grid", "list"]));
    expect(optionValues(el)).toEqual(["", "grid", "list"]);
  });

  it("carries the disabled flag onto the matching option", async () => {
    const el = await mount((node) => (node.options = OPTIONS));
    expect([...select(el).options].map((option) => option.disabled)).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  it("names the control and forwards its own shortcut", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.name = "view";
      node.setAttribute("aria-label", "Calendar view");
      node.hotkey = "V";
    });

    expect(select(el).name).toBe("view");
    expect(select(el).ariaLabel).toBe("Calendar view");
    expect(select(el).ariaKeyShortcuts).toBe("v");
  });

  it("disables the control when the host is disabled", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.disabled = true;
    });
    expect(select(el).disabled).toBe(true);
  });

  it("renders a chevron unless an icon is slotted in", async () => {
    const withChevron = await mount((node) => (node.options = OPTIONS));
    expect(withChevron.shadowRoot?.querySelector("[data-role='chevron']")).toBeTruthy();
    expect(withChevron.shadowRoot?.querySelector("[data-role='icon']")).toBeNull();

    const withIcon = await mount((node) => {
      node.options = OPTIONS;
      const icon = document.createElement("span");
      icon.slot = "icon";
      node.append(icon);
    });
    expect(withIcon.shadowRoot?.querySelector("[data-role='icon']")).toBeTruthy();
    expect(withIcon.shadowRoot?.querySelector("[data-role='chevron']")).toBeNull();
  });
});

describe("lc-dropdown value", () => {
  it("adopts the value a user picks and announces the change", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.value = "day";
    });
    const onChange = vi.fn();
    el.addEventListener("value-changed", onChange);

    select(el).value = "week";
    select(el).dispatchEvent(new Event("change"));
    await el.updateComplete;

    expect(el.value).toBe("week");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("treats a null value as empty", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.value = null as unknown as string;
    });
    expect(el.value).toBe("");
  });

  it("falls back to the placeholder when the value names no option", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.value = "decade";
    });

    expect(el.value).toBe("decade");
    expect(select(el).value).toBe("");
  });

  it("re-syncs the control when the option list changes under a kept value", async () => {
    const el = await mount((node) => {
      node.options = [{ label: "Day", value: "day" }];
      node.value = "week";
    });
    expect(select(el).value).toBe("");

    el.options = OPTIONS;
    await el.updateComplete;
    expect(select(el).value).toBe("week");
  });
});

describe("lc-dropdown focus styling", () => {
  it("marks pointer-driven focus and clears it on keyboard interaction", async () => {
    const el = await mount((node) => (node.options = OPTIONS));
    const control = select(el);

    control.dispatchEvent(new Event("pointerdown"));
    control.dispatchEvent(new FocusEvent("focus"));
    expect(control.getAttribute("data-pointer-focus")).toBe("true");

    control.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(control.hasAttribute("data-pointer-focus")).toBe(false);
  });

  it("leaves keyboard focus unmarked and clears the mark on blur", async () => {
    const el = await mount((node) => (node.options = OPTIONS));
    const control = select(el);

    control.dispatchEvent(new FocusEvent("focus"));
    expect(control.hasAttribute("data-pointer-focus")).toBe(false);

    control.dispatchEvent(new Event("pointerdown"));
    control.dispatchEvent(new FocusEvent("focus"));
    control.dispatchEvent(new FocusEvent("blur"));
    expect(control.hasAttribute("data-pointer-focus")).toBe(false);
  });

  it("keeps the pointer mark for keys that are not navigation", async () => {
    const el = await mount((node) => (node.options = OPTIONS));
    const control = select(el);

    control.dispatchEvent(new Event("pointerdown"));
    control.dispatchEvent(new FocusEvent("focus"));
    control.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

    expect(control.getAttribute("data-pointer-focus")).toBe("true");
  });
});

describe("lc-dropdown hotkeys", () => {
  it("picks the option whose hotkey was pressed and focuses the control", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.value = "day";
    });

    const event = new KeyboardEvent("keydown", { key: "w", cancelable: true });
    window.dispatchEvent(event);
    await el.updateComplete;

    expect(el.value).toBe("week");
    expect(event.defaultPrevented).toBe(true);
    expect(el.shadowRoot?.activeElement).toBe(select(el));
  });

  it("ignores the hotkey of a disabled option", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.value = "day";
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));
    await el.updateComplete;

    expect(el.value).toBe("day");
  });

  it("focuses the control on its own hotkey without changing the value", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.value = "day";
      node.hotkey = "v";
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "v", cancelable: true }));
    await el.updateComplete;

    expect(el.value).toBe("day");
    expect(el.shadowRoot?.activeElement).toBe(select(el));
  });

  it("keeps the selection when the pressed option is already selected", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.value = "week";
    });
    const onChange = vi.fn();
    el.addEventListener("value-changed", onChange);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    await el.updateComplete;

    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores unmatched keys, handled events, disabled hosts, and typing in a field", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.value = "day";
      node.hotkey = "v";
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true }));

    const handled = new KeyboardEvent("keydown", { key: "w", cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);

    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));

    el.disabled = true;
    await el.updateComplete;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    await el.updateComplete;

    expect(el.value).toBe("day");
  });

  it("stops listening once removed from the document", async () => {
    const el = await mount((node) => {
      node.options = OPTIONS;
      node.value = "day";
    });
    el.remove();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));

    expect(el.value).toBe("day");
  });
});
