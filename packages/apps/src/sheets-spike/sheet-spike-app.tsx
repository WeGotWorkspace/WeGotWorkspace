/**
 * Sheets integration slice: the integrated grid (spikes 6+7+8 in a multi-sheet
 * WorkbookView, spike 4 engine, spike 9 layout) on the real Docs collab session
 * (mesh, HTTP sync, IndexedDB, save queue, server document half + Yjs sidecar).
 * Not a UI proposal: it exists so two browsers can prove the stack end to end.
 *
 * Open: /sheets-spike.html?file=users/admin/x.ycsv&user=Ann[&engine=worker]
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import * as Y from "yjs";
import {
  readPeerSheetPresence,
  readYcsv,
} from "../../../../prototypes/ycsv/src/sheets-core/collab";
import type { EngineMode } from "../../../../prototypes/ycsv/src/sheets-core/engine/host";
import {
  deleteRows,
  insertRows,
  LOCAL,
  moveRows,
  sheetCells,
  sheetIds,
  SheetView,
  writeCells,
} from "../../../../prototypes/ycsv/src/sheets-core/model";
import { WorkbookView } from "../../../../prototypes/ycsv/src/ycsv-ux/WorkbookView";
import { buildDocsEditorUrls } from "@/docs-core/src/docs-collab-urls";
import { wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import { useDocsCollab, type DocsCollabUrls } from "@/text-editor-core/docs-collab";
import { createWgwCollabWire } from "@/text-editor-core/docs-collab/docs-collab-wgw-wire";
import { YCSV_SHAPE_ID } from "./ycsv-shape";

const COLORS = ["#d6336c", "#2b8a3e", "#1c7ed6", "#e8590c", "#7048e8"];

/** Test hooks for the two-browser e2e (state reads; one scripted concurrent op). */
type SpikeHooks = {
  sheetIds: () => string[];
  /** File-form cells of a sheet (default: the first). */
  cells: (sheetId?: string) => string[][];
  /** Formula values as the grid shows them come from the DOM; this is the raw text. */
  serialize: () => string;
  /** Direct ops for racing a peer's gesture in the same instant. */
  moveRow: (from: number, to: number, sheetId?: string) => void;
  setCell: (r: number, c: number, value: string, sheetId?: string) => void;
  rowIds: (sheetId?: string) => string[];
  /** By row id: a write that targets the row wherever a concurrent move put it. */
  setCellById: (rowId: string, c: number, value: string, sheetId?: string) => void;
  insertRows: (at: number, count: number, sheetId?: string) => void;
  deleteRow: (r: number, sheetId?: string) => void;
};

declare global {
  interface Window {
    __spike?: SpikeHooks;
  }
}

function hooksFor(doc: Y.Doc): SpikeHooks {
  const first = (id?: string) => id ?? sheetIds(doc)[0]!;
  const order = (id: string) => {
    const view = new SheetView(doc, id);
    const out = { rows: view.rowIds, cols: view.colIds };
    view.destroy();
    return out;
  };
  return {
    sheetIds: () => sheetIds(doc),
    cells: (id) => sheetCells(doc, first(id)),
    serialize: () => readYcsv(doc),
    moveRow: (from, to, id) => moveRows({ doc, id: first(id) }, from, 1, to),
    setCell: (r, c, value, id) => {
      const sheetId = first(id);
      const { rows, cols } = order(sheetId);
      writeCells({ doc, id: sheetId }, [{ rowId: rows[r]!, colId: cols[c]!, value }]);
    },
    rowIds: (id) => order(first(id)).rows,
    setCellById: (rowId, c, value, id) => {
      const sheetId = first(id);
      writeCells({ doc, id: sheetId }, [{ rowId, colId: order(sheetId).cols[c]!, value }]);
    },
    insertRows: (at, count, id) => void insertRows({ doc, id: first(id) }, at, count),
    deleteRow: (r, id) => deleteRows({ doc, id: first(id) }, [r]),
  };
}

function useUrls(file: string): DocsCollabUrls | null {
  const [urls, setUrls] = useState<DocsCollabUrls | null>(null);
  useEffect(() => {
    let cancelled = false;
    void wgwEnsureFreshAccessToken().then((token) => {
      if (cancelled) return;
      setUrls({
        ...buildDocsEditorUrls(file),
        authToken: token ?? undefined,
        documentFormat: "text",
        documentShape: YCSV_SHAPE_ID,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [file]);
  return urls;
}

export function SheetSpikeApp() {
  const params = new URLSearchParams(location.search);
  const file = params.get("file") ?? "";
  const user = params.get("user") ?? "Someone";
  const engine: EngineMode = params.get("engine") === "worker" ? "worker" : "main";
  const urls = useUrls(file);
  if (!file) return <p>Add ?file=users/admin/name.ycsv</p>;
  if (!urls) return <p data-testid="sheet-loading">Signing in…</p>;
  return <SheetSession urls={urls} user={user} engine={engine} />;
}

function SheetSession({
  urls,
  user,
  engine,
}: {
  urls: DocsCollabUrls;
  user: string;
  engine: EngineMode;
}) {
  const wire = useMemo(() => createWgwCollabWire(), []);
  const collab = useDocsCollab({ userName: user, autoJoin: true, urls, wire });
  const doc = collab.session?.ydoc ?? null;
  const awareness = collab.session?.awareness ?? null;
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const me = useMemo(() => {
    let h = 0;
    for (const ch of user) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return { id: user.toLowerCase(), name: user, color: COLORS[Math.abs(h) % COLORS.length]! };
  }, [user]);

  // Every local gesture (origin "local") and every undo/redo step is a change to save.
  const { onMarkdownChange } = collab;
  const edited = useCallback(() => {
    if (doc) onMarkdownChange(() => readYcsv(doc));
  }, [doc, onMarkdownChange]);
  useEffect(() => {
    if (!doc) return;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL || origin instanceof Y.UndoManager) edited();
    };
    doc.on("update", onUpdate);
    window.__spike = hooksFor(doc);
    return () => doc.off("update", onUpdate);
  }, [doc, edited]);

  useEffect(() => {
    if (!awareness) return;
    awareness.on("change", bump);
    return () => awareness.off("change", bump);
  }, [awareness]);

  if (!doc || !awareness || !collab.joined || collab.awaitingContent) {
    return <p data-testid="sheet-loading">Joining…</p>;
  }
  const peers = readPeerSheetPresence(awareness);

  return (
    <div
      style={{
        fontFamily: "system-ui",
        fontSize: 13,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", gap: 8, padding: 8, alignItems: "center" }}>
        <strong>{urls.room}</strong>
        <span data-testid="sheet-status" data-peers={peers.length}>
          {collab.status} · {peers.length} peer(s) · {collab.pendingSync ? "unsaved" : "saved"}
          {collab.lastSavedAt ? ` · ${collab.lastSavedAt}` : ""} · engine {engine}
        </span>
        <button data-testid="save-now" onClick={() => void collab.saveNow()}>
          Save now
        </button>
      </div>
      <div
        data-testid="sheet-grid"
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <WorkbookView
          doc={doc}
          engine={engine}
          awareness={awareness}
          user={me}
          focusModel="cell"
          tabs="always"
          remoteWindowMs={1500}
        />
      </div>
    </div>
  );
}
