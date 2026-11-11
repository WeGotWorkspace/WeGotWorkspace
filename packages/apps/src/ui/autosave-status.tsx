import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { workspaceLabels } from "@/lib/workspace/workspace-labels";
import { cn } from "@/lib/utils";
import { Tag, type TagTone } from "@/tag/src/tag";
import "@/ui/autosave-status.css";

/**
 * Save state of the autosaving forms inside one surface (a dialog with only Done).
 * Each form reports its own state; the surface shows one tag: Saving while any form
 * is saving, Unsaved while any form holds a change that could not be stored, Saved
 * otherwise.
 */

export type AutosaveStatus = "saved" | "saving" | "unsaved";

/** How long Saved stays before it fades: long enough to read, then out of the way. */
export const AUTOSAVE_SAVED_VISIBLE_MS = 2000;

/** The tag resizes to its new label like the list rows move (same easing). */
const RESIZE_DURATION_MS = 200;
const RESIZE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

type AutosaveStatusApi = {
  report: (id: string, status: AutosaveStatus | null) => void;
};

const AutosaveStatusReportContext = createContext<AutosaveStatusApi | null>(null);
const AutosaveStatusValueContext = createContext<AutosaveStatus>("saved");

function combinedStatus(statuses: ReadonlyMap<string, AutosaveStatus>): AutosaveStatus {
  const all = [...statuses.values()];
  if (all.includes("saving")) return "saving";
  if (all.includes("unsaved")) return "unsaved";
  return "saved";
}

export function AutosaveStatusProvider({ children }: { children: ReactNode }): ReactNode {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, AutosaveStatus>>(() => new Map());

  const report = useCallback((id: string, status: AutosaveStatus | null) => {
    setStatuses((current) => {
      if ((current.get(id) ?? null) === status) return current;
      const next = new Map(current);
      if (status) next.set(id, status);
      else next.delete(id);
      return next;
    });
  }, []);

  const api = useMemo(() => ({ report }), [report]);

  return (
    <AutosaveStatusReportContext.Provider value={api}>
      <AutosaveStatusValueContext.Provider value={combinedStatus(statuses)}>
        {children}
      </AutosaveStatusValueContext.Provider>
    </AutosaveStatusReportContext.Provider>
  );
}

/** Report this form's save state to the surrounding surface, if it shows one. */
export function useReportAutosaveStatus(status: AutosaveStatus): void {
  const api = useContext(AutosaveStatusReportContext);
  const id = useId();

  useEffect(() => {
    api?.report(id, status);
  }, [api, id, status]);

  useEffect(() => () => api?.report(id, null), [api, id]);
}

const STATUS_TONE: Record<AutosaveStatus, TagTone> = {
  saved: "success",
  saving: "pending",
  unsaved: "warning",
};

/**
 * The save state for a dialog header's end slot. Hidden until the user changes
 * something (nothing has been saved yet when the dialog opens). When the label
 * changes the tag glides to its new width; Saved fades out after a moment (the tag
 * keeps its place).
 */
export function AutosaveStatusTag(): ReactNode {
  const status = useContext(AutosaveStatusValueContext);
  const [faded, setFaded] = useState(true);
  const changedRef = useRef(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const widthRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "saved") changedRef.current = true;
    if (!changedRef.current) return;
    setFaded(false);
    if (status !== "saved") return;
    const timer = setTimeout(() => setFaded(true), AUTOSAVE_SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // CSS cannot transition `width: auto` to `auto` when only the text changes, so
  // animate from the width before this render to the width after it.
  useLayoutEffect(() => {
    const tag = rootRef.current?.firstElementChild;
    if (!(tag instanceof HTMLElement)) return;
    // A state change mid-glide starts from where the tag is now.
    const running = tag.getAnimations();
    const previous = running.length > 0 ? tag.getBoundingClientRect().width : widthRef.current;
    for (const animation of running) animation.cancel();
    const next = tag.getBoundingClientRect().width;
    widthRef.current = next;
    if (previous === null || Math.abs(previous - next) < 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    tag.animate([{ width: `${previous}px` }, { width: `${next}px` }], {
      duration: RESIZE_DURATION_MS,
      easing: RESIZE_EASING,
    });
  }, [status]);

  return (
    <span
      ref={rootRef}
      role="status"
      className={cn("autosave-status", faded && "autosave-status--faded")}
    >
      <Tag label={workspaceLabels.dialog[status]} tone={STATUS_TONE[status]} dot />
    </span>
  );
}
