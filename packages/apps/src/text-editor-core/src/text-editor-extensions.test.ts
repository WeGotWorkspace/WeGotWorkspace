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
      trackChangesUserKey: crypto.randomUUID(),
      user: { name: "Alex", color: "#2563eb" },
      format: "markdown",
    });
    const names = extensions.map((ext) => ext.name);
    expect(duplicateExtensionNames(names)).toEqual([]);
  });

  it("drops a hostile textAlign and keeps an allowed alignment", () => {
    const hostile = new Editor({
      extensions: createTextEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "center;position:fixed" },
            content: [{ type: "text", text: "Overlay" }],
          },
        ],
      },
    });
    const centered = new Editor({
      extensions: createTextEditorExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [{ type: "text", text: "Centered" }],
          },
        ],
      },
    });

    try {
      const hostileHtml = hostile.getHTML();
      expect(hostileHtml).not.toContain("style");
      expect(hostileHtml).not.toContain("position");
      expect(centered.getHTML()).toContain("text-align: center");
    } finally {
      hostile.destroy();
      centered.destroy();
    }
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
          trackChangesUserKey: "alex:room",
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

type RestrictedAllow = NonNullable<Parameters<typeof createTextEditorExtensions>[0]>["allow"];

describe("restricted text editor (allow-list)", () => {
  function editorFor(
    allow: RestrictedAllow,
    content: string,
    format: "markdown" | "html" = "markdown",
  ) {
    return new Editor({
      extensions: createTextEditorExtensions({ format, allow }),
      content,
    });
  }

  it("has only the allowed nodes and marks in the schema", () => {
    const editor = editorFor(["bold", "italic", "link"], "");
    const { nodes, marks } = editor.schema;
    expect(Object.keys(marks).sort()).toEqual(["bold", "italic", "link"]);
    for (const absent of ["heading", "table", "taskList", "image", "codeBlock", "blockquote"]) {
      expect(nodes[absent]).toBeUndefined();
    }
    editor.destroy();
  });

  it("keeps the text of pasted formatting that is not allowed, and the formatting that is", () => {
    const editor = editorFor(["bold", "italic", "link"], "", "html");
    // The paste path: HTML is parsed through the schema, as insertContent does here.
    editor.commands.insertContent(
      "<h1>Title</h1><p>a <strong>bold</strong> and <em>it</em></p><table><tr><td>cell</td></tr></table><img src='x.png'>",
    );
    const html = editor.getHTML();
    expect(html).not.toMatch(/<h1|<table|<img/);
    expect(html).toContain("Title");
    expect(html).toContain("cell");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    editor.destroy();
  });

  it("flattens markdown the allow-list excludes and ignores raw HTML", () => {
    const editor = editorFor(["bold"], "# Heading\n\n- item\n\n**kept** <script>x</script>");
    expect(editor.getHTML()).not.toMatch(/<h1|<ul|<script/);
    expect(editor.getHTML()).toContain("<strong>kept</strong>");
    editor.destroy();
  });

  it("allows lists, quotes and code blocks when asked", () => {
    const editor = editorFor(
      ["bulletList", "blockquote", "codeBlock", "code"],
      "- item\n\n> quote\n\n```\ncode\n```",
    );
    expect(editor.getHTML()).toMatch(/<ul[^>]*>[\s\S]*<blockquote>[\s\S]*<pre>/);
    editor.destroy();
  });
});

describe("links in comments and chat", () => {
  it("turns a bare URL in markdown into a link, opening in a new tab", () => {
    const editor = new Editor({
      extensions: createTextEditorExtensions({
        format: "markdown",
        links: { linkify: true, openOnClick: true },
      }),
      content: "see https://example.com/docs for more",
    });
    const html = editor.getHTML();
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    editor.destroy();
  });

  it("keeps a restricted composer's link, and blocks a script URL", () => {
    const editor = new Editor({
      extensions: createTextEditorExtensions({ format: "markdown", allow: ["link"] }),
      content: "[ok](https://example.com) and [bad](javascript:alert(1))",
    });
    const html = editor.getHTML();
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('href="javascript');
    editor.destroy();
  });
});

describe("link markdown in comments", () => {
  const roundTrip = (content: string) => {
    const editor = new Editor({
      extensions: createTextEditorExtensions({ format: "markdown", allow: ["link", "bold"] }),
      content,
    });
    const out = (
      editor.storage as unknown as { markdown: { getMarkdown: () => string } }
    ).markdown.getMarkdown();
    editor.destroy();
    return out;
  };

  it("saves a URL link as the bare URL, without angle brackets", () => {
    expect(roundTrip("see https://example.com/docs now")).toBe("see https://example.com/docs now");
    expect(roundTrip("see <https://example.com/docs> now")).toBe(
      "see https://example.com/docs now",
    );
  });

  it.each([
    "https://example.com/a*b*c",
    "https://en.wikipedia.org/wiki/Foo_(bar)",
    "https://example.com/~user",
  ])("round-trips %s to the same href and stays stable", (url) => {
    const hrefOf = (markdown: string) => {
      const editor = new Editor({
        extensions: createTextEditorExtensions({ format: "markdown", allow: ["link", "bold"] }),
        content: markdown,
      });
      const hrefs: string[] = [];
      editor.state.doc.descendants((node) => {
        for (const mark of node.marks) if (mark.type.name === "link") hrefs.push(mark.attrs.href);
      });
      editor.destroy();
      return hrefs;
    };
    const first = roundTrip(url);
    expect(hrefOf(first)).toEqual(hrefOf(url));
    expect(hrefOf(first)).toEqual([url]);
    expect(roundTrip(first)).toBe(first);
  });

  it("keeps a link with its own text as [text](url)", () => {
    expect(roundTrip("[the docs](https://example.com/docs)")).toBe(
      "[the docs](https://example.com/docs)",
    );
  });

  it("escapes backslashes and quotes in a link title, and keeps it across a second save", () => {
    const once = roundTrip('[docs](https://example.com/a "C:\\\\dir \\"x\\"")');
    expect(once).toBe('[docs](https://example.com/a "C:\\\\dir \\"x\\"")');
    expect(roundTrip(once)).toBe(once);
  });
});
