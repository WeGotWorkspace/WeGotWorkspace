import { cleanup, render, screen, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { formatDocLastEdited } from "@/docs-core/src/docs-last-edited";
import { DocsStatsTags } from "@/docs-core/src/docs-stats-tags";
import { formatListDateTime } from "@/lib/datetime/format-list-date";
import { TooltipProvider } from "@/ui/tooltip";
import { detailFooterLastEditedTag } from "@/workspace-shell/src/detail-footer-last-edited-tag";
import { WorkspaceDetailFooter } from "@/workspace-shell/src/workspace-detail-footer";

afterEach(() => {
  cleanup();
});

function renderFooter(ui: ReactElement): RenderResult {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("Docs detail footer via WorkspaceDetailFooter + last-edited tag", () => {
  it("puts presence in start and word/char + last-edited tags before status in the end group", () => {
    const lastEdited = formatDocLastEdited("2026-08-10T12:00:00.000Z");
    expect(lastEdited).toBe(formatListDateTime("2026-08-10T12:00:00.000Z"));

    const { container } = renderFooter(
      <WorkspaceDetailFooter
        className="docs-workspace__stats-footer"
        start={<span data-testid="presence">peers</span>}
        tags={
          <>
            <DocsStatsTags
              wordCount={12}
              characterCount={34}
              statsWordsLabel={(n) => `${n} words`}
              statsCharactersLabel={(n) => `${n} characters`}
            />
            {detailFooterLastEditedTag({
              lastEdited,
              editedLabel: "Last edited",
            })}
          </>
        }
        end={<span data-testid="status">Editing offline</span>}
      />,
    );

    const footer = container.querySelector(".docs-workspace__stats-footer");
    expect(footer).toBeTruthy();
    expect(footer!.className).toContain("workspace-detail-footer");

    const groups = footer!.querySelectorAll(".workspace-chrome-footer__group");
    expect(groups.length).toBe(2);
    expect(groups[0]!.querySelector("[data-testid='presence']")).toBeTruthy();
    expect(groups[1]!.className).toContain("workspace-chrome-footer__group--end");
    expect(screen.getByText("12 words")).toBeTruthy();
    expect(screen.getByText("34 characters")).toBeTruthy();
    expect(groups[1]!.querySelector(".docs-workspace__stats-footer-tag--characters")).toBeTruthy();
    const chip = groups[1]!.querySelector(".workspace-detail-footer__meta-tag--edited");
    expect(chip).toBeTruthy();
    expect(chip!.getAttribute("aria-label")).toBe("Last edited");
    expect(chip!.textContent).toBe(lastEdited);
    expect(groups[1]!.querySelector("[data-testid='status']")).toBeTruthy();
    expect(screen.getByText("Editing offline")).toBeTruthy();
  });

  it("shows a spinner on the last-edited tag while busy instead of a calendar icon", () => {
    const lastEdited = formatDocLastEdited("2026-08-10T12:00:00.000Z");
    const { container } = renderFooter(
      <WorkspaceDetailFooter
        className="docs-workspace__stats-footer"
        tags={detailFooterLastEditedTag({
          lastEdited,
          editedLabel: "Last edited",
          busy: true,
          busyLabel: "Unsaved changes",
        })}
      />,
    );

    const chip = container.querySelector(".workspace-detail-footer__meta-tag--busy");
    expect(chip).toBeTruthy();
    expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
    expect(container.querySelector(".loading-spinner")).toBeTruthy();
    expect(screen.getByText(lastEdited)).toBeTruthy();
  });

  it("still renders word/char tags without a presence start slot or last-edited chip", () => {
    const { container } = renderFooter(
      <WorkspaceDetailFooter
        className="docs-workspace__stats-footer"
        tags={
          <DocsStatsTags
            wordCount={1}
            characterCount={2}
            statsWordsLabel={(n) => `${n} words`}
            statsCharactersLabel={(n) => `${n} characters`}
          />
        }
      />,
    );

    expect(container.querySelector("[data-testid='presence']")).toBeNull();
    expect(container.querySelector(".workspace-detail-footer__meta-tag--edited")).toBeNull();
    expect(screen.getByText("1 words")).toBeTruthy();
    expect(screen.getByText("2 characters")).toBeTruthy();
    const groups = container.querySelectorAll(".workspace-chrome-footer__group");
    expect(groups.length).toBe(1);
    expect(groups[0]!.className).toContain("workspace-chrome-footer__group--end");
  });
});
