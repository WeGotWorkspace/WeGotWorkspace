import { cleanup, render, screen, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { detailFooterLastEditedTag } from "@/workspace-shell/src/detail-footer-last-edited-tag";

afterEach(() => {
  cleanup();
});

function renderTag(ui: ReactElement): RenderResult {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("detailFooterLastEditedTag", () => {
  it("renders calendar icon and formatted time when idle", () => {
    const { container } = renderTag(
      <>
        {detailFooterLastEditedTag({
          lastEdited: "10 Aug 2026, 14:00",
          editedLabel: "Last edited",
        })}
      </>,
    );

    const chip = container.querySelector(".workspace-detail-footer__meta-tag--edited");
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute("aria-label")).toBe("Last edited");
    expect(chip!.getAttribute("aria-busy")).toBeNull();
    expect(chip!.getAttribute("role")).toBeNull();
    expect(chip!.className).not.toContain("workspace-detail-footer__meta-tag--busy");
    expect(screen.getByText("10 Aug 2026, 14:00")).toBeTruthy();
    expect(container.querySelector(".loading-spinner")).toBeNull();
  });

  it("shows spinner and busy a11y while syncing, keeping last-edited label text when present", () => {
    const { container } = renderTag(
      <>
        {detailFooterLastEditedTag({
          lastEdited: "10 Aug 2026, 14:00",
          editedLabel: "Last edited",
          busy: true,
          busyLabel: "Unsaved changes",
        })}
      </>,
    );

    const chip = container.querySelector(".workspace-detail-footer__meta-tag--edited");
    expect(chip).toBeTruthy();
    expect(chip!.className).toContain("workspace-detail-footer__meta-tag--busy");
    expect(chip!.getAttribute("aria-busy")).toBe("true");
    expect(chip!.getAttribute("role")).toBe("status");
    expect(chip!.getAttribute("aria-label")).toBe("Unsaved changes");
    expect(screen.getByText("10 Aug 2026, 14:00")).toBeTruthy();
    expect(container.querySelector(".loading-spinner")).toBeTruthy();
  });

  it("still renders a busy chip when there is no last-edited timestamp yet", () => {
    const { container } = renderTag(
      <>
        {detailFooterLastEditedTag({
          busy: true,
          busyLabel: "Unsaved changes",
        })}
      </>,
    );

    const chip = container.querySelector(".workspace-detail-footer__meta-tag--busy");
    expect(chip).toBeTruthy();
    expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("omits the chip when idle without a real timestamp", () => {
    const { container } = renderTag(<>{detailFooterLastEditedTag({})}</>);
    expect(container.querySelector(".workspace-detail-footer__meta-tag--edited")).toBeNull();
  });
});
