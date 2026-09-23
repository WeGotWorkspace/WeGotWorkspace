import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BrandLockup } from "@/brand-lockup/src/brand-lockup";

describe("BrandLockup", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes WeGotWorkspace as the accessible name", () => {
    render(<BrandLockup />);
    expect(screen.getByLabelText("WeGotWorkspace")).toBeTruthy();
  });

  it("renders the suite wordmark lines matching the app-switch workspace lockup", () => {
    const { container } = render(<BrandLockup />);
    expect(container.querySelector(".app-switch-button__label-top")?.textContent).toBe("we got");
    expect(container.querySelector(".app-switch-button__label-name")?.textContent).toBe(
      "Workspace",
    );
    expect(container.querySelector(".workspace-app-icon--switch-trigger-home")).toBeTruthy();
  });
});
