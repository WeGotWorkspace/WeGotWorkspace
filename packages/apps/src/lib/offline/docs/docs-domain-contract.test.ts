import { describe, expect, it } from "vitest";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import type { OfflineDomainOperations } from "@/lib/offline/core/types";
import { docsHybridDomainOperations } from "@/lib/offline/docs/docs-domain-contract";

describe("docs domain contract", () => {
  it("builds the hybrid Docs operations on the Drive API shape", () => {
    const operations: OfflineDomainOperations<DriveAPIOperations> = docsHybridDomainOperations;
    expect(operations("dana").listDirectory).toBeTypeOf("function");
  });
});
