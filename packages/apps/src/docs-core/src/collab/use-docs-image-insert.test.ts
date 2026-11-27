/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { uploadDocAttachmentImage } from "@/text-editor-core/docs-collab/docs-image-upload";
import { findDocsImageToReplace, useDocsImageInsert } from "./use-docs-image-insert";

vi.mock("@/hooks/use-app-toast", () => ({ useAppToast: () => ({ showError: vi.fn() }) }));
vi.mock("@/docs-core/src/docs-home-drives", () => ({
  fetchGroupRootsFromDrive: vi.fn(async () => []),
}));
vi.mock("@/text-editor-core/docs-collab/docs-image-upload", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uploadDocAttachmentImage: vi.fn(),
}));

const A = "fn-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "fn-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function mount(content: string) {
  const el = document.createElement("div");
  document.body.append(el);
  return new Editor({
    element: el,
    extensions: createTextEditorExtensions({
      format: "markdown",
      fetchImageContent: vi.fn(async () => new Blob([new Uint8Array([1])])),
    }),
    content,
  });
}

function imagePos(editor: Editor, src: string): number {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === "image" && node.attrs.src === src) pos = at;
    return pos < 0;
  });
  return pos;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findDocsImageToReplace", () => {
  it("finds the same image again after the doc changed above it", () => {
    const editor = mount(`Intro\n\n![A](drive:${A})`);
    const src = `drive:${A}`;
    const target = { pos: imagePos(editor, src), src };
    editor.commands.insertContentAt(0, "<p>A new paragraph above</p>");
    expect(imagePos(editor, src)).not.toBe(target.pos);
    expect(findDocsImageToReplace(editor, target)).toBe(imagePos(editor, src));
    editor.destroy();
  });

  it("does not take over a different image, and reports a deleted one", () => {
    const editor = mount(`![A](drive:${A})\n\n![B](drive:${B})`);
    const target = { pos: imagePos(editor, `drive:${B}`), src: `drive:${B}` };
    editor.commands.deleteRange({ from: 0, to: target.pos });
    expect(findDocsImageToReplace(editor, target)).toBe(imagePos(editor, `drive:${B}`));
    editor.commands.setContent("<p>Nothing left</p>");
    expect(findDocsImageToReplace(editor, target)).toBeNull();
    editor.destroy();
  });
});

describe("useDocsImageInsert replace target", () => {
  it("is spent by a failed replace, so the next upload inserts", async () => {
    const editor = mount(`Intro\n\n![A](drive:${A})`);
    const src = `drive:${A}`;
    const upload = vi.mocked(uploadDocAttachmentImage);
    upload.mockRejectedValueOnce(new Error("offline"));
    upload.mockResolvedValueOnce({ nodeId: B, alt: "B" } as never);
    const { result } = renderHook(() =>
      useDocsImageInsert({
        editor,
        docApiPath: "/doc",
        enabled: true,
        insertErrorMessage: "failed",
      }),
    );
    const png = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    act(() => result.current.openReplacePicker(imagePos(editor, src)));
    await act(async () => result.current.onUploadFiles([png]));
    await act(async () => result.current.onUploadFiles([png]));
    const srcs: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") srcs.push(node.attrs.src);
    });
    expect(srcs).toContain(src);
    expect(srcs).toHaveLength(2);
    editor.destroy();
  });
});
