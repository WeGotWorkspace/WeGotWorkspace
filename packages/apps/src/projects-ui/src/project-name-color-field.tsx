import { TASK_LIST_DOT_COLORS } from "@/lib/models/task-lists";
import { projectsLabels as labels } from "@/projects-ui/src/projects-labels";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { NAME_COLOR_ROW_INPUT_CLASS, NameColorRow } from "@/ui/name-color-row";
import { NO_AUTOFILL } from "@/ui/no-autofill";
import { SwatchColorPicker } from "@/ui/swatch-color-picker";

/** The Project name and color row the create and edit dialogs share. */
export function ProjectNameColorField({
  id,
  name,
  color,
  onNameChange,
  onColorChange,
}: {
  id: string;
  name: string;
  color: string;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <FieldLabelRow layout="inline" fill label={labels.nameLabel} htmlFor={id}>
      <NameColorRow>
        <Input
          id={id}
          {...NO_AUTOFILL}
          className={NAME_COLOR_ROW_INPUT_CLASS}
          autoFocus
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <SwatchColorPicker
          value={color}
          onChange={onColorChange}
          colorLabel={labels.colorLabel}
          swatches={TASK_LIST_DOT_COLORS}
        >
          <ColorSwatchTrigger color={color} label={labels.colorLabel} aria-haspopup="dialog" />
        </SwatchColorPicker>
      </NameColorRow>
    </FieldLabelRow>
  );
}
