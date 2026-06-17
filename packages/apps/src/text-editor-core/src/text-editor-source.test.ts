import { describe, expect, it } from "vitest";
import {
  textEditorSourceLineCount,
  textEditorSourceLines,
} from "@/text-editor-core/src/text-editor-source-lines";
import { applyTextEditorSourceTabEdit } from "@/text-editor-core/src/text-editor-source-tab";

describe("textEditorSourceLines", () => {
  it("returns a single empty line for empty buffer", () => {
    expect(textEditorSourceLines("")).toEqual([""]);
  });

  it("normalizes CRLF", () => {
    expect(textEditorSourceLines("a\r\nb")).toEqual(["a", "b"]);
  });
});

describe("textEditorSourceLineCount", () => {
  it("returns 1 for empty buffer", () => {
    expect(textEditorSourceLineCount("")).toBe(1);
  });

  it("counts newline-separated lines", () => {
    expect(textEditorSourceLineCount("a\nb\nc")).toBe(3);
    expect(textEditorSourceLineCount("a\n")).toBe(2);
  });

  it("normalizes CRLF", () => {
    expect(textEditorSourceLineCount("a\r\nb")).toBe(2);
  });
});

describe("applyTextEditorSourceTabEdit", () => {
  it("inserts spaces at a collapsed caret", () => {
    const result = applyTextEditorSourceTabEdit("hello", 2, 2, 2);
    expect(result).toEqual({
      value: "he  llo",
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it("replaces a single-line selection with spaces", () => {
    const result = applyTextEditorSourceTabEdit("hello world", 6, 11, 2);
    expect(result).toEqual({
      value: "hello   ",
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it("indents each line in a multi-line selection", () => {
    const source = "alpha\nbeta\ngamma";
    const result = applyTextEditorSourceTabEdit(source, 0, source.length, 2);
    expect(result).toEqual({
      value: "  alpha\n  beta\n  gamma",
      selectionStart: 2,
      selectionEnd: source.length + 6,
    });
  });

  it("outdent removes leading spaces on the current line", () => {
    const result = applyTextEditorSourceTabEdit("  hello", 4, 4, 2, true);
    expect(result).toEqual({
      value: "hello",
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it("outdent removes leading spaces from each selected line", () => {
    const source = "  alpha\n    beta";
    const result = applyTextEditorSourceTabEdit(source, 0, source.length, 2, true);
    expect(result).toEqual({
      value: "alpha\n  beta",
      selectionStart: 0,
      selectionEnd: source.length - 4,
    });
  });
});
