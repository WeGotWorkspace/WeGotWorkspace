import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContactEditDraft } from "@/contacts-core/src/contacts-edit-utils";
import {
  CONTACTS_AUTOSAVE_DEBOUNCE_MS,
  createContactSaveDebouncer,
} from "./contacts-edit-autosave";

const sampleDraft: ContactEditDraft = {
  nameGiven: "Jane",
  nameGiven2: "",
  nameSurname: "Doe",
  showGiven2: false,
  showAsCompany: false,
  phones: [],
  emails: [],
  addresses: [],
  urls: [],
  title: "",
  department: "",
  organization: "",
  notes: "",
};

describe("contacts-edit-autosave", () => {
  it("CONTACTS_AUTOSAVE_DEBOUNCE_MS is between 500ms and 800ms", () => {
    expect(CONTACTS_AUTOSAVE_DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
    expect(CONTACTS_AUTOSAVE_DEBOUNCE_MS).toBeLessThanOrEqual(800);
  });
});

describe("createContactSaveDebouncer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not persist immediately when schedule is called", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const { schedule } = createContactSaveDebouncer(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
    schedule("card-jane", sampleDraft, persist);
    expect(persist).not.toHaveBeenCalled();
  });

  it("persists the draft after the debounce delay", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const { schedule } = createContactSaveDebouncer(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
    schedule("card-jane", sampleDraft, persist);
    vi.advanceTimersByTime(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith("card-jane", sampleDraft);
  });

  it("resets the timer when schedule is called again before delay elapses", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const { schedule } = createContactSaveDebouncer(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
    const updatedDraft = { ...sampleDraft, nameGiven: "Janet" };
    schedule("card-jane", sampleDraft, persist);
    vi.advanceTimersByTime(300);
    schedule("card-jane", updatedDraft, persist);
    vi.advanceTimersByTime(300);
    expect(persist).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith("card-jane", updatedDraft);
  });

  it("flushAll persists all pending drafts immediately", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const joeDraft = { ...sampleDraft, nameGiven: "Joe" };
    const { schedule, flushAll } = createContactSaveDebouncer(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
    schedule("card-jane", sampleDraft, persist);
    schedule("card-joe", joeDraft, persist);
    flushAll(persist);
    expect(persist).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
