import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-workspace.css"), "utf8");
const tsx = readFileSync(join(here, "calendar-workspace.tsx"), "utf8");

describe("calendar workspace header CSS", () => {
  it("compacts header chrome on narrow view-header containers", () => {
    expect(css).toMatch(/@container view-header-main \(max-width: 40rem\)/);
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-header-nav \.button\[class\*="icon-button--size"\][\s\S]*size-8/,
    );
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-header-actions \.calendar-view-select \{[\s\S]*min-w-0/,
    );
    expect(css).toMatch(/\.calendar-workspace \.workspace-app-layout__main-header \{[\s\S]*p-3/);
  });

  it("matches inbox gap to header actions so desktop clustering stays tight", () => {
    expect(css).toMatch(/\.calendar-workspace \.view-header__end \{[\s\S]*gap-1/);
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-invitations-trigger\.button\[class\*="icon-button--size"\][\s\S]*size-8/,
    );
  });
});

describe("calendar workspace header markup", () => {
  it("pins inbox to ViewHeader titleTrailing instead of wrapping actions", () => {
    expect(tsx).toMatch(/titleTrailing=\{\s*<CalendarInvitationsTrigger/);
    const actionsBlock = tsx.match(
      /actions=\{\s*<div className="calendar-header-actions">([\s\S]*?)<\/div>\s*\}/,
    );
    expect(actionsBlock?.[1]).toBeDefined();
    expect(actionsBlock![1]).not.toMatch(/CalendarInvitationsTrigger/);
    expect(actionsBlock![1]).toMatch(/calendar-header-today/);
  });
});

describe("calendar workspace stacked header", () => {
  it("uses a viewport two-row grid so flattening main cannot drop the query", () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*"toggle actions trailing"[\s\S]*"title title leading"/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*\.calendar-header-today \{[\s\S]*hidden/,
    );
  });
});
