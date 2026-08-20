import { ChevronsUpDown } from "lucide-react";
import { SwatchColorPicker } from "@/ui/swatch-color-picker";
import "@/ui/input.css";
import { TaskListDot } from "@/tasks-core/src/tasks-list-dot";
import { TASK_LIST_DOT_COLORS } from "@/tasks-core/src/tasks-task-utils";
import "./task-project-color-picker.css";

type TaskProjectColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  colorLabel: string;
  previewListId: string;
};

export function TaskProjectColorPicker({
  value,
  onChange,
  colorLabel,
  previewListId,
}: TaskProjectColorPickerProps) {
  return (
    <SwatchColorPicker
      value={value}
      onChange={onChange}
      colorLabel={colorLabel}
      swatches={TASK_LIST_DOT_COLORS}
    >
      <button
        type="button"
        className="control-surface task-project-color-picker__trigger"
        aria-label={colorLabel}
        aria-haspopup="dialog"
      >
        <TaskListDot
          className="task-project-color-picker__dot"
          list={{ id: previewListId, color: value }}
        />
        <ChevronsUpDown className="task-project-color-picker__chevron" aria-hidden />
      </button>
    </SwatchColorPicker>
  );
}
