import { describe, expect, it } from "vitest";
import {
  markdownToNoteBody,
  markdownToPlainText,
  noteBodyToMarkdown,
} from "@/lib/models/note-body-markdown";

describe("markdownToPlainText", () => {
  it("strips GFM task-list checkboxes to plain prose", () => {
    const md = "Boodschappen Aug\n\n- [ ] Bananen\n- [ ] Fruit\n- [ ] Pasta\n- [x] Done";
    expect(markdownToPlainText(md)).toBe("Boodschappen Aug Bananen Fruit Pasta Done");
  });

  it("strips bare checkbox markers left by partial markdown cleanup", () => {
    expect(markdownToPlainText("Aug [ ] Bananen [ ] Fruit [x] Past")).toBe(
      "Aug Bananen Fruit Past",
    );
  });

  it("strips common markdown markers", () => {
    expect(markdownToPlainText("# Heading\n\n**bold** and *italic*")).toBe(
      "Heading bold and italic",
    );
    expect(markdownToPlainText("[link text](https://example.com)")).toBe("link text");
    expect(markdownToPlainText("- bullet\n- item")).toBe("bullet item");
    expect(markdownToPlainText("~~strike~~ and `code`")).toBe("strike and code");
  });
});

describe("noteBodyToMarkdown / markdownToNoteBody", () => {
  it("round-trips blank-line separated paragraphs", () => {
    const body = ["First para", "Second para"];
    expect(markdownToNoteBody(noteBodyToMarkdown(body))).toEqual(body);
  });
});
