import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { createSheetUndoManager, readPeerSheetPresence } from "../sheets-core/collab";
import { createValueSource, type EngineMode, type ValueSource } from "../sheets-core/engine/host";
import { addSheet, Workbook } from "../sheets-core/model";
import type { Selection } from "./selection";
import { SheetGrid } from "./SheetGrid";
import type { TouchVariant } from "./touch";

type User = { id: string; name: string; color: string };

export type WorkbookViewProps = {
  doc: Y.Doc;
  /** Where formulas are evaluated: in this thread or in a worker replica. */
  engine?: EngineMode;
  theme?: "light" | "dark";
  awareness?: Awareness;
  user?: User;
  focusModel?: "descendant" | "cell";
  remoteWindowMs?: number;
  autoFocus?: boolean;
  touchVariant?: TouchVariant;
  overscan?: number;
  /** Hide the tab strip for single-sheet stories that match the old spikes' layout. */
  tabs?: "auto" | "always" | "never";
  /** Test hook: the live value source and undo manager. */
  onReady?: (ctx: { book: Workbook; values: ValueSource; undo: Y.UndoManager; activeSheet: () => string }) => void;
};

/**
 * Integration slice: a workbook = sheet tabs + one SheetGrid for the active tab.
 * Owns what is per workbook, not per sheet: the Workbook view cache, the value
 * source (one engine for all sheets, so cross-sheet refs work), and the person's
 * UndoManager (one stack across tabs; a step of another tab switches to it).
 */
export function WorkbookView({ doc, engine = "main", tabs = "auto", awareness, onReady, theme = "light", ...grid }: WorkbookViewProps) {
  const book = useMemo(() => new Workbook(doc), [doc]);
  useEffect(() => () => book.destroy(), [book]);
  const values = useMemo(() => createValueSource(doc, engine), [doc, engine]);
  useEffect(() => () => values.destroy(), [values]);
  const undo = useMemo(() => createSheetUndoManager(doc), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);

  useSyncExternalStore(book.subscribe, book.getVersion);
  const ids = book.sheetIds();
  /** `focus`: the switch came from the keyboard (undo/redo into another tab), so the new grid takes focus. */
  const [active, setActive] = useState<{ id: string; sel?: Selection; focus?: boolean }>(() => ({ id: ids[0] ?? "" }));
  const activeId = ids.includes(active.id) ? active.id : (ids[0] ?? "");

  useEffect(() => {
    onReady?.({ book, values, undo, activeSheet: () => activeId });
  }, [onReady, book, values, undo, activeId]);

  // Integration: the grid is keyed by sheet, so a tab switch remounts it. Without focusing the
  // new one, the next Cmd+Z after an undo that switched tabs went nowhere (two-browser e2e).
  const onStepElsewhere = useCallback((sheetId: string, sel: Selection | undefined) => setActive({ id: sheetId, sel, focus: true }), []);

  // Peers per tab (presence carries the sheet id).
  const [peers, setPeers] = useState<{ sheetId: string; name: string; color: string }[]>([]);
  useEffect(() => {
    if (!awareness) return;
    const read = () => setPeers(readPeerSheetPresence(awareness).map((p) => ({ sheetId: p.sheetId, name: p.name, color: p.color })));
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [awareness]);

  const showTabs = tabs === "always" || (tabs === "auto" && ids.length > 1);
  const dark = theme === "dark";
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      {activeId ? (
        <SheetGrid
          key={activeId}
          book={book}
          sheetId={activeId}
          values={values}
          undo={undo}
          onStepElsewhere={onStepElsewhere}
          initialSel={active.id === activeId ? active.sel : undefined}
          awareness={awareness}
          theme={theme}
          {...grid}
          autoFocus={grid.autoFocus || (active.id === activeId && active.focus === true)}
        />
      ) : null}
      {showTabs ? (
        <div
          role="tablist"
          aria-label="Sheets"
          style={{
            display: "flex",
            gap: 2,
            padding: "2px 6px",
            borderTop: `1px solid ${dark ? "#2e2e33" : "#e4e4e7"}`,
            background: dark ? "#1f1f23" : "#fafafa",
            overflowX: "auto",
          }}
        >
          {ids.map((id) => {
            const view = book.view(id);
            const here = peers.filter((p) => p.sheetId === id);
            const selected = id === activeId;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={selected}
                data-testid="sheet-tab"
                data-sheet-id={id}
                onClick={() => setActive({ id })}
                style={{
                  font: "500 13px system-ui",
                  border: 0,
                  borderRadius: 4,
                  padding: "4px 10px",
                  minHeight: 28,
                  background: selected ? (dark ? "#2e2e33" : "#fff") : "transparent",
                  color: dark ? "#e4e4e7" : "#27272a",
                  boxShadow: selected ? "0 0 0 1px #d4d4d8" : undefined,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {view?.name || view?.ref || id}
                {here.map((p) => (
                  <span key={p.name} title={p.name} aria-label={`${p.name} is here`} data-testid="tab-peer" style={{ width: 6, height: 6, borderRadius: 3, background: p.color }} />
                ))}
              </button>
            );
          })}
          <button
            aria-label="Add sheet"
            data-testid="add-sheet"
            onClick={() => setActive({ id: addSheet(doc) })}
            style={{ font: "500 13px system-ui", border: 0, background: "transparent", color: "inherit", minWidth: 28 }}
          >
            +
          </button>
        </div>
      ) : null}
    </div>
  );
}
