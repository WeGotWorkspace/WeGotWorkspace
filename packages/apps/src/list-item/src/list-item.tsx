import { useRef, type CSSProperties, type ReactNode } from "react";
import { Archive } from "lucide-react";
import {
  SwipeableListItem,
  SwipeAction as SwipeActionPrimitive,
  TrailingActions,
  LeadingActions,
} from "react-swipeable-list";
import { useListItemEventDelegation } from "@/list-item/src/list-item-delegation";
import {
  useHasListSelectionStore,
  useListItemHighlight,
} from "@/list-item/src/list-item-selection";
import { LIST_ITEM_LONG_PRESS_DELAY_MS } from "@/list-item/src/use-delegated-list-item-events";
import { SelectionMark } from "@/selection-mark/src/selection-mark";
import { installKeyboardFocusModality } from "@/ui/keyboard-focus";
import "./list-item.css";

// The focus ring is keyboard-only: a Cmd/Shift-click (multi-select) counts as
// keyboard for `:focus-visible`, so the ring also checks the last real input.
installKeyboardFocusModality();

export type SwipeAction = {
  icon: React.ReactNode;
  color: string;
  onActivate: () => void;
  label?: string;
  destructive?: boolean;
};

type ListItemTheme = {
  baseBackground: string;
  selectedBackground: string;
  borderColor: string;
  accentColor: string;
  titleColor: string;
  mutedColor: string;
  bodyColor: string;
};

type ListItemMetaPosition = "above" | "below";

type ListItemProps = {
  id: string;
  /**
   * Stable entity id. `react-swipeable-list` clones rows with `id="listItem-${index}"`,
   * which would otherwise become `data-list-item-id` and break selection.
   */
  itemId?: string;
  title: string;
  /** Meta line (folder, notebook, company, etc.). May include a leading icon. */
  subtitle: ReactNode;
  /**
   * `below` (Notes, Contacts): title with the date top right, an optional two-line
   * preview (`text`), then one quiet line `subtitle · icons`.
   * `above` (Mail-style): subtitle, icons and date in a header row over the title.
   */
  metaPosition?: ListItemMetaPosition;
  date: string;
  /** Marks right before the date in the top-right corner, e.g. a star (`below` only). */
  dateLeading?: ReactNode;
  icons?: ReactNode[];
  /** Secondary body line (excerpt, tags row, etc.). Omitted when empty and a title is present, unless `showEmptyText` is set. */
  text?: ReactNode;
  /** Keep the body line when `text` is empty, using `emptyText` as the placeholder (`above` only). */
  showEmptyText?: boolean;
  isActive: boolean;
  isSelected: boolean;
  selectionMode: boolean;
  isTouch: boolean;
  isDragging: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onLongPress?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  swipeLeftAction?: SwipeAction;
  swipeRightAction?: SwipeAction;
  emptyTitle?: string;
  emptyText?: string;
  theme?: Partial<ListItemTheme>;
  /** Optional leading slot (e.g. avatar) rendered inside the row highlight area. */
  leading?: React.ReactNode;
};

const defaultTheme: ListItemTheme = {
  baseBackground: "transparent",
  selectedBackground:
    "var(--sidebar-item-selected-background, var(--workspace-selected-background))",
  borderColor: "color-mix(in oklab, var(--workspace-foreground) 10%, transparent)",
  accentColor: "var(--color-emerald)",
  titleColor: "var(--workspace-foreground)",
  mutedColor: "color-mix(in oklab, var(--workspace-foreground) 65%, transparent)",
  bodyColor: "color-mix(in oklab, var(--workspace-foreground) 60%, transparent)",
};

const TOUCH_MOVE_CANCEL_PX = 8;
const DESTRUCTIVE_CALLBACK_DELAY_MS = 380;

function themeToCssVars(theme: Partial<ListItemTheme>): CSSProperties {
  const vars: Record<string, string> = {};
  if (theme.baseBackground) vars["--list-item-base-bg"] = theme.baseBackground;
  if (theme.selectedBackground) vars["--list-item-selected-bg"] = theme.selectedBackground;
  if (theme.borderColor) vars["--list-item-border-color"] = theme.borderColor;
  if (theme.accentColor) vars["--list-item-accent-color"] = theme.accentColor;
  if (theme.titleColor) vars["--list-item-title-color"] = theme.titleColor;
  if (theme.mutedColor) vars["--list-item-muted-color"] = theme.mutedColor;
  if (theme.bodyColor) vars["--list-item-body-color"] = theme.bodyColor;
  return vars as CSSProperties;
}

