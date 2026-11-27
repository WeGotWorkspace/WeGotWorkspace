import { useEffect, useId, useRef, useState, type RefObject } from "react";

/**
 * Spike 8: the name box doubles as "Go to" (Ctrl+G, F6). It shows the selection and, while
 * focused, takes a reference such as `prijs3` or `aantal1:prijs4`. Enter goes, Escape returns.
 */
export function NameBox({
  inputRef,
  value,
  onGo,
  onLeave,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onGo: (text: string) => void;
  onLeave: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      ref={inputRef}
      className="sx-namebox"
      data-testid="namebox"
      aria-label="Name box. Type a cell to go to"
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const text = draft ?? value;
          setDraft(null);
          onGo(text);
        } else if (e.key === "Escape" || e.key === "F6") {
          e.preventDefault();
          setDraft(null);
          onLeave();
        }
      }}
    />
  );
}

/** Keyboard route for column resize (the drag handle is pointer-only). Save/Cancel: it edits the document. */
export function WidthDialog({
  title,
  initial,
  onSave,
  onCancel,
}: {
  title: string;
  initial: number;
  onSave: (width: number) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(String(initial));
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const n = Number(value);
  const valid = Number.isFinite(n) && n >= 24 && n <= 1000;
  return (
    <div className="sx-dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="sx-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        data-testid="width-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Tab") {
            // Keep focus inside the dialog.
            const els = [...e.currentTarget.querySelectorAll<HTMLElement>("input, button:not([disabled])")];
            const at = els.indexOf(document.activeElement as HTMLElement);
            const next = els[(at + (e.shiftKey ? els.length - 1 : 1)) % els.length];
            e.preventDefault();
            next?.focus();
          }
        }}
      >
        <h2 id={`${id}-t`} className="sx-dialog-title">
          {title}
        </h2>
        <label className="sx-dialog-row">
          <span>Width in pixels</span>
          <input
            ref={ref}
            type="number"
            min={24}
            max={1000}
            value={value}
            aria-invalid={!valid}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) {
                e.preventDefault();
                onSave(n);
              }
            }}
          />
        </label>
        <div className="sx-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={!valid} onClick={() => onSave(n)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
