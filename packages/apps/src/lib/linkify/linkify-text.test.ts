import { describe, expect, it } from "vitest";
import { linkifyText, safeLinkHref } from "./linkify-text";

const links = (text: string) =>
  linkifyText(text).flatMap((p) => (p.type === "link" ? [p.href] : []));

describe("linkifyText", () => {
  it("links http, https and mailto", () => {
    expect(links("a http://x.test b https://y.test/p?q=1 c mailto:me@x.test")).toEqual([
      "http://x.test/",
      "https://y.test/p?q=1",
      "mailto:me@x.test",
    ]);
  });

  it("keeps the text exactly and splits around links", () => {
    const text = "Join: https://meet.test/abc now";
    const parts = linkifyText(text);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts).toHaveLength(3);
  });

  it("never links javascript: or data:", () => {
    expect(links("javascript:alert(1) data:text/html,<b>x</b> JAVASCRIPT:alert(1)")).toEqual([]);
    expect(safeLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeLinkHref("data:text/html,x")).toBeNull();
  });

  it("leaves sentence punctuation and unbalanced brackets out of the link", () => {
    expect(links("see https://x.test/a.")).toEqual(["https://x.test/a"]);
    expect(links("(https://x.test/a)")).toEqual(["https://x.test/a"]);
    expect(links("https://x.test/a_(b)")).toEqual(["https://x.test/a_(b)"]);
  });

  it("returns plain text as one run and empty for empty", () => {
    expect(linkifyText("no links")).toEqual([{ type: "text", text: "no links" }]);
    expect(linkifyText("")).toEqual([]);
  });

  it("links www. addresses as https and keeps trailing punctuation out", () => {
    expect(links("see www.example.com/a, or WWW.Example.org.")).toEqual([
      "https://www.example.com/a",
      "https://www.example.org/",
    ]);
    expect(links("www.something and awww.example.com")).toEqual([]);
  });

  it("links bare email addresses as mailto and keeps the text", () => {
    expect(links("mail ada@example.test.")).toEqual(["mailto:ada@example.test"]);
    const text = "Ask ada.l+x@example.co.uk now";
    const parts = linkifyText(text);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(links("no at sign here, a@b and @mention")).toEqual([]);
  });

  it("does not double-link an email inside a URL or a mailto: link", () => {
    expect(links("https://x.test/u@e.test mailto:me@x.test")).toEqual([
      "https://x.test/u@e.test",
      "mailto:me@x.test",
    ]);
  });
});
