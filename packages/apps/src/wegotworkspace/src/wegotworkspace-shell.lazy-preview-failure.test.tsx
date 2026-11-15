/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyDocsFilePreview } from "@/wegotworkspace/src/wegotworkspace-shell";

vi.mock("@/docs-core/src/docs-file-preview", () => {
  throw new Error("chunk failed to load");
});

afterEach(() => {
  cleanup();
});

describe("LazyDocsFilePreview when the editor chunk fails to load", () => {
  it("keeps the preview's own fallback instead of throwing to the route", async () => {
    render(
      <LazyDocsFilePreview fileName="Spec.md" content="# Title" fallback={<p>plain fallback</p>} />,
    );

    expect(screen.getByText("plain fallback")).toBeTruthy();
    // Flush the rejected import inside act so React retries the render; without
    // the catch in the shell, that retry throws and this test fails.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByText("plain fallback")).toBeTruthy();
  });
});
