import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  createCollaborativeTextEditorExtensions,
  createTextEditorExtensions,
} from "./text-editor-extensions";

function duplicateExtensionNames(names: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    else seen.add(name);
  }
  return [...duplicates];
}

describe("text editor extensions", () => {
  it("does not duplicate extension names in the base editor", () => {
    const extensions = createTextEditorExtensions({ format: "markdown" });
    const names = extensions.map((ext) => ext.name);
    expect(duplicateExtensionNames(names)).toEqual([]);
    expect(names).toContain("image");
  });

  it("omits Image for plain-text documents", () => {
    const names = createTextEditorExtensions({ format: "text" }).map((ext) => ext.name);
    expect(names).not.toContain("image");
  });

  it("does not duplicate extension names in the collaborative editor", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const extensions = createCollaborativeTextEditorExtensions({
      document: ydoc,
      awareness,
      user: { name: "Alex", color: "#2563eb" },
      format: "markdown",
    });
    const names = extensions.map((ext) => ext.name);
    expect(duplicateExtensionNames(names)).toEqual([]);
  });

  /** @vitest-environment jsdom */
  it("resolves collaborative StarterKit children without duplicate TipTap marks", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    try {
      const editor = new Editor({
        extensions: createCollaborativeTextEditorExtensions({
          document: ydoc,
          awareness,
          user: { name: "Alex", color: "#2563eb" },
          format: "markdown",
        }),
      });
      editor.destroy();
      expect(warnings.some((message) => message.includes("Duplicate extension names"))).toBe(false);
    } finally {
      console.warn = originalWarn;
    }
  });
});
