import { Trash2 } from "lucide-react";
import { useState, type ClipboardEvent } from "react";
import { IconButton } from "@/button/src/icon-button";
import { splitIceUrlRows } from "@/admin-core/src/admin-settings-form-utils";
import { MAX_ICE_URLS_PER_KIND } from "@/lib/rtc/config";
import { Input } from "@/ui/input";

export type AdminIceUrlListProps = {
  /** Field ids are `${id}-1`, `${id}-2`, … so a label can point at the first. */
  id: string;
  label: string;
  /** Accessible name of one field, numbered: "STUN URL 1". */
  itemLabel: string;
  /** Stored as one comma-separated string, so the settings contract is unchanged. */
  value: string;
  onChange: (value: string) => void;
  max?: number;
};

/**
 * One field per ICE url, up to `max`. A comma would hide a second url in one
 * field and bypass the cap, so typed and pasted commas are refused.
 */
export function AdminIceUrlList({
  id,
  label,
  itemLabel,
  value,
  onChange,
  max = MAX_ICE_URLS_PER_KIND,
}: AdminIceUrlListProps) {
  const [commaRefused, setCommaRefused] = useState(false);
  const rows = splitIceUrlRows(value);
  const lastFilled = rows.length === 0 || rows[rows.length - 1] !== "";
  const fields = rows.length < max && lastFilled ? [...rows, ""] : rows;

  const setRow = (index: number, next: string) => {
    if (next.includes(",")) {
      setCommaRefused(true);
      return;
    }
    const updated = [...rows];
    updated[index] = next;
    onChange(updated.join(","));
  };

  const refuseCommaPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!event.clipboardData.getData("text").includes(",")) return;
    event.preventDefault();
    setCommaRefused(true);
  };

  return (
    <div className="admin-ice-url-list" role="group" aria-label={label}>
      {fields.map((url, index) => {
        const name = `${itemLabel} ${index + 1}`;
        const stored = index < rows.length;
        return (
          <div className="admin-ice-url-list__row" key={index}>
            <Input
              id={`${id}-${index + 1}`}
              className="admin-ice-url-list__input"
              aria-label={name}
              value={url}
              onChange={(event) => setRow(index, event.target.value)}
              onPaste={refuseCommaPaste}
              onBlur={() => setCommaRefused(false)}
            />
            {stored ? (
              <IconButton
                label={`Remove ${name}`}
                icon={<Trash2 className="size-3.5" aria-hidden />}
                variant="outline"
                onClick={() => onChange(rows.filter((_, row) => row !== index).join(","))}
              />
            ) : null}
          </div>
        );
      })}
      {commaRefused ? (
        <p className="admin-ice-url-list__hint" role="status">
          Enter one URL per field.
        </p>
      ) : null}
      {rows.length > max ? (
        <p className="admin-ice-url-list__warning">
          Only the first {max} are used. Remove the extra URLs.
        </p>
      ) : null}
    </div>
  );
}
