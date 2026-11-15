/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

    await waitFor(() => expect(screen.getByText("plain fallback")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("plain fallback")).toBeTruthy();
  });
});
