/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { BootstrapLoad } from "@/lib/collab/docs-collab-bootstrap";
import {
  TEXT_FIELDS_TITLE,
  observeTextFieldsSeeds,
  readTextFields,
  readTextFieldsBase,
  seedTextFields,
} from "./docs-collab-text-fields";
import type { DocsCollabSessionRefs } from "./docs-collab-types";
import { useDocsCollabTextFields } from "./use-docs-collab-text-fields";

const MILK = { title: "Groceries", description: "Buy milk" };

function bootstrapWith(pending: { dirty: boolean; pendingKey: boolean }, replaceServer = false) {
  const stored = new Y.Doc();
  seedTextFields(stored, MILK, '"tag"');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(stored), "mesh");
  observeTextFieldsSeeds(doc);
  // A title edit typed offline, before a reload: in the local doc, not in the stored state.
  doc.getText(TEXT_FIELDS_TITLE).insert(9, "!");
  const refs = {
    localDirtySinceLastSaveRef: { current: pending.dirty },
    pendingServerSaveRef: { current: pending.pendingKey },
    externalWriteHoldRef: { current: false },
    externalWriteSeenRef: { current: null },
    seedDoneRef: { current: false },
  } as unknown as DocsCollabSessionRefs;
  const { result } = renderHook(() =>
    useDocsCollabTextFields({
      refs,
      room: "task-uid-1",
      urls: {
        signalUrl: "/events",
        documentUrl: "/tasks/1",
        yjsUrl: "/y",
        room: "t1",
        documentShape: "text-fields",
      },
      documentFormat: "markdown",
      loadedStateRef: { current: null },
    }),
  );
  result.current.noteServed({
    markdown: replaceServer ? "Buy soy milk" : MILK.description,
    title: MILK.title,
    etag: replaceServer ? '"other"' : '"tag"',
    objectEtag: "e1",
  });
  const load: BootstrapLoad = {
    markdown: MILK.description,
    markdownError: null,
    snapshot: {
      kind: "snapshot",
      update: Y.encodeStateAsUpdate(stored),
      etag: null,
      externalWrite: false,
      contentTag: '"tag"',
    },
  };
  return result.current.settleBootstrap(doc, load);
}

describe("useDocsCollabTextFields settleBootstrap", () => {
  it("keeps a title edit a reload restored only as the pending flag", () => {
    const settled = bootstrapWith({ dirty: false, pendingKey: true });
    expect(settled?.keptLocalEdits).toBe(true);
  });

  it("reports no local edits when nothing is pending", () => {
    const settled = bootstrapWith({ dirty: false, pendingKey: false });
    expect(settled?.keptLocalEdits).toBe(false);
  });

  it("seeds an empty document with no stored state, a title with no notes included", () => {
    const served = { title: "Buy milk", description: "" };
    function open(): Y.Doc {
      const doc = new Y.Doc();
      const refs = {
        localDirtySinceLastSaveRef: { current: false },
        pendingServerSaveRef: { current: false },
        externalWriteHoldRef: { current: false },
        externalWriteSeenRef: { current: null },
        seedDoneRef: { current: false },
      } as unknown as DocsCollabSessionRefs;
      const { result } = renderHook(() =>
        useDocsCollabTextFields({
          refs,
          room: "task-uid-2",
          urls: {
            signalUrl: "/events",
            documentUrl: "/tasks/2",
            yjsUrl: "/y",
            room: "t2",
            documentShape: "text-fields",
          },
          documentFormat: "markdown",
          loadedStateRef: { current: null },
        }),
      );
      result.current.noteServed({
        markdown: served.description,
        title: served.title,
        etag: '"tag"',
        objectEtag: "e1",
      });
      const settled = result.current.settleBootstrap(doc, {
        markdown: served.description,
        markdownError: null,
        snapshot: { kind: "absent" },
      });
      // Typing can follow at once: the room holds the server text and its base.
      expect(settled).toEqual({ settlement: "replaced", keptLocalEdits: false });
      expect(refs.seedDoneRef.current).toBe(true);
      expect(readTextFields(doc)).toEqual(served);
      expect(readTextFieldsBase(doc)?.title).toBe("Buy milk");
      return doc;
    }

    // Two people opening it at once seed the same bytes: one title, not two.
    const owner = open();
    const mate = open();
    Y.applyUpdate(owner, Y.encodeStateAsUpdate(mate), "mesh");
    expect(readTextFields(owner)).toEqual(served);
  });
});
