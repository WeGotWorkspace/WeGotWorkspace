import { useEffect, useRef, type KeyboardEvent } from "react";

export type MenuItem = { id: string; label: string; shortcut?: string; disabled?: boolean; onSelect: () => void } | "sep";

/**
 * Minimal menu for the spike: role=menu, roving focus with arrows/Home/End,
 * Enter/Space to run, Escape to close. In the app this is the suite ContextMenu.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
  label,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: (refocus: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  /**
   * Lifting the finger after a long-press can land as a click on whatever item
   * opened under it. Pointer clicks count only once a press started inside the
   * menu; keyboard activation (detail 0) always counts.
   */
  const pressed = useRef(false);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [onClose]);

  // Keep the menu on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
  }, [x, y]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => all[(i + all.length) % all.length]?.focus();
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(all.length - 1);
    else if (event.key === "Escape" || event.key === "Tab") onClose(true);
    else if (event.key === "Enter" || event.key === " ") (document.activeElement as HTMLElement | null)?.click();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={ref}
      className="sx-popover sx-menu"
      role="menu"
      aria-label={label}
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={() => {
        pressed.current = true;
      }}
    >
      {items.map((item, i) =>
        item === "sep" ? (
          <div key={`sep${i}`} className="sx-menusep" role="separator" />
        ) : (
          <div
            key={item.id}
            role="menuitem"
            tabIndex={-1}
            data-menu-id={item.id}
            aria-disabled={item.disabled ? "true" : undefined}
            className="sx-menuitem"
            onClick={(event) => {
              if (item.disabled) return;
              if (event.detail > 0 && !pressed.current) return;
              onClose(true);
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
          </div>
        ),
      )}
    </div>
  );
}
