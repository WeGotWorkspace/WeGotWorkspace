import { describe, expect, it, vi } from "vitest";
import { slashCommands } from "./text-editor-slash-commands";

const titles = (options: Parameters<typeof slashCommands>[0]) =>
  slashCommands(options).map((command) => command.title);

describe("slashCommands", () => {
  it("offers Page break when the host has pages (Docs)", () => {
    const page = slashCommands({ pageBreak: true }).find((c) => c.title === "Page break");
    expect(page).toBeDefined();
    expect(page?.keywords).toEqual(expect.stringContaining("new page"));
  });

  it("leaves Page break out otherwise (Notes)", () => {
    expect(titles({})).not.toContain("Page break");
    expect(titles({ onInsertImage: vi.fn() })).not.toContain("Page break");
  });

  it("keeps Image tied to its own option", () => {
    expect(titles({ pageBreak: true })).not.toContain("Image");
    expect(titles({ pageBreak: true, onInsertImage: vi.fn() })).toContain("Image");
  });
});
