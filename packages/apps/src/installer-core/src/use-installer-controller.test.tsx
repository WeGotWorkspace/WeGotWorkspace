import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { InstallerAPIOperations } from "@/installer-core/src/installer-types";
import { useInstallerController } from "@/installer-core/src/use-installer-controller";
import { createInstallerAppBootstrap } from "@/lib/api/mock/installer-bootstrap";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function controllerWith(databaseNext: InstallerAPIOperations["databaseNext"]) {
  const { data, operations } = createInstallerAppBootstrap();
  return renderHook(() =>
    useInstallerController({ data, operations: { ...operations!, databaseNext } }),
  );
}

describe("useInstallerController database step", () => {
  it("keeps a refused data folder's text and code as the server sent them", async () => {
    const message = "Deze map hoort bij een andere installatie.";
    const { result } = controllerWith(async () => ({
      ok: false,
      error: message,
      error_code: "data_dir_owned",
    }));

    await act(async () => {
      await result.current.continueDatabase({ engine: "sqlite", dataDir: "/srv/taken" });
    });

    expect(result.current.databaseError).toBe(message);
    expect(result.current.databaseErrorCode).toBe("data_dir_owned");
  });

  it("rewrites a connection failure without a code into a short line", async () => {
    const { result } = controllerWith(async () => ({
      ok: false,
      error: "SQLSTATE[HY000] [1045] Access denied for user",
    }));

    await act(async () => {
      await result.current.continueDatabase({ engine: "sqlite" });
    });

    expect(result.current.databaseError).toBe("MySQL rejected that username or password.");
    expect(result.current.databaseErrorCode).toBeNull();
  });
});
