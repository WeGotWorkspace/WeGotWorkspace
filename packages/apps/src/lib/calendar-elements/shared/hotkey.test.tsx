import { afterEach, describe, expect, it } from "vitest";
import {
  eventMatchesHotkey,
  getHotkeyDisplay,
  getPlainCharacterHotkey,
  isEditableEventTarget,
  normalizeHotkey,
  toAriaHotkey,
} from "./hotkey.js";

/** `isMacLikePlatform` reads `navigator.platform`; jsdom reports an empty string. */
function setPlatform(platform: string) {
  Object.defineProperty(globalThis.navigator, "platform", {
    value: platform,
    configurable: true,
  });
}

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

afterEach(() => {
  setPlatform("");
  document.body.replaceChildren();
});

describe("normalizeHotkey", () => {
  it("lowercases and trims a value", () => {
    expect(normalizeHotkey("  Special+Left ")).toBe("special+left");
  });

  it("returns undefined for empty input", () => {
    expect(normalizeHotkey(undefined)).toBeUndefined();
    expect(normalizeHotkey(null)).toBeUndefined();
    expect(normalizeHotkey("   ")).toBeUndefined();
  });
});

describe("toAriaHotkey", () => {
  it("returns undefined when there is no hotkey", () => {
    expect(toAriaHotkey("")).toBeUndefined();
  });

  it("expands aliases to the DOM key names aria-keyshortcuts expects", () => {
    expect(toAriaHotkey("cmd+left")).toBe("Meta+ArrowLeft");
    expect(toAriaHotkey("option+shift+down")).toBe("Alt+Shift+ArrowDown");
  });

  it("maps special to Meta on mac and Control elsewhere", () => {
    setPlatform("MacIntel");
    expect(toAriaHotkey("special+right")).toBe("Meta+ArrowRight");
    setPlatform("Win32");
    expect(toAriaHotkey("special+right")).toBe("Control+ArrowRight");
  });

  it("passes an unknown token through unchanged", () => {
    expect(toAriaHotkey("ctrl+k")).toBe("Control+k");
  });
});

describe("getHotkeyDisplay", () => {
  it("returns undefined when there is no hotkey", () => {
    expect(getHotkeyDisplay(null)).toBeUndefined();
  });

  it("uses mac glyphs on a mac platform", () => {
    setPlatform("MacIntel");
    expect(getHotkeyDisplay("special+option+up")).toBe("⌘+OPT+↑");
  });

  it("uses word modifiers elsewhere", () => {
    setPlatform("Win32");
    expect(getHotkeyDisplay("special+option+up")).toBe("CTRL+ALT+↑");
  });

  it("uppercases plain character keys", () => {
    expect(getHotkeyDisplay("shift+k")).toBe("SHIFT+K");
  });
});

describe("isEditableEventTarget", () => {
  it("is false for a non-element target", () => {
    expect(isEditableEventTarget(null)).toBe(false);
    expect(isEditableEventTarget(new EventTarget())).toBe(false);
  });

  it("is true inside inputs, textareas, selects, and contenteditable", () => {
    const host = document.createElement("div");
    host.innerHTML = `<input /><textarea></textarea><select></select>
      <div contenteditable="true"><span id="nested"></span></div><p id="plain"></p>`;
    document.body.append(host);

    expect(isEditableEventTarget(host.querySelector("input"))).toBe(true);
    expect(isEditableEventTarget(host.querySelector("textarea"))).toBe(true);
    expect(isEditableEventTarget(host.querySelector("select"))).toBe(true);
    expect(isEditableEventTarget(host.querySelector("#nested"))).toBe(true);
    expect(isEditableEventTarget(host.querySelector("#plain"))).toBe(false);
  });
});

describe("getPlainCharacterHotkey", () => {
  it("returns the lowercased character for an unmodified key", () => {
    expect(getPlainCharacterHotkey(keydown({ key: "W" }))).toBe("w");
  });

  it("ignores keys held with meta, ctrl, or alt", () => {
    expect(getPlainCharacterHotkey(keydown({ key: "w", metaKey: true }))).toBeUndefined();
    expect(getPlainCharacterHotkey(keydown({ key: "w", ctrlKey: true }))).toBeUndefined();
    expect(getPlainCharacterHotkey(keydown({ key: "w", altKey: true }))).toBeUndefined();
  });

  it("ignores named keys", () => {
    expect(getPlainCharacterHotkey(keydown({ key: "ArrowLeft" }))).toBeUndefined();
  });
});

describe("eventMatchesHotkey", () => {
  it("is false without a hotkey or without a non-modifier key in it", () => {
    expect(eventMatchesHotkey(keydown({ key: "w" }), "")).toBe(false);
    expect(eventMatchesHotkey(keydown({ key: "w" }), "ctrl+shift")).toBe(false);
  });

  it("matches a plain character key", () => {
    expect(eventMatchesHotkey(keydown({ key: "W" }), "w")).toBe(true);
    expect(eventMatchesHotkey(keydown({ key: "d" }), "w")).toBe(false);
  });

  it("requires every named modifier to match", () => {
    expect(eventMatchesHotkey(keydown({ key: "ArrowLeft", metaKey: true }), "cmd+left")).toBe(true);
    expect(eventMatchesHotkey(keydown({ key: "ArrowLeft" }), "cmd+left")).toBe(false);
    expect(eventMatchesHotkey(keydown({ key: "ArrowLeft", ctrlKey: true }), "cmd+left")).toBe(
      false,
    );
    expect(eventMatchesHotkey(keydown({ key: "ArrowLeft", altKey: true }), "left")).toBe(false);
  });

  it("resolves special to the platform's primary modifier", () => {
    setPlatform("MacIntel");
    expect(eventMatchesHotkey(keydown({ key: "ArrowLeft", metaKey: true }), "special+left")).toBe(
      true,
    );
    expect(eventMatchesHotkey(keydown({ key: "ArrowLeft", ctrlKey: true }), "special+left")).toBe(
      false,
    );

    setPlatform("Win32");
    expect(eventMatchesHotkey(keydown({ key: "ArrowLeft", ctrlKey: true }), "special+left")).toBe(
      true,
    );
  });

  it("ignores a stray shift on single-character shortcuts but not on named keys", () => {
    expect(eventMatchesHotkey(keydown({ key: "w", shiftKey: true }), "w")).toBe(true);
    expect(eventMatchesHotkey(keydown({ key: "ArrowUp", shiftKey: true }), "up")).toBe(false);
  });

  it("requires shift when the hotkey asks for it", () => {
    expect(eventMatchesHotkey(keydown({ key: "w", shiftKey: true }), "shift+w")).toBe(true);
    expect(eventMatchesHotkey(keydown({ key: "w" }), "shift+w")).toBe(false);
  });
});
