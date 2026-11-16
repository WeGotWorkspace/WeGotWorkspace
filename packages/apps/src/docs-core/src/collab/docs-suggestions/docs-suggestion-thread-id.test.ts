import { describe, expect, it } from "vitest";
import { suggestionThreadIdForChange } from "./docs-suggestion-thread-id";
import { UNKNOWN_SUGGESTION_AUTHOR, suggestionAuthorFromThread } from "./docs-suggestion-author";

/** Same pattern the API uses for thread ids (`DocsThreadJournalConverter::ULID_PATTERN`). */
const SERVER_ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const PATH = "/users/alex/docs/plan.md";
const CHANGE = "ch_1792507065581_1_jjwaa9";

describe("suggestionThreadIdForChange", () => {
  it("is a ULID the thread endpoint accepts, timed from the change id", () => {
    const id = suggestionThreadIdForChange(PATH, CHANGE);
    expect(id).toMatch(SERVER_ULID);
    expect(id.slice(0, 10)).toBe(
      suggestionThreadIdForChange(PATH, "ch_1792507065581_9_other").slice(0, 10),
    );
  });

  it("is the same for the same document and change, so creating a root is idempotent", () => {
    expect(suggestionThreadIdForChange(PATH, CHANGE)).toBe(
      suggestionThreadIdForChange(PATH, CHANGE),
    );
  });

  it("differs per change and per document", () => {
    const id = suggestionThreadIdForChange(PATH, CHANGE);
    expect(suggestionThreadIdForChange(PATH, "ch_1792507065581_2_jjwaa9")).not.toBe(id);
    expect(suggestionThreadIdForChange("/users/alex/docs/copy.md", CHANGE)).not.toBe(id);
  });

  it("accepts change ids without a timestamp", () => {
    expect(suggestionThreadIdForChange(PATH, "legacy-change")).toMatch(SERVER_ULID);
  });
});

describe("suggestionAuthorFromThread", () => {
  it("takes name and a per-principal colour from the thread root", () => {
    const alex = suggestionAuthorFromThread({ id: "alex", name: "Alex Example" });
    expect(alex).toMatchObject({ authorId: "alex", authorName: "Alex Example" });
    expect(alex.authorColor).toBeTruthy();
    expect(suggestionAuthorFromThread({ id: "alex", name: "Alex (other tab)" }).authorColor).toBe(
      alex.authorColor,
    );
  });

  it("is unknown without a thread", () => {
    expect(suggestionAuthorFromThread(undefined)).toEqual(UNKNOWN_SUGGESTION_AUTHOR);
    expect(suggestionAuthorFromThread({ id: "", name: " " })).toEqual(UNKNOWN_SUGGESTION_AUTHOR);
  });
});
