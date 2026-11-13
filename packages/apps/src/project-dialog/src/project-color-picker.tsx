import { SwatchColorPicker } from "@/ui/swatch-color-picker";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import { TASK_LIST_DOT_COLORS } from "@/lib/models/task-lists";

type ProjectColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  colorLabel: string;
};

export function ProjectColorPicker({ value, onChange, colorLabel }: ProjectColorPickerProps) {
  return (
    <SwatchColorPicker
      value={value}
      onChange={onChange}
      colorLabel={colorLabel}
      swatches={TASK_LIST_DOT_COLORS}
    >
      <ColorSwatchTrigger color={value} label={colorLabel} aria-haspopup="dialog" />
    </SwatchColorPicker>
  );
}
