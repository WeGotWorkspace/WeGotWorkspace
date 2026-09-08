import { describe, expect, it } from "vitest";
import {
  extractChatMentionQuery,
  filterChatMentionPrincipals,
  highlightChatMentionsMarkdown,
  parseChatMentions,
} from "@/chat-ui/src/chat-mention-utils";

const PRINCIPALS = [
  { id: "ada.lovelace", displayName: "Ada Lovelace" },
  { id: "ada.junior", displayName: "Ada" },
  { id: "grace.hopper", displayName: "Grace Hopper" },
];

describe("extractChatMentionQuery", () => {
  it("reads the @query at the end of the draft", () => {
    expect(extractChatMentionQuery("Hi @Ad")).toEqual({ query: "Ad", start: 3, end: 6 });
    expect(extractChatMentionQuery("@")).toEqual({ query: "", start: 0, end: 1 });
  });

  it("ignores emails and mid-word at-signs", () => {
    expect(extractChatMentionQuery("write ada@example.com")).toBeNull();
    expect(extractChatMentionQuery("see @Ada more")).toBeNull();
  });
});

describe("filterChatMentionPrincipals", () => {
  it("matches display name or id, case-insensitive", () => {
    expect(filterChatMentionPrincipals(PRINCIPALS, "ada").map((row) => row.id)).toEqual([
      "ada.lovelace",
      "ada.junior",
    ]);
    expect(filterChatMentionPrincipals(PRINCIPALS, "hopper").map((row) => row.id)).toEqual([
      "grace.hopper",
    ]);
  });
});

describe("parseChatMentions", () => {
  it("prefers the longest display-name token", () => {
    expect(parseChatMentions("Thanks @Ada Lovelace and @grace.hopper.", PRINCIPALS)).toEqual([
      { id: "ada.lovelace", displayName: "Ada Lovelace" },
      { id: "grace.hopper", displayName: "Grace Hopper" },
    ]);
  });

  it("does not match a shorter name inside a longer mention", () => {
    expect(parseChatMentions("Ping @Ada Lovelace", PRINCIPALS)).toEqual([
      { id: "ada.lovelace", displayName: "Ada Lovelace" },
    ]);
  });
});

describe("highlightChatMentionsMarkdown", () => {
  it("wraps the longest mention token for the Highlight mark", () => {
    expect(
      highlightChatMentionsMarkdown("Thanks @Ada Lovelace and @grace.hopper.", [
        { id: "ada.lovelace", displayName: "Ada Lovelace" },
        { id: "grace.hopper", displayName: "Grace Hopper" },
      ]),
    ).toBe("Thanks <mark>@Ada Lovelace</mark> and <mark>@grace.hopper</mark>.");
  });

  it("leaves bodies without mentions unchanged", () => {
    expect(highlightChatMentionsMarkdown("No one tagged", [])).toBe("No one tagged");
  });
});
