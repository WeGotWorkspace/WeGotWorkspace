import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { deleteRow, insertRowAfter, setCell } from "../ycsv-model/mutate";
import { toFileForm, toIdForm } from "../ycsv-model/refs";
import "./Grid.css";
import { formatValue } from "./format";
import { useSheet } from "./useSheet";

type User = { id: string; name: string; color: string };
type Props = { doc: Y.Doc; awareness: Awareness; user: User };
type Peer = { clientId: number; user: User; cursor: { rowId: string; colId: string } | null };

export function Grid({ doc, awareness, user }: Props) {
  const { columns, rows, values } = useSheet(doc);
  const [rowIndex, setRowIndex] = useState(0);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [colIndex, setColIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const editingRef = useRef(false);
  const idDraftRef = useRef("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const rowCount = rows.length;
  const colCount = columns.length;
  const anchored = anchorId === null ? -1 : rows.findIndex((row) => row.rowId === anchorId);
  const safeRow = rowCount === 0 ? 0 : anchored >= 0 ? anchored : Math.min(rowIndex, rowCount - 1);
  const safeCol = colCount === 0 ? 0 : Math.min(colIndex, colCount - 1);
  const selectedRow = rows[safeRow];
  const selectedCol = columns[safeCol];
  const cols = columns.map((column) => ({ colId: column.colId, ref: column.ref }));
  const rowIds = rows.map((row) => row.rowId);
  const rowKey = rowIds.join("\n");
  const colKey = cols.map((column) => `${column.colId}:${column.ref}`).join("\n");

  useEffect(() => {
    const row = rows[safeRow];
    if (!row) {
      if (anchorId !== null) setAnchorId(null);
      return;
    }
    if (row.rowId !== anchorId) setAnchorId(row.rowId);
  }, [rows, safeRow, anchorId]);

  useEffect(() => {
    if (!editingRef.current) return;
    setDraft(toFileForm(idDraftRef.current, cols, rowIds));
  }, [rowKey, colKey]);

  useEffect(() => {
    const cursor =
      selectedRow && selectedCol ? { rowId: selectedRow.rowId, colId: selectedCol.colId } : null;
    awareness.setLocalState({ user, cursor });
  }, [awareness, user, selectedRow, selectedCol]);

  useLayoutEffect(() => {
    if (performance.getEntriesByName("commit").length === 0) return;
    requestAnimationFrame(() => {
      if (performance.getEntriesByName("commit").length === 0) return;
      performance.measure("commit→paint", "commit");
      performance.clearMarks("commit");
      const painted = (window as Window & { __ycsvPainted?: () => void }).__ycsvPainted;
      painted?.();
    });
  }, [values]);

  useEffect(() => {
    const read = () => {
      const next: Peer[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID || !state) return;
        const record = state as { user?: User; cursor?: Peer["cursor"] };
        if (!record.user) return;
        next.push({ clientId, user: record.user, cursor: record.cursor ?? null });
      });
      setPeers(next);
    };
    awareness.on("change", read);
    read();
    return () => {
      awareness.off("change", read);
    };
  }, [awareness]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function fileForm(raw: string): string {
    return toFileForm(
      raw,
      columns.map((column) => ({ colId: column.colId, ref: column.ref })),
      rows.map((row) => row.rowId),
    );
  }

  function selectIndex(index: number) {
    if (rowCount === 0) return;
    const next = Math.max(0, Math.min(index, rowCount - 1));
    setRowIndex(next);
    setAnchorId(rows[next]?.rowId ?? null);
  }

  function beginEdit(initial: string) {
    if (!selectedRow || !selectedCol) return;
    editingRef.current = true;
    idDraftRef.current = toIdForm(initial, cols, rowIds);
    setDraft(initial);
    setEditing(true);
  }

  function commit(move: "down" | "none") {
    if (!editingRef.current || !selectedRow || !selectedCol) return;
    editingRef.current = false;
    setEditing(false);
    setCell(doc, selectedRow.rowId, selectedCol.colId, toFileForm(idDraftRef.current, cols, rowIds));
    if (move === "down") selectIndex(safeRow + 1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (editingRef.current) {
      if (event.key === "Enter") {
        event.preventDefault();
        commit("down");
      } else if (event.key === "Escape") {
        event.preventDefault();
        editingRef.current = false;
        setEditing(false);
      }
      return;
    }
    if (rowCount === 0 || colCount === 0) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectIndex(safeRow - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      selectIndex(safeRow + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setColIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setColIndex((index) => Math.min(colCount - 1, index + 1));
    } else if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) {
        if (safeCol > 0) setColIndex(safeCol - 1);
        else if (safeRow > 0) {
          selectIndex(safeRow - 1);
          setColIndex(colCount - 1);
        }
      } else if (safeCol < colCount - 1) setColIndex(safeCol + 1);
      else if (safeRow < rowCount - 1) {
        selectIndex(safeRow + 1);
        setColIndex(0);
      }
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      const raw = selectedRow && selectedCol ? (selectedRow.cells[selectedCol.colId] ?? "") : "";
      beginEdit(fileForm(raw));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (selectedRow && selectedCol) setCell(doc, selectedRow.rowId, selectedCol.colId, "");
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      beginEdit(event.key);
    }
  }

  function selectCell(event: MouseEvent, row: number, col: number) {
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    event.preventDefault();
    if (editingRef.current) commit("none");
    selectIndex(row);
    setColIndex(col);
    wrapRef.current?.focus();
  }

  return (
    <div className="ycsv-grid" ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="ycsv-grid-actions">
        <button type="button" onClick={() => insertRowAfter(doc, rowCount === 0 ? -1 : safeRow)}>
          Rij toevoegen
        </button>
        <button
          type="button"
          onClick={() => {
            if (selectedRow) deleteRow(doc, selectedRow.rowId);
          }}
          disabled={!selectedRow}
        >
          Rij verwijderen
        </button>
      </div>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.colId}>{column.name ?? column.ref}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.rowId}>
              {columns.map((column, c) => {
                const here = peers
                  .filter((peer) => peer.cursor?.rowId === row.rowId && peer.cursor.colId === column.colId)
                  .sort((a, b) => a.clientId - b.clientId);
                const value = values.get(`${column.ref}@${row.rowId}`);
                const selected = r === safeRow && c === safeCol;
                return (
                  <td
                    key={column.colId}
                    data-row={row.rowId}
                    data-col={column.colId}
                    className={selected ? "is-selected" : undefined}
                    style={
                      here.length > 0
                        ? { boxShadow: here.map((peer) => `inset 0 0 0 2px ${peer.user.color}`).join(", ") }
                        : undefined
                    }
                    onMouseDown={(event) => selectCell(event, r, c)}
                  >
                    {selected && editing ? (
                      <input
                        ref={inputRef}
                        value={draft}
                        onChange={(event) => {
                          const value = event.target.value;
                          idDraftRef.current = toIdForm(value, cols, rowIds);
                          setDraft(value);
                        }}
                        onBlur={() => commit("none")}
                      />
                    ) : (
                      formatValue(value ?? "", {
                        type: column.type,
                        currency: column.currency,
                        locale: column.locale,
                      })
                    )}
                    {here.map((peer, index) => (
                      <span
                        key={peer.clientId}
                        className="ycsv-peer-label"
                        style={{ background: peer.user.color, top: `${-1.2 * (index + 1)}em` }}
                      >
                        {peer.user.name}
                      </span>
                    ))}
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
