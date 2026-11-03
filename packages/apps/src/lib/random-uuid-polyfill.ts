/**
 * `crypto.randomUUID` only exists in a secure context, but `crypto.getRandomValues`
 * exists everywhere. Over plain http (a LAN first look) the app would crash on boot
 * without it, so the installer could not even show its not-secure warning (#1526).
 * Imported first in `main.tsx`; a no-op where the browser has its own.
 */
type CryptoWithUuid = {
  getRandomValues: Crypto["getRandomValues"];
  randomUUID?: () => string;
};

/** RFC 4122 version 4, from 16 random bytes. */
export function randomUuidFromBytes(
  bytes: Uint8Array,
): `${string}-${string}-${string}-${string}-${string}` {
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function installRandomUuidPolyfill(
  target: CryptoWithUuid | undefined = globalThis.crypto,
): void {
  if (target == null || typeof target.randomUUID === "function") return;
  if (typeof target.getRandomValues !== "function") return;
  target.randomUUID = () => randomUuidFromBytes(target.getRandomValues(new Uint8Array(16)));
}

installRandomUuidPolyfill();
