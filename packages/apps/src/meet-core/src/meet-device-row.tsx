import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";

type MeetDeviceRowProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: MeetDeviceOption[];
  menuClassName?: string;
};

export function MeetDeviceRow({
  icon,
  label,
  value,
  onChange,
  options,
  menuClassName = "meet-popover-surface",
}: MeetDeviceRowProps) {
  return (
    <FieldLabelRow label={label} icon={icon} className="meet-device-row mb-0">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="meet-device-row__trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={menuClassName}>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldLabelRow>
  );
}
