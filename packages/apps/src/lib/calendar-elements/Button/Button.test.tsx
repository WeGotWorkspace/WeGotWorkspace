import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import "./Button";

async function mount(configure: (el: Button) => void = () => {}): Promise<Button> {
  const el = document.createElement("lc-button") as Button;
  configure(el);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

function innerButton(el: Button): HTMLButtonElement {
  const button = el.shadowRoot?.querySelector("button");
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("lc-button rendering", () => {
  it("renders an enabled button with no disclosure ARIA by default", async () => {
    const button = innerButton(await mount());

    expect(button.type).toBe("button");
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    expect(button.hasAttribute("aria-haspopup")).toBe(false);
    expect(button.hasAttribute("aria-controls")).toBe(false);
  });

  it("forwards the label as the accessible name", async () => {
    const button = innerButton(await mount((el) => (el.label = "Next range")));
    expect(button.ariaLabel).toBe("Next range");
  });

  it("reflects the disabled state onto the inner button", async () => {
    const button = innerButton(await mount((el) => (el.disabled = true)));
    expect(button.disabled).toBe(true);
  });

  it("keeps only submit and reset as alternative button types", async () => {
    expect(innerButton(await mount((el) => (el.type = "submit"))).type).toBe("submit");
    expect(innerButton(await mount((el) => (el.type = "reset"))).type).toBe("reset");
    expect(innerButton(await mount((el) => (el.type = "menu"))).type).toBe("button");
    expect(innerButton(await mount((el) => (el.type = null))).type).toBe("button");
  });

  it("keeps the rendered type when it is set to the value it already has", async () => {
    const el = await mount((node) => (node.type = "submit"));
    el.type = "submit";
    await el.updateComplete;
    expect(innerButton(el).type).toBe("submit");
  });

  it("forwards disclosure state, popup kind, and controlled id", async () => {
    const button = innerButton(
      await mount((el) => {
        el.disclosureExpanded = true;
        el.hasPopup = "dialog";
        el.controlsId = "calendars-dialog";
      }),
    );

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-controls")).toBe("calendars-dialog");
  });

  it("renders aria-expanded false when the disclosure is closed", async () => {
    const button = innerButton(await mount((el) => (el.disclosureExpanded = false)));
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("ignores blank popup and controls values", async () => {
    const button = innerButton(
      await mount((el) => {
        el.hasPopup = "  ";
        el.controlsId = "  ";
      }),
    );

    expect(button.hasAttribute("aria-haspopup")).toBe(false);
    expect(button.hasAttribute("aria-controls")).toBe(false);
  });
});

describe("lc-button hotkey", () => {
  it("publishes the shortcut to assistive tech and the tooltip", async () => {
    const el = await mount((node) => {
      node.hotkey = "special+right";
      node.label = "Next range";
    });
    const button = innerButton(el);

    expect(button.ariaKeyShortcuts).toBe("Control+ArrowRight");
    expect(button.title).toBe("Next range (CTRL+→)");
  });

  it("shows a hotkey badge only when the button has visible text", async () => {
    const withoutText = await mount((node) => (node.hotkey = "w"));
    expect(withoutText.shadowRoot?.querySelector("[data-hotkey-badge]")).toBeNull();

    const withText = await mount((node) => {
      node.hotkey = "w";
      node.textContent = "Week";
    });
    expect(withText.shadowRoot?.querySelector("[data-hotkey-badge]")?.textContent).toBe("W");
  });

  it("clicks the inner button when the hotkey is pressed", async () => {
    const el = await mount((node) => (node.hotkey = "w"));
    const onClick = vi.fn();
    innerButton(el).addEventListener("click", onClick);

    const event = new KeyboardEvent("keydown", { key: "w", cancelable: true });
    window.dispatchEvent(event);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores the hotkey when disabled, already handled, or typed into a field", async () => {
    const el = await mount((node) => (node.hotkey = "w"));
    const onClick = vi.fn();
    innerButton(el).addEventListener("click", onClick);

    const handled = new KeyboardEvent("keydown", { key: "w", cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);

    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));

    el.disabled = true;
    await el.updateComplete;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("ignores keys that do not match the hotkey", async () => {
    const el = await mount((node) => (node.hotkey = "w"));
    const onClick = vi.fn();
    innerButton(el).addEventListener("click", onClick);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("stops listening once removed from the document", async () => {
    const el = await mount((node) => (node.hotkey = "w"));
    const onClick = vi.fn();
    innerButton(el).addEventListener("click", onClick);
    el.remove();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
