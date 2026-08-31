import { useEffect, useState } from "react";
import { Plus, Tag as TagIcon, Check } from "lucide-react";
import { Button } from "@/button/src/button";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { RadioGroup, RadioGroupItem } from "@/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";

export function AddDialog({
  kind,
  existing,
  onClose,
  onConfirm,
  contentClassName,
}: {
  kind: null | "notebook" | "tag";
  existing: string[];
  onClose: () => void;
  onConfirm: (name: string) => void;
  contentClassName?: string;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (kind) setValue("");
  }, [kind]);
  const v = value.trim();
  const dup = !!v && existing.includes(v);
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>New {kind === "notebook" ? "notebook" : "tag"}</DialogTitle>
          <DialogDescription>
            {kind === "notebook"
              ? "Create a notebook to organize your writing."
              : "Create a tag you can attach to your notes."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (v && !dup) onConfirm(v);
          }}
        >
          <Input
            autoFocus
            placeholder={kind === "notebook" ? "Notebook name" : "tag-name"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {dup && (
            <p className="text-xs text-destructive mt-2">A {kind} with that name already exists.</p>
          )}
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!v || dup}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditDialog({
  item,
  onClose,
  onConfirm,
  contentClassName,
  title: titleProp,
}: {
  item: null | { kind: "notebook" | "tag" | "group" | "project"; name: string };
  onClose: () => void;
  onConfirm: (newName: string) => void;
  contentClassName?: string;
  title?: string;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (item) setValue(item.name);
  }, [item]);
  const v = value.trim();
  const kindLabel =
    item?.kind === "group" ? "group" : item?.kind === "project" ? "project" : item?.kind;
  const description =
    item?.kind === "group"
      ? "The group name will update in your address books and sidebar."
      : item?.kind === "project"
        ? "The project name will update in your sidebar and task lists."
        : `All items currently in this ${item?.kind} will keep their assignment.`;
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{titleProp ?? `Rename ${kindLabel}`}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (v) onConfirm(v);
          }}
        >
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!v}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDialog({
  item,
  notebooks,
  affectedCount,
  onClose,
  onConfirm,
  contentClassName,
}: {
  item: null | { kind: "notebook" | "tag"; name: string };
  notebooks: string[];
  affectedCount: number;
  onClose: () => void;
  onConfirm: (opts: { transferTo?: string; archive?: boolean }) => void;
  contentClassName?: string;
}) {
  const [mode, setMode] = useState<"transfer" | "archive">("transfer");
  const others = notebooks.filter((n) => n !== item?.name);
  const [target, setTarget] = useState<string>("");
  useEffect(() => {
    if (item?.kind === "notebook") {
      setMode(others.length > 0 ? "transfer" : "archive");
      setTarget(others[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const isNb = item?.kind === "notebook";
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>
            Delete {item?.kind} “{item?.name}”?
          </DialogTitle>
          <DialogDescription>
            {isNb
              ? `${affectedCount} item${affectedCount === 1 ? "" : "s"} are in this notebook. Choose what to do with them.`
              : `This tag will be removed from ${affectedCount} item${affectedCount === 1 ? "" : "s"}. The items themselves will not be deleted.`}
          </DialogDescription>
        </DialogHeader>

        {isNb && affectedCount > 0 && (
          <div className="py-2 space-y-3">
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "transfer" | "archive")}>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem
                  id="mode-transfer"
                  value="transfer"
                  disabled={others.length === 0}
                  className="mt-1"
                />
                <div className="flex-1">
                  <Label htmlFor="mode-transfer" className="text-sm font-medium">
                    Move items to another notebook
                  </Label>
                  <div className="mt-2">
                    <select
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      disabled={mode !== "transfer" || others.length === 0}
                      className="input w-full disabled:opacity-50"
                    >
                      {others.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                      {others.length === 0 && <option value="">No other notebooks</option>}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem id="mode-archive" value="archive" className="mt-1" />
                <Label htmlFor="mode-archive" className="text-sm font-medium">
                  Archive all items
                </Label>
              </div>
            </RadioGroup>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (!isNb) return onConfirm({});
              if (affectedCount === 0) return onConfirm({});
              if (mode === "transfer" && target) onConfirm({ transferTo: target });
              else onConfirm({ archive: true });
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TagPickerDialog({
  open,
  allTags,
  selected,
  onClose,
  onToggle,
  onCreate,
  contentClassName,
}: {
  open: boolean;
  allTags: string[];
  selected: string[];
  onClose: () => void;
  onToggle: (t: string) => void;
  onCreate: (t: string) => void;
  contentClassName?: string;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const q = query.trim();
  const filtered = allTags.filter((t) => t.toLowerCase().includes(q.toLowerCase()));
  const canCreate = !!q && !allTags.includes(q);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>Tags</DialogTitle>
          <DialogDescription>Add or remove tags for this note.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Search or create tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="max-h-64 overflow-y-auto -mx-1 px-1 py-1 space-y-0.5">
          {filtered.map((t) => {
            const on = selected.includes(t);
            return (
              <button
                key={t}
                onClick={() => onToggle(t)}
                className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted text-left"
              >
                <TagIcon className="size-3.5 text-muted-foreground" />
                <span className="flex-1">{t}</span>
                {on && <Check className="size-4 text-[color:var(--color-emerald)]" />}
              </button>
            );
          })}
          {filtered.length === 0 && !canCreate && (
            <p className="text-xs text-muted-foreground px-3 py-4 text-center">No tags found.</p>
          )}
          {canCreate && (
            <button
              onClick={() => onCreate(q)}
              className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted text-left"
            >
              <Plus className="size-3.5 text-muted-foreground" />
              <span>Create “{q}”</span>
            </button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
