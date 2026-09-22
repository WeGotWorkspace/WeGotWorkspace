/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkspaceAppIcon,
  WorkspaceAppIconOverrideProvider,
  WorkspaceHomeIcon,
} from "@/lib/workspace-app-icon";

afterEach(() => {
  cleanup();
});

const OVERRIDE_MARKUP =
  '<svg data-branding-override="1" viewBox="0 0 10 10"><rect width="10" height="10" fill="var(--wai-bg, #f00)"/></svg>';

describe("WorkspaceAppIconOverrideProvider", () => {
  it("keeps build-time switch-trigger markup when the provider is absent", () => {
    const { container } = render(<WorkspaceAppIcon appId="mail" variant="switch-trigger" />);
    const trigger = container.querySelector(".workspace-app-icon--switch-trigger");
    // jsdom may expand self-closing tags; assert production artwork cues, not byte equality.
    expect(trigger?.innerHTML).toContain('viewBox="0 0 270 270"');
    expect(trigger?.innerHTML).toContain("var(--wai-bg, #de4b0e)");
    expect(trigger?.innerHTML).toContain("var(--wai-fg, #ffffff)");
    expect(container.querySelector("[data-branding-override]")).toBeNull();
  });

  it("swaps switch-trigger __html when svgMarkup is provided", () => {
    const { container } = render(
      <WorkspaceAppIconOverrideProvider svgMarkup={OVERRIDE_MARKUP}>
        <WorkspaceAppIcon appId="mail" variant="switch-trigger" />
      </WorkspaceAppIconOverrideProvider>,
    );
    const trigger = container.querySelector(".workspace-app-icon--switch-trigger");
    expect(trigger?.querySelector("[data-branding-override='1']")).toBeTruthy();
    expect(trigger?.innerHTML).toContain("data-branding-override");
    expect(trigger?.innerHTML).not.toContain("var(--wai-bg, #de4b0e)");
  });

  it("uses a data URL for default/tile variants when svgMarkup is provided", () => {
    const { container } = render(
      <WorkspaceAppIconOverrideProvider svgMarkup={OVERRIDE_MARKUP}>
        <WorkspaceAppIcon appId="mail" variant="tile" className="size-8" />
      </WorkspaceAppIconOverrideProvider>,
    );
    const img = container.querySelector("img.workspace-app-icon--tile") as HTMLImageElement | null;
    expect(img?.src).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(img?.src ?? "")).toContain("data-branding-override");
  });

  it("does not override when the provider is present without svgMarkup", () => {
    const { container } = render(
      <WorkspaceAppIconOverrideProvider>
        <WorkspaceAppIcon appId="notes" variant="switch-trigger" />
      </WorkspaceAppIconOverrideProvider>,
    );
    const trigger = container.querySelector(".workspace-app-icon--switch-trigger");
    expect(trigger?.innerHTML).toContain("var(--wai-bg, #ffc800)");
    expect(trigger?.innerHTML).toContain('d="M0 45C0 20.147');
    expect(container.querySelector("[data-branding-override]")).toBeNull();
  });

  it("overrides the home switch-trigger mark when svgMarkup is provided", () => {
    const { container } = render(
      <WorkspaceAppIconOverrideProvider svgMarkup={OVERRIDE_MARKUP}>
        <WorkspaceHomeIcon variant="switch-trigger" />
      </WorkspaceAppIconOverrideProvider>,
    );
    expect(
      container
        .querySelector(".workspace-app-icon--switch-trigger-home")
        ?.querySelector("[data-branding-override='1']"),
    ).toBeTruthy();
  });
});
