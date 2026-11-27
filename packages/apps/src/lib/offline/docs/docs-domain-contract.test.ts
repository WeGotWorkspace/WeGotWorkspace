import { describe, expect, it } from "vitest";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import type { OfflineDomainOperations } from "@/lib/offline/core/types";
import { docsDomainOperations } from "@/lib/offline/docs/docs-domain-contract";

describe("docs domain contract", () => {
  it("builds the Docs file operations on Drive's hybrid operations", () => {
    const operations: OfflineDomainOperations<DriveAPIOperations> = docsDomainOperations;
    const built = operations("dana");
    expect(built.listDirectory).toBeTypeOf("function");
    // Drive's factory marks its operations as reading the local tree.
    expect(built.localTree).toBe(true);
  });
});
