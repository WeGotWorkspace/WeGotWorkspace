import { describe, expect, it } from "vitest";
import { applyTextEditorSourceEnterEdit } from "@/text-editor-core/src/text-editor-source-tab";

describe("applyTextEditorSourceEnterEdit", () => {
  it("splits at a collapsed caret and copies leading spaces", () => {
    const source = "  abcdef";
    const result = applyTextEditorSourceEnterEdit(source, 5, 5);
    expect(result).toEqual({
      value: "  abc\n  def",
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it("copies indent when the caret is at the end of an indented line", () => {
    const source = "  hello";
    const result = applyTextEditorSourceEnterEdit(source, 7, 7);
    expect(result).toEqual({
      value: "  hello\n  ",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("starts a blank indented line when the caret is in leading whitespace", () => {
    const source = "  hello";
    const result = applyTextEditorSourceEnterEdit(source, 2, 2);
    expect(result).toEqual({
      value: "  \n  hello",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it("does not add indent when the line has no leading whitespace", () => {
    const source = "hello";
    const result = applyTextEditorSourceEnterEdit(source, 2, 2);
    expect(result).toEqual({
      value: "he\nllo",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("copies tabs in leading whitespace", () => {
    const source = "\thello";
    const result = applyTextEditorSourceEnterEdit(source, 6, 6);
    expect(result).toEqual({
      value: "\thello\n\t",
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it("replaces a single-line selection with a newline and copied indent", () => {
    const source = "  hello world";
    const result = applyTextEditorSourceEnterEdit(source, 2, 8);
    expect(result).toEqual({
      value: "  \n  world",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it("replaces a multi-line selection with a newline and copied indent", () => {
    const source = "  line1\n  line2\n  line3";
    const result = applyTextEditorSourceEnterEdit(source, 2, 14);
    expect(result).toEqual({
      value: "  \n  2\n  line3",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });
});
