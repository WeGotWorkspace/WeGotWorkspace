import { describe, expect, it } from "vitest";
import type { NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import type { Note } from "@/lib/models/note";
import type { NotesAPIOperations } from "@/lib/models/notes-types";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";
import {
  notesHybridDomainOperations,
  notesOfflineDomainStore,
} from "@/lib/offline/notes/notes-domain-contract";

describe("notes domain contract", () => {
  it("satisfies OfflineDomainStore at compile time", () => {
    const store: OfflineDomainStore<NotesAppBootstrap, Note> = notesOfflineDomainStore;
    expect(store.readBootstrap).toBeTypeOf("function");
  });

  it("satisfies OfflineDomainOperations at compile time", () => {
    const ops: OfflineDomainOperations<NotesAPIOperations> = notesHybridDomainOperations;
    expect(ops).toBeTypeOf("function");
  });
});
