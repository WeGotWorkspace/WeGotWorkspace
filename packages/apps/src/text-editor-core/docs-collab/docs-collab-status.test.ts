import { describe, expect, it } from "vitest";
import {
  DOC_STATUS_LOADED_SHARED_DOCUMENT,
  DOC_STATUS_NOTE_TOO_LARGE,
  DOC_STATUS_RESTORED_WORKING_VERSION,
  isSaveFailureDocStatus,
  isToastDocStatus,
  isTransientDocStatus,
} from "./docs-collab-status";

describe("isTransientDocStatus", () => {
  it("treats one-off confirmations as transient", () => {
    expect(isTransientDocStatus(DOC_STATUS_LOADED_SHARED_DOCUMENT)).toBe(true);
    expect(isTransientDocStatus(DOC_STATUS_RESTORED_WORKING_VERSION)).toBe(true);
  });

  it("treats connection and sync states as persistent", () => {
    expect(isTransientDocStatus("Connecting to collaborators…")).toBe(false);
    expect(isTransientDocStatus("Reconnecting…")).toBe(false);
    expect(isTransientDocStatus("Editing offline")).toBe(false);
    expect(isTransientDocStatus("Server unavailable, using local draft")).toBe(false);
  });

  it("treats errors, empty status, and former saved flashes as non-transient", () => {
    expect(isTransientDocStatus("Save failed: network down")).toBe(false);
    expect(isTransientDocStatus("")).toBe(false);
    expect(isTransientDocStatus("Saved · 10:00:00 AM")).toBe(false);
  });
});

describe("isSaveFailureDocStatus / isToastDocStatus", () => {
  it("classifies save failures for toast routing", () => {
    expect(isSaveFailureDocStatus("Save failed: invalid_markdown")).toBe(true);
    expect(isSaveFailureDocStatus(DOC_STATUS_NOTE_TOO_LARGE)).toBe(true);
    expect(isSaveFailureDocStatus("Editing offline")).toBe(false);
  });

  it("routes ephemeral confirmations and save failures to toasts", () => {
    expect(isToastDocStatus(DOC_STATUS_RESTORED_WORKING_VERSION)).toBe(true);
    expect(isToastDocStatus(DOC_STATUS_LOADED_SHARED_DOCUMENT)).toBe(true);
    expect(isToastDocStatus("Save failed: invalid_markdown")).toBe(true);
    expect(isToastDocStatus("Editing offline")).toBe(false);
    expect(isToastDocStatus("Connecting to collaborators…")).toBe(false);
  });
});
