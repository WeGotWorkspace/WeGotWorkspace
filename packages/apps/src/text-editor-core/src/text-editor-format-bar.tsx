import { useState, type ReactNode } from "react";
import { Editor } from "@tiptap/react";
import { useTextEditorFormatBarState } from "@/text-editor-core/src/use-text-editor-format-bar-state";
import {
  Bold,
  ChevronDown,
  Code,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Printer,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { printTextEditorSheet } from "@/text-editor-core/src/text-editor-print";
import { Button, IconButton } from "@/button/src/button";
import { ICON_BUTTON_ACTIVE_CLASSNAME } from "@/button/src/button.shared";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";
import {
  TEXT_EDITOR_FORMAT_BAR_FULL,
  type TextEditorFormatBarConfig,
  type TextEditorFormatBarGroup,
} from "@/text-editor-core/src/text-editor-format-bar-config";

type EditorChain = ReturnType<Editor["chain"]>;

function FormatBarIconButton({
  label,
  onClick,
  active,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  icon: ReactNode;
}) {
  return (
    <IconButton
      label={label}
      icon={icon}
      onClick={onClick}
      active={active}
      disabled={disabled}
      size="sm"
      variant="outline"
      aria-pressed={active || undefined}
    />
  );
}

const FormatBarSeparator = () => <div className="text-editor-format-bar__sep" />;

export type TextEditorFormatBarProps = {
  editor: Editor | null;
  /** Toolbar sections to show. Defaults to all groups. */
  groups?: readonly TextEditorFormatBarGroup[];
  /** Show a print action that calls `window.print()`. */
  showPrint?: boolean;
  /**
   * When true, disable formatting controls (history, marks, blocks, link, print).
   * Comment and trailing slots stay independently controlled by the caller.
   */
  formattingDisabled?: boolean;
  /** Optional control rendered inline after the link group (e.g. add comment). */
  commentControl?: ReactNode;
  /** Optional controls rendered at the trailing edge of the bar. */
  trailing?: ReactNode;
  className?: string;
};

export function TextEditorFormatBar({
  editor,
  groups = TEXT_EDITOR_FORMAT_BAR_FULL,
  showPrint = true,
  formattingDisabled = false,
  commentControl,
  trailing,
  className,
}: TextEditorFormatBarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const enabled = new Set(groups);

  const state = useTextEditorFormatBarState(editor);

  if (!editor || !state) return null;

  const chain = (): EditorChain => editor.chain().focus();

  const openLinkDialog = () => {
    setLinkUrl(state.currentHref || "");
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url) {
      chain().unsetLink().run();
    } else {
      chain().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkOpen(false);
  };

  const removeLink = () => {
    chain().unsetLink().run();
    setLinkOpen(false);
  };

  const showHistory = enabled.has("history");
  const showHeading = enabled.has("heading");
  const showMarksBasic = enabled.has("marksBasic");
  const showMarksExtra = enabled.has("marksExtra");
  const showMarks = showMarksBasic || showMarksExtra;
  const showBlocksBasic = enabled.has("blocksBasic");
  const showBlocksExtra = enabled.has("blocksExtra");
  const showBlocks = showBlocksBasic || showBlocksExtra;
  const showLink = enabled.has("link");
  const showComment = Boolean(commentControl);
  const hasContentBeforeComment = showLink || showHistory || showHeading || showMarks || showBlocks;
  const headingActive = state.headingLevel > 0;

  if (
    !showHistory &&
    !showHeading &&
    !showMarks &&
    !showBlocks &&
    !showLink &&
    !showComment &&
    !showPrint &&
    !trailing
  ) {
    return null;
  }

  return (
    <div className={cn("text-editor-format-bar no-print", className)}>
      <div className="text-editor-format-bar__controls">
        {showHistory ? (
          <>
            <FormatBarIconButton
              label="Undo"
              disabled={formattingDisabled || !state.canUndo}
              onClick={() => chain().undo().run()}
              icon={<Undo2 />}
            />
            <FormatBarIconButton
              label="Redo"
              disabled={formattingDisabled || !state.canRedo}
              onClick={() => chain().redo().run()}
              icon={<Redo2 />}
            />
          </>
        ) : null}
        {showHistory && (showHeading || showMarks || showBlocks || showLink) ? (
          <FormatBarSeparator />
        ) : null}
        {showHeading ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                aria-label="Heading level"
                disabled={formattingDisabled}
                aria-pressed={headingActive || undefined}
                size="sm"
                variant="outline"
                className={cn(
                  "text-editor-format-bar__heading-trigger",
                  headingActive && ICON_BUTTON_ACTIVE_CLASSNAME,
                )}
              >
                <span className="text-editor-format-bar__heading-trigger-label">
                  {headingActive ? `H${state.headingLevel}` : "Text"}
                </span>
                <ChevronDown className="text-editor-format-bar__heading-trigger-chevron" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="text-editor-format-bar__heading-menu">
              <DropdownMenuItem
                onClick={() => chain().setParagraph().run()}
                className={cn(
                  "text-editor-format-bar__heading-option",
                  state.headingLevel === 0 && "text-editor-format-bar__heading-option--selected",
                )}
              >
                <span className="text-editor-format-bar__heading-option-label">Text</span>
              </DropdownMenuItem>
              {([1, 2, 3, 4, 5, 6] as const).map((lvl) => (
                <DropdownMenuItem
                  key={lvl}
                  onClick={() => chain().toggleHeading({ level: lvl }).run()}
                  className={cn(
                    "text-editor-format-bar__heading-option",
                    state.headingLevel === lvl &&
                      "text-editor-format-bar__heading-option--selected",
                  )}
                >
                  <span className="text-editor-format-bar__heading-option-label">
                    Heading {lvl}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {showHeading && showMarks ? <FormatBarSeparator /> : null}
        {showMarksBasic ? (
          <>
            <FormatBarIconButton
              label="Bold"
              active={state.bold}
              disabled={formattingDisabled}
              onClick={() => chain().toggleBold().run()}
              icon={<Bold />}
            />
            <FormatBarIconButton
              label="Italic"
              active={state.italic}
              disabled={formattingDisabled}
              onClick={() => chain().toggleItalic().run()}
              icon={<Italic />}
            />
            <FormatBarIconButton
              label="Underline"
              active={state.underline}
              disabled={formattingDisabled}
              onClick={() => chain().toggleUnderline().run()}
              icon={<UnderlineIcon />}
            />
          </>
        ) : null}
        {showMarksExtra ? (
          <>
            <FormatBarIconButton
              label="Strike"
              active={state.strike}
              disabled={formattingDisabled}
              onClick={() => chain().toggleStrike().run()}
              icon={<Strikethrough />}
            />
            <FormatBarIconButton
              label="Inline code"
              active={state.code}
              disabled={formattingDisabled}
              onClick={() => chain().toggleCode().run()}
              icon={<Code />}
            />
            <FormatBarIconButton
              label="Highlight"
              active={state.highlight}
              disabled={formattingDisabled}
              onClick={() => chain().toggleHighlight().run()}
              icon={<Highlighter />}
            />
          </>
        ) : null}
        {showMarks && showBlocks ? <FormatBarSeparator /> : null}
        {showBlocksBasic ? (
          <>
            <FormatBarIconButton
              label="Bullet list"
              active={state.bulletList}
              disabled={formattingDisabled}
              onClick={() => chain().toggleBulletList().run()}
              icon={<List />}
            />
            <FormatBarIconButton
              label="Ordered list"
              active={state.orderedList}
              disabled={formattingDisabled}
              onClick={() => chain().toggleOrderedList().run()}
              icon={<ListOrdered />}
            />
          </>
        ) : null}
        {showBlocksExtra ? (
          <>
            <FormatBarIconButton
              label="Task list"
              active={state.taskList}
              disabled={formattingDisabled}
              onClick={() => chain().toggleTaskList().run()}
              icon={<ListChecks />}
            />
            <FormatBarIconButton
              label="Blockquote"
              active={state.blockquote}
              disabled={formattingDisabled}
              onClick={() => chain().toggleBlockquote().run()}
              icon={<Quote />}
            />
            <FormatBarIconButton
              label="Divider"
              disabled={formattingDisabled}
              onClick={() => chain().setHorizontalRule().run()}
              icon={<Minus />}
            />
          </>
        ) : null}
        {/* Link sits in the blocksExtra cluster (quote / divider); sep only when blocks are off. */}
        {!showBlocks && (showMarks || showHeading || showHistory) && showLink ? (
          <FormatBarSeparator />
        ) : null}
        {showLink ? (
          <FormatBarIconButton
            label="Link"
            active={state.link}
            disabled={formattingDisabled}
            onClick={openLinkDialog}
            icon={<Link2 />}
          />
        ) : null}
        {showComment && hasContentBeforeComment ? <FormatBarSeparator /> : null}
        {commentControl}
      </div>
      {showPrint || trailing ? (
        <div className="text-editor-format-bar__end">
          {showPrint ? (
            <div className="text-editor-format-bar__print">
              <button
                type="button"
                disabled={formattingDisabled}
                onClick={() => printTextEditorSheet(editor)}
                className="text-editor-format-bar__print-btn"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
            </div>
          ) : null}
          {trailing}
        </div>
      ) : null}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{state.link ? "Edit link" : "Add link"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">URL</label>
            <Input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
              }}
              placeholder="https://example.com"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            {state.link ? (
              <Button type="button" variant="outline" onClick={removeLink}>
                Remove
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={applyLink}>
              {state.link ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { TextEditorFormatBarConfig, TextEditorFormatBarGroup };
export {
  TEXT_EDITOR_FORMAT_BAR_FULL,
  TEXT_EDITOR_FORMAT_BAR_GROUPS,
  TEXT_EDITOR_FORMAT_BAR_MAIL,
  resolveTextEditorFormatBarConfig,
} from "@/text-editor-core/src/text-editor-format-bar-config";
