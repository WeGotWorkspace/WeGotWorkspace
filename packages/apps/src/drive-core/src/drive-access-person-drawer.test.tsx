import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DriveAccessPersonDrawer } from "@/drive-core/src/drive-access-person-drawer";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveAccessController } from "@/drive-core/src/use-drive-access-controller";
import { mockDriveShareByPrincipal } from "@/lib/api/mock/drive-share-fixtures";

afterEach(() => {
  cleanup();
});

describe("DriveAccessPersonDrawer", () => {
  it("says Team for access that comes from a team grant", () => {
    const controller = {
      labels: driveLabels,
      username: "demo.user",
      personPrincipal: "alice",
      personData: mockDriveShareByPrincipal,
      personLoading: false,
      closePerson: () => {},
      navigateScopeFromVia: () => {},
    } as unknown as DriveAccessController;

    render(<DriveAccessPersonDrawer controller={controller} />);

    expect(screen.getByText("Team: engineering")).toBeTruthy();
    expect(screen.queryByText(/^Group:/)).toBeNull();
  });
});
