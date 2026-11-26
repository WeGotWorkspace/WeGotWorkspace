/**
 * Sheets spike 5: a bare grid on the real Docs collab session (mesh, HTTP
 * sync, IndexedDB, save queue, server document half + Yjs sidecar). Not a UI
 * proposal: it exists so two browsers can prove the transport end to end.
 *
 * Open: /sheets-spike.html?file=users/admin/x.ycsv&user=Ann
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  createSheetUndoManager,
  readPeerSheetPresence,
  readYcsv,
  resolveRange,
  setLocalSheetPresence,
  type CellRef,
  type PeerSheetPresence,
  type SheetPresence,
} from "../../../../prototypes/ycsv/src/ycsv-collab";
import { evaluateAll, type RawCells } from "../../../../prototypes/ycsv/src/ycsv-formula";
import {
  insertRowAfter,
  setCell,
  toFileForm,
  type EditBase,
} from "../../../../prototypes/ycsv/src/ycsv-model";
import { buildDocsEditorUrls } from "@/docs-core/src/docs-collab-urls";
import { wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import { useDocsCollab, type DocsCollabUrls } from "@/text-editor-core/docs-collab";
import { createWgwCollabWire } from "@/text-editor-core/docs-collab/docs-collab-wgw-wire";
import { YCSV_SHAPE_ID } from "./ycsv-shape";

type Grid = {
  cols: { colId: string; ref: string; name: string }[];
  rows: { rowId: string; cells: Y.Map<string> }[];
  values: Map<string, unknown>;
};

function readGrid(doc: Y.Doc): Grid {
  const columns = doc.getArray<Y.Map<unknown>>("columns");
  const rowsArr = doc.getArray<Y.Map<unknown>>("rows");
  const cols = columns.toArray().map((map) => ({
    colId: String(map.get("colId")),
    ref: String(map.get("ref") ?? ""),
    name: String(map.get("name") ?? map.get("ref") ?? ""),
  }));
  const rows = rowsArr.toArray().map((map) => ({
    rowId: String(map.get("rowId")),
    cells: map.get("cells") as Y.Map<string>,
  }));
  const raw: RawCells = new Map();
  for (const row of rows) {
    for (const col of cols) raw.set(`${col.ref}@${row.rowId}`, row.cells.get(col.colId) ?? "");
  }
  const defs = doc.getMap("raw").get("defs");
  let values = new Map<string, unknown>();
  try {
    values = evaluateAll(
      raw,
      rows.map((r) => r.rowId),
      defs && typeof defs === "object" ? (defs as Record<string, unknown>) : {},
      cols.map((c) => c.ref),
    ) as Map<string, unknown>;
  } catch {
    // A broken formula graph shows raw text.
  }
  return { cols, rows, values };
}

function useTick(doc: Y.Doc | null, awareness: Awareness | null): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!doc) return;
    doc.on("update", bump);
    awareness?.on("change", bump);
    return () => {
      doc.off("update", bump);
      awareness?.off("change", bump);
    };
  }, [doc, awareness]);
  return tick;
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
  const urls = useUrls(file);
  if (!file) return <p>Add ?file=users/admin/name.ycsv</p>;
  if (!urls) return <p data-testid="sheet-loading">Signing in…</p>;
  return <SheetSession urls={urls} user={user} />;
}

function SheetSession({ urls, user }: { urls: DocsCollabUrls; user: string }) {
  const wire = useMemo(() => createWgwCollabWire(), []);
  const collab = useDocsCollab({ userName: user, autoJoin: true, urls, wire });
  const doc = collab.session?.ydoc ?? null;
  const awareness = collab.session?.awareness ?? null;
  useTick(doc, awareness);

  const undo = useMemo(() => (doc ? createSheetUndoManager(doc) : null), [doc]);
  useEffect(() => () => undo?.destroy(), [undo]);

  const [active, setActive] = useState<CellRef | null>(null);
  const [anchor, setAnchor] = useState<CellRef | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Row order when the editor opened: references typed in it resolve against this.
  const [base, setBase] = useState<EditBase | null>(null);

  const { onMarkdownChange } = collab;
  const edited = useCallback(() => {
    if (doc) onMarkdownChange(() => readYcsv(doc));
  }, [doc, onMarkdownChange]);

  useEffect(() => {
    if (!awareness) return;
    const range: SheetPresence["range"] =
      anchor && active && (anchor.rowId !== active.rowId || anchor.colId !== active.colId)
        ? { anchor, head: active }
        : null;
    setLocalSheetPresence(awareness, { active, range, editing: editing !== null });
  }, [awareness, active, anchor, editing]);

  if (!doc || !awareness || !collab.joined || collab.awaitingContent) {
    return <p data-testid="sheet-loading">Joining…</p>;
  }

  const grid = readGrid(doc);
  const peers = readPeerSheetPresence(awareness);
  const rowIds = grid.rows.map((r) => r.rowId);
  const rowIndex = new Map(rowIds.map((id, i) => [id, i]));

  const peerRanges = peers
    .map((peer) => ({ peer, box: peer.range ? resolveRange(doc, peer.range) : null }))
    .filter(
      (p): p is { peer: PeerSheetPresence; box: NonNullable<typeof p.box> } => p.box !== null,
    );

  const select = (ref: CellRef, extend: boolean) => {
    setActive(ref);
    if (!extend) setAnchor(ref);
  };

  const commit = (ref: CellRef, text: string) => {
    setCell(doc, ref.rowId, ref.colId, text, base ?? undefined);
    // One undo step per committed edit, whatever the timing (not the 500 ms capture window).
    undo?.stopCapturing();
    setEditing(null);
    edited();
  };

  return (
    <div style={{ fontFamily: "system-ui", fontSize: 13, padding: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <strong>{urls.room}</strong>
        <span data-testid="sheet-status" data-peers={peers.length}>
          {collab.status} · {peers.length} peer(s) · {collab.pendingSync ? "unsaved" : "saved"}
          {collab.lastSavedAt ? ` · ${collab.lastSavedAt}` : ""}
        </span>
        <button
          data-testid="insert-row"
          onClick={() => {
            const at = active ? (rowIndex.get(active.rowId) ?? grid.rows.length - 1) : -1;
            insertRowAfter(doc, at);
            undo?.stopCapturing();
            edited();
          }}
        >
          Insert row below
        </button>
        <button
          data-testid="undo"
          data-depth={undo?.undoStack.length ?? 0}
          onClick={() => {
            undo?.undo();
            edited();
          }}
        >
          Undo
        </button>
        <button
          data-testid="redo"
          onClick={() => {
            undo?.redo();
            edited();
          }}
        >
          Redo
        </button>
        <button data-testid="save-now" onClick={() => void collab.saveNow()}>
          Save now
        </button>
      </div>
      <table style={{ borderCollapse: "collapse" }} data-testid="sheet-grid">
        <thead>
          <tr>
            <th />
            {grid.cols.map((col) => (
              <th key={col.colId} style={{ border: "1px solid #ccc", padding: "2px 6px" }}>
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, r) => (
            <tr key={row.rowId}>
              <th style={{ color: "#888", padding: "0 6px" }}>{r + 1}</th>
              {grid.cols.map((col, c) => {
                const ref = { rowId: row.rowId, colId: col.colId };
                const idForm = row.cells.get(col.colId) ?? "";
                const fileForm = toFileForm(idForm, grid.cols, rowIds, rowIndex);
                const value = grid.values.get(`${col.ref}@${row.rowId}`);
                const mine = active?.rowId === row.rowId && active.colId === col.colId;
                const peerHere = peers.find(
                  (p) => p.active?.rowId === row.rowId && p.active.colId === col.colId,
                );
                const inRange = peerRanges.find(
                  ({ box }) => r >= box.top && r <= box.bottom && c >= box.left && c <= box.right,
                );
                const isEditing = mine && editing !== null;
                return (
                  <td
                    key={col.colId}
                    data-testid={`cell-${r + 1}-${col.ref}`}
                    data-raw={fileForm}
                    data-value={value === undefined ? "" : String(value)}
                    data-peer-active={peerHere?.name ?? ""}
                    data-peer-editing={peerHere?.editing ? "true" : "false"}
                    data-peer-range={inRange?.peer.name ?? ""}
                    onMouseDown={(e) => select(ref, e.shiftKey)}
                    onDoubleClick={() => {
                      // The rows as rendered, not as the doc holds them now: a peer's
                      // insert may already be in the doc but not yet on screen.
                      setBase({ rowIds });
                      setEditing(fileForm);
                    }}
                    style={{
                      position: "relative",
                      border: "1px solid #ddd",
                      padding: "2px 6px",
                      minWidth: 80,
                      background: inRange ? `${inRange.peer.color}22` : undefined,
                      outline: mine
                        ? "2px solid #1a73e8"
                        : peerHere
                          ? `2px solid ${peerHere.color}`
                          : undefined,
                      outlineOffset: -2,
                    }}
                  >
                    {peerHere ? (
                      <span
                        style={{
                          position: "absolute",
                          top: -14,
                          right: 0,
                          fontSize: 10,
                          color: "white",
                          background: peerHere.color,
                          padding: "0 3px",
                        }}
                      >
                        {peerHere.name}
                        {peerHere.editing ? " ✎" : ""}
                      </span>
                    ) : null}
                    {isEditing ? (
                      <input
                        autoFocus
                        data-testid="cell-editor"
                        defaultValue={editing ?? ""}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commit(ref, e.currentTarget.value);
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : value === undefined || value === "" ? (
                      fileForm
                    ) : (
                      String(value)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
