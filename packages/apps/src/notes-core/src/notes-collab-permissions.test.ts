import { describe, expect, it } from "vitest";
import { resolveNotesEditorEditable } from "./notes-collab-permissions";

describe("resolveNotesEditorEditable", () => {
  it("defaults to editable when rights are unknown and not loading", () => {
    expect(resolveNotesEditorEditable(undefined)).toBe(true);
    expect(resolveNotesEditorEditable(null)).toBe(true);
    expect(resolveNotesEditorEditable(null, false)).toBe(true);
  });

  it("locks the editor while rights are still loading", () => {
    expect(resolveNotesEditorEditable(null, true)).toBe(false);
    expect(resolveNotesEditorEditable(undefined, true)).toBe(false);
  });

  it("maps view access (mayEditContent false) to read-only", () => {
    expect(resolveNotesEditorEditable({ mayEditContent: false })).toBe(false);
    expect(resolveNotesEditorEditable({ mayEditContent: false }, true)).toBe(false);
  });

  it("maps edit access (mayEditContent true) to editable", () => {
    expect(resolveNotesEditorEditable({ mayEditContent: true })).toBe(true);
    expect(resolveNotesEditorEditable({ mayEditContent: true }, true)).toBe(true);
  });
});
