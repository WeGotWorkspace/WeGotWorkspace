export type TextEditorSourceTabEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

function lineStartAt(value: string, position: number): number {
  const index = value.lastIndexOf("\n", position - 1);
  return index === -1 ? 0 : index + 1;
}

function lineEndAt(value: string, position: number): number {
  const index = value.indexOf("\n", position);
  return index === -1 ? value.length : index;
}

function lineIndexAt(value: string, position: number): number {
  let line = 0;
  for (let index = 0; index < position && index < value.length; index++) {
    if (value[index] === "\n") line++;
  }
  return line;
}

function selectionSpansMultipleLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): boolean {
  if (selectionStart === selectionEnd) return false;
  if (value.slice(selectionStart, selectionEnd).includes("\n")) return true;
  return lineIndexAt(value, selectionStart) !== lineIndexAt(value, selectionEnd);
}

function indentMultipleLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  tabSize: number,
): TextEditorSourceTabEdit {
  const spaces = " ".repeat(tabSize);
  const firstLineStart = lineStartAt(value, selectionStart);
  const lastLineEnd = lineEndAt(value, Math.max(selectionEnd - 1, selectionStart));

  const before = value.slice(0, firstLineStart);
  const selectedBlock = value.slice(firstLineStart, lastLineEnd);
  const after = value.slice(lastLineEnd);

  const lines = selectedBlock.split("\n");
  const indented = lines.map((line) => spaces + line).join("\n");
  const newValue = before + indented + after;

  const lineCount = lines.length;
  const addedPerLine = tabSize;
  const totalAdded = addedPerLine * lineCount;

  const newSelectionStart =
    selectionStart >= firstLineStart ? selectionStart + addedPerLine : selectionStart;
  const newSelectionEnd = selectionEnd + totalAdded;

  return {
    value: newValue,
    selectionStart: newSelectionStart,
    selectionEnd: newSelectionEnd,
  };
}

function outdentMultipleLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  tabSize: number,
): TextEditorSourceTabEdit {
  const firstLineStart = lineStartAt(value, selectionStart);
  const lastLineEnd = lineEndAt(value, Math.max(selectionEnd - 1, selectionStart));

  const before = value.slice(0, firstLineStart);
  const selectedBlock = value.slice(firstLineStart, lastLineEnd);
  const after = value.slice(lastLineEnd);

  const lines = selectedBlock.split("\n");
  let removedBeforeStart = 0;
  let removedBeforeEnd = 0;

  const outdented = lines
    .map((line, index) => {
      const removable = line.match(/^ */)?.[0]?.length ?? 0;
      const removeCount = Math.min(tabSize, removable);
      if (index === 0) {
        removedBeforeStart = removeCount;
      }
      removedBeforeEnd += removeCount;
      return line.slice(removeCount);
    })
    .join("\n");

  const newValue = before + outdented + after;
  const newSelectionStart =
    selectionStart >= firstLineStart
      ? Math.max(firstLineStart, selectionStart - removedBeforeStart)
      : selectionStart;
  const newSelectionEnd = Math.max(newSelectionStart, selectionEnd - removedBeforeEnd);

  return {
    value: newValue,
    selectionStart: newSelectionStart,
    selectionEnd: newSelectionEnd,
  };
}

function insertSpacesAtSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  tabSize: number,
): TextEditorSourceTabEdit {
  const spaces = " ".repeat(tabSize);
  const newValue = value.slice(0, selectionStart) + spaces + value.slice(selectionEnd);
  const caret = selectionStart + tabSize;
  return { value: newValue, selectionStart: caret, selectionEnd: caret };
}

function outdentSingleLine(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  tabSize: number,
): TextEditorSourceTabEdit {
  const lineStart = lineStartAt(value, selectionStart);
  const linePrefix = value.slice(lineStart, selectionStart);
  const removable = linePrefix.match(/^ */)?.[0]?.length ?? 0;
  const removeCount = Math.min(tabSize, removable);
  if (removeCount === 0) {
    return { value, selectionStart, selectionEnd };
  }

  const newValue = value.slice(0, lineStart) + value.slice(lineStart + removeCount);
  return {
    value: newValue,
    selectionStart: selectionStart - removeCount,
    selectionEnd: selectionEnd - removeCount,
  };
}

function leadingWhitespaceBeforeCaret(value: string, position: number): string {
  const lineStart = lineStartAt(value, position);
  const prefix = value.slice(lineStart, position);
  return prefix.match(/^[ \t]*/)?.[0] ?? "";
}

/** Split at the caret (or replace a selection) and carry leading whitespace to the new line. */
export function applyTextEditorSourceEnterEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): TextEditorSourceTabEdit {
  const indent = leadingWhitespaceBeforeCaret(value, selectionStart);
  const newValue = value.slice(0, selectionStart) + "\n" + indent + value.slice(selectionEnd);
  const caret = selectionStart + 1 + indent.length;
  return { value: newValue, selectionStart: caret, selectionEnd: caret };
}

/** Apply Tab / Shift+Tab indentation to a plain-text buffer and caret range. */
export function applyTextEditorSourceTabEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  tabSize: number,
  outdent = false,
): TextEditorSourceTabEdit {
  const multiLine = selectionSpansMultipleLines(value, selectionStart, selectionEnd);

  if (multiLine) {
    return outdent
      ? outdentMultipleLines(value, selectionStart, selectionEnd, tabSize)
      : indentMultipleLines(value, selectionStart, selectionEnd, tabSize);
  }

  if (outdent) {
    return outdentSingleLine(value, selectionStart, selectionEnd, tabSize);
  }

  return insertSpacesAtSelection(value, selectionStart, selectionEnd, tabSize);
}
