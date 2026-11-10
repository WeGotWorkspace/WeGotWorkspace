import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DriveFileAvatar } from "@/drive-core/src/drive-file-avatar";
import { extensionAvatarLabel, extensionHue } from "@/drive-core/src/drive-file-avatar-label";
import type { DriveFile } from "@/drive-core/src/drive-models";

afterEach(cleanup);

function file(title: string, extra: Partial<DriveFile> = {}): DriveFile {
  return {
    id: title,
    title,
    category: "File",
    date: "",
    excerpt: "",
    body: [],
    notebook: "",
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind: "file",
    size: "",
    ...extra,
  };
}

describe("extensionHue", () => {
  it("keeps a family on one hue and is stable for unknown extensions", () => {
    expect(extensionHue("docx")).toBe(extensionHue("DOC"));
    expect(extensionHue("pdf")).not.toBe(extensionHue("xlsx"));
    expect(extensionHue("bin")).toBe(extensionHue("bin"));
    expect(extensionHue("bin")).toBeGreaterThanOrEqual(0);
    expect(extensionHue("bin")).toBeLessThan(360);
  });
});

describe("extensionAvatarLabel", () => {
  it("uppercases and caps at four letters", () => {
    expect(extensionAvatarLabel("notes.md")).toBe("MD");
    expect(extensionAvatarLabel("guide.markdown")).toBe("MARK");
    expect(extensionAvatarLabel("README")).toBe("");
  });
});

describe("DriveFileAvatar", () => {
  it("shows an image thumbnail only for a loaded image", () => {
    const { container, rerender } = render(
      <DriveFileAvatar
        file={file("beach.png", { kind: "image" })}
        preview={{ kind: "blob-url", url: "blob:x" }}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:x");
    rerender(<DriveFileAvatar file={file("beach.png", { kind: "image" })} />);
    expect(container.textContent).toBe("PNG");
  });

  it("puts the extension on its own hue", () => {
    const { container } = render(<DriveFileAvatar file={file("plan.pdf")} />);
    const avatar = container.querySelector(".drive-file-avatar--extension") as HTMLElement;
    expect(avatar.style.getPropertyValue("--file-avatar-hue")).toBe(String(extensionHue("pdf")));
  });

  it("shows the folder icon for folders", () => {
    const { container } = render(<DriveFileAvatar file={file("Projects", { kind: "folder" })} />);
    expect(container.querySelector(".drive-file-avatar--folder svg")).toBeTruthy();
  });
});
