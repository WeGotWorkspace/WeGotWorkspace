import { describe, expect, it } from "vitest";
import { canonicalCollabFilePath, encodeFileRoomId, resolveRoomId } from "@/lib/rtc/room-id";

const TEAM_NOTES = "groups/administrators/team-notes.md";

describe("canonicalCollabFilePath", () => {
  it("strips one or more leading slashes", () => {
    expect(canonicalCollabFilePath(TEAM_NOTES)).toBe(TEAM_NOTES);
    expect(canonicalCollabFilePath(`/${TEAM_NOTES}`)).toBe(TEAM_NOTES);
    expect(canonicalCollabFilePath(`///${TEAM_NOTES}`)).toBe(TEAM_NOTES);
  });

  it("leaves note UIDs unchanged", () => {
    expect(canonicalCollabFilePath("urn:uuid:550e8400-e29b-41d4-a716-446655440000")).toBe(
      "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
    );
  });
});

describe("encodeFileRoomId", () => {
  it("encodes slash and no-slash drive paths as the same room id", () => {
    const without = encodeFileRoomId(TEAM_NOTES);
    const withSlash = encodeFileRoomId(`/${TEAM_NOTES}`);
    expect(without).toBe(withSlash);
    expect(without.startsWith("f_")).toBe(true);
  });

  it("uses the uns lashed encoding (not the legacy slashed payload)", () => {
    const slashedLegacy = encodeRawBase64Url(`/${TEAM_NOTES}`);
    const canonical = encodeFileRoomId(`/${TEAM_NOTES}`);
    expect(canonical).not.toBe(slashedLegacy);
    expect(canonical).toBe(encodeRawBase64Url(TEAM_NOTES));
  });

  it("resolveRoomId(collab) goes through the same canonical encoder", () => {
    expect(resolveRoomId("collab", `/${TEAM_NOTES}`)).toBe(encodeFileRoomId(TEAM_NOTES));
    expect(resolveRoomId("collab", TEAM_NOTES)).toBe(encodeFileRoomId(TEAM_NOTES));
  });
});

function encodeRawBase64Url(path: string): string {
  const bytes = new TextEncoder().encode(path);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `f_${base64}`;
}