export function ListItem({
  id,
  itemId,
  title,
  subtitle,
  metaPosition = "above",
  date,
  dateLeading,
  icons = [],
  text,
  showEmptyText = false,
  isActive,
  isSelected,
  selectionMode,
  isTouch,
  isDragging,
  onClick,
  onDoubleClick,
  onLongPress,
  onDragStart,
  onDragEnd,
  swipeLeftAction,
  swipeRightAction,
  emptyTitle = "Untitled",
  emptyText = "Empty item",
  theme,
  leading,
}: ListItemProps) {
  const entityId = itemId ?? id;
  const delegated = useListItemEventDelegation();
  const hasSelectionStore = useHasListSelectionStore();
  const highlight = useListItemHighlight(entityId, { isActive, isSelected });
  const palette = { ...defaultTheme, ...theme };
  const themeVars = theme ? themeToCssVars(palette) : undefined;
  // The calm `below` layout has no placeholder body: an untitled row already reads as empty.
  const bodyContent =
    text || (metaPosition === "above" && (showEmptyText || !title) ? emptyText : null);
  const bodyIsPlaceholder = !text && bodyContent != null;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const longPressBlockedBySwipeRef = useRef(false);
  const touchStartYRef = useRef<number | null>(null);

  const startLongPress = (e: React.TouchEvent<HTMLButtonElement>) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
    longPressBlockedBySwipeRef.current = false;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      if (longPressBlockedBySwipeRef.current) return;
      longPressFired.current = true;
      onLongPress?.();
      if ("vibrate" in navigator) navigator.vibrate?.(15);
    }, LIST_ITEM_LONG_PRESS_DELAY_MS);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLButtonElement>) => {
    const startY = touchStartYRef.current;
    const touch = e.touches[0];
    if (!touch || startY === null) return;
    if (Math.abs(touch.clientY - startY) > TOUCH_MOVE_CANCEL_PX) cancelLongPress();
  };

  const resetTouchIntent = () => {
    cancelLongPress();
    touchStartYRef.current = null;
  };

  const button = (
    <button
      type="button"
      data-list-item-id={entityId}
      data-active={highlight.isActive ? "true" : "false"}
      data-selected={highlight.isSelected ? "true" : "false"}
      {...(hasSelectionStore ? {} : { "data-selection-mode": selectionMode ? "true" : "false" })}
      data-dragging={isDragging ? "true" : "false"}
      onClick={
        delegated
          ? undefined
          : (e) => {
              if (longPressFired.current || longPressBlockedBySwipeRef.current) {
                e.preventDefault();
                return;
              }
              onClick?.(e);
            }
      }
      onDoubleClick={delegated ? undefined : onDoubleClick}
      onMouseDown={
        delegated
          ? undefined
          : (e) => {
              if (e.shiftKey) e.preventDefault();
            }
      }
      onTouchStart={!delegated && isTouch ? startLongPress : undefined}
      onTouchEnd={!delegated ? resetTouchIntent : undefined}
      onTouchCancel={!delegated ? resetTouchIntent : undefined}
      onTouchMove={!delegated ? handleTouchMove : undefined}
      onContextMenu={
        delegated
          ? undefined
          : (e) => {
              if (isTouch) e.preventDefault();
            }
      }
      draggable={!isTouch}
      onDragStart={
        delegated
          ? undefined
          : (e) => {
              onDragStart?.();
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", entityId);
            }
      }
      onDragEnd={delegated ? undefined : onDragEnd}
      className={`list-item__button${leading ? " list-item__button--with-leading" : ""}`}
      style={themeVars}
    >
      <span aria-hidden className="list-item__checkbox-wrap">
        <SelectionMark checked={highlight.isSelected} />
      </span>

      {leading ? <span className="list-item__leading">{leading}</span> : null}

      <div className="list-item__content">
        {metaPosition === "above" ? (
          <div className="list-item__header-row">
            <span className="list-item__subtitle">{subtitle}</span>
            <span className="list-item__meta-trailing">
              {icons.map((icon, index) => (
                <span key={`${entityId}-icon-${index}`} className="list-item__icon-slot">
                  {icon}
                </span>
              ))}
              <span className="list-item__date">{date}</span>
            </span>
          </div>
        ) : null}

        {metaPosition === "below" ? (
          /* Suite list norm: title with the date top right, an optional preview, then
             one quiet meta line (where · status). */
          <>
            <div className="list-item__title-row">
              <h3 className="list-item__title" data-empty={title ? "false" : "true"}>
                {title || emptyTitle}
              </h3>
              {date || dateLeading ? (
                <span className="list-item__title-trailing">
                  {dateLeading ? (
                    <span className="list-item__date-leading">{dateLeading}</span>
                  ) : null}
                  {date ? <span className="list-item__date">{date}</span> : null}
                </span>
              ) : null}
            </div>
            {bodyContent ? (
              <div className="list-item__body list-item__body--preview">{bodyContent}</div>
            ) : null}
            {subtitle || icons.length > 0 ? (
              <div className="list-item__meta">
                {subtitle ? (
                  <span className="list-item__meta-segment list-item__subtitle--below">
                    {subtitle}
                  </span>
                ) : null}
                {icons.length > 0 ? (
                  <span className="list-item__meta-trailing">
                    {icons.map((icon, index) => (
                      <span key={`${entityId}-icon-${index}`} className="list-item__icon-slot">
                        {icon}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <h3
              className="list-item__title list-item__title--standalone"
              data-empty={title ? "false" : "true"}
            >
              {title || emptyTitle}
            </h3>
            {bodyContent ? (
              <div className="list-item__body" data-empty={bodyIsPlaceholder ? "true" : "false"}>
                {bodyContent}
              </div>
            ) : null}
          </>
        )}
      </div>
    </button>
  );

  if (!isTouch) return button;

  // react-swipeable-list calls onClick with no args after a full swipe (setTimeout).
  // Do not touch the event — reading stopPropagation throws and aborts the action.
  const leadingActions = swipeLeftAction ? (
    <LeadingActions>
      <SwipeActionPrimitive
        onClick={() => swipeLeftAction.onActivate()}
        destructive={swipeLeftAction.destructive}
      >
        <div
          className="list-item__swipe-action"
          style={{ "--list-item-swipe-bg": swipeLeftAction.color } as CSSProperties}
        >
          {swipeLeftAction.icon}
          {swipeLeftAction.label ?? "Action"}
        </div>
      </SwipeActionPrimitive>
    </LeadingActions>
  ) : null;

  const trailingActions = swipeRightAction ? (
    <TrailingActions>
      <SwipeActionPrimitive
        onClick={() => swipeRightAction.onActivate()}
        destructive={swipeRightAction.destructive}
      >
        <div
          className="list-item__swipe-action"
          style={{ "--list-item-swipe-bg": swipeRightAction.color } as CSSProperties}
        >
          {swipeRightAction.icon ?? <Archive className="size-5" />}
          {swipeRightAction.label ?? "Action"}
        </div>
      </SwipeActionPrimitive>
    </TrailingActions>
  ) : null;

  if (!leadingActions && !trailingActions) return button;

  return (
    <SwipeableListItem
      leadingActions={leadingActions ?? undefined}
      trailingActions={trailingActions ?? undefined}
      threshold={0.3}
      destructiveCallbackDelay={DESTRUCTIVE_CALLBACK_DELAY_MS}
      swipeStartThreshold={4}
      onSwipeStart={() => {
        longPressBlockedBySwipeRef.current = true;
        cancelLongPress();
      }}
      onSwipeProgress={(progress) => {
        if (progress <= 0) return;
        longPressBlockedBySwipeRef.current = true;
        cancelLongPress();
      }}
      onSwipeEnd={() => {
        longPressBlockedBySwipeRef.current = false;
      }}
    >
      {button}
    </SwipeableListItem>
  );
}
