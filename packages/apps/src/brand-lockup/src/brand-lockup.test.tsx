import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandLockup } from "@/brand-lockup/src/brand-lockup";
import { WE_GOT_WORKSPACE_WORDMARK_LABEL } from "@/brand-lockup/src/we-got-workspace-wordmark";

describe("BrandLockup", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes We Got Workspace as the accessible name", () => {
    render(<BrandLockup />);
    expect(screen.getByLabelText(WE_GOT_WORKSPACE_WORDMARK_LABEL)).toBeTruthy();
  });

  it("renders the suite wordmark SVG matching the app-switch workspace lockup", () => {
    const { container } = render(<BrandLockup />);
    expect(container.querySelector(".we-got-workspace-wordmark svg")).toBeTruthy();
    expect(container.querySelector(".we-got-workspace-wordmark path")?.getAttribute("fill")).toBe(
      "currentColor",
    );
    expect(container.querySelector(".app-switch-button__label-top")).toBeNull();
    expect(container.querySelector(".app-switch-button__label-name")).toBeNull();
    expect(container.querySelector(".workspace-app-icon--switch-trigger-home")).toBeTruthy();
  });
});
