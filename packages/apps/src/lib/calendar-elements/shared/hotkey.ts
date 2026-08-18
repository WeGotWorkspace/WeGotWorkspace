const keyAliases: Record<string, string> = {
  left: "arrowleft",
  right: "arrowright",
  up: "arrowup",
  down: "arrowdown",
  command: "meta",
  cmd: "meta",
  option: "alt",
  control: "ctrl",
};

function isMacLikePlatform(): boolean {
  const platform = globalThis.navigator?.platform ?? "";
  return /(mac|iphone|ipad|ipod)/i.test(platform);
}

function normalizeHotkeyToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  return keyAliases[normalized] ?? normalized;
}

export function normalizeHotkey(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

export function toAriaHotkey(value: string | undefined | null): string | undefined {
  const normalized = normalizeHotkey(value);
  if (!normalized) return undefined;
  const isMac = isMacLikePlatform();
  const tokenMap: Record<string, string> = {
    special: isMac ? "Meta" : "Control",
    meta: "Meta",
    ctrl: "Control",
    alt: "Alt",
    shift: "Shift",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
  };
  return normalized
    .split("+")
    .map((token) => normalizeHotkeyToken(token))
    .map((token) => tokenMap[token] ?? token)
    .join("+");
}

export function getHotkeyDisplay(value: string | undefined | null): string | undefined {
  const normalized = normalizeHotkey(value);
  if (!normalized) return undefined;
  const isMac = isMacLikePlatform();
  const tokenMap: Record<string, string> = {
    special: isMac ? "⌘" : "CTRL",
    meta: "⌘",
    ctrl: "CTRL",
    alt: isMac ? "OPT" : "ALT",
    shift: "SHIFT",
    arrowleft: "←",
    arrowright: "→",
    arrowup: "↑",
    arrowdown: "↓",
  };
  return normalized
    .split("+")
    .map((token) => normalizeHotkeyToken(token))
    .map((token) => tokenMap[token] ?? token.toUpperCase())
    .join("+");
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function getPlainCharacterHotkey(event: KeyboardEvent): string | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  if (event.key.length !== 1) return undefined;
  return event.key.toLowerCase();
}

export function eventMatchesHotkey(
  event: KeyboardEvent,
  hotkeyValue: string | undefined | null,
): boolean {
  const normalized = normalizeHotkey(hotkeyValue);
  if (!normalized) return false;

  const tokens = normalized.split("+").map((token) => normalizeHotkeyToken(token));
  const modifierTokens = new Set(["special", "meta", "ctrl", "alt", "shift"]);
  const keyToken = tokens.find((token) => !modifierTokens.has(token));
  if (!keyToken) return false;

  const eventKey = normalizeHotkeyToken(event.key);
  if (eventKey !== keyToken) return false;

  const isMac = isMacLikePlatform();
  const hasSpecial = tokens.includes("special");
  const expectsMeta = tokens.includes("meta") || (hasSpecial && isMac);
  const expectsCtrl = tokens.includes("ctrl") || (hasSpecial && !isMac);
  const expectsAlt = tokens.includes("alt");
  const expectsShift = tokens.includes("shift");

  if (event.metaKey !== expectsMeta) return false;
  if (event.ctrlKey !== expectsCtrl) return false;
  if (event.altKey !== expectsAlt) return false;

  // Preserve old single-letter behavior: Shift should not block plain-char shortcuts.
  if (keyToken.length !== 1 || expectsShift) {
    if (event.shiftKey !== expectsShift) return false;
  }

  return true;
}
