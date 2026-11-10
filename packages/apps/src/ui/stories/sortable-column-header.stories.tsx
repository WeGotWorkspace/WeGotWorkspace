import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { listSortAria, nextListSort, type ListSort } from "@/lib/list-sort";
import { SortableColumnHeader } from "@/ui/sortable-column-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";

type Key = "name" | "modified" | "size";

const FIRST_DIRECTION = { name: "asc", modified: "desc", size: "desc" } as const;

const ROWS = [
  { name: "Roadmap 2026", modified: 3, size: 4_200 },
  { name: "budget", modified: 1, size: 120_000 },
  { name: "Notes 10", modified: 2, size: 900 },
];

/** A list header row with three sortable columns, sorting real rows. */
function SortableTableDemo({ initial }: { initial: ListSort<Key> }) {
  const [sort, setSort] = useState<ListSort<Key>>(initial);
  const onSort = (key: Key) =>
    setSort((current) => nextListSort(current, key, FIRST_DIRECTION[key]));
  const rows = [...ROWS].sort((a, b) => {
    const result =
      sort.key === "name"
        ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        : a[sort.key] - b[sort.key];
    return sort.direction === "asc" ? result : -result;
  });
  return (
    <div className="workspace-app-layout__main max-w-xl p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead aria-sort={listSortAria(sort, "name")}>
              <SortableColumnHeader label="Name" sortKey="name" sort={sort} onSort={onSort} />
            </TableHead>
            <TableHead aria-sort={listSortAria(sort, "modified")}>
              <SortableColumnHeader
                label="Modified"
                sortKey="modified"
                sort={sort}
                onSort={onSort}
                firstDirection="desc"
              />
            </TableHead>
            <TableHead className="text-right" aria-sort={listSortAria(sort, "size")}>
              <SortableColumnHeader
                label="Size"
                sortKey="size"
                sort={sort}
                onSort={onSort}
                firstDirection="desc"
                align="end"
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{`Day ${row.modified}`}</TableCell>
              <TableCell className="text-right">{`${row.size} B`}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const meta: Meta<typeof SortableTableDemo> = {
  title: "UI/Primitives/Sortable Column Header",
  component: SortableTableDemo,
  tags: ["vitest-ci"],
  parameters: {
    docs: {
      description: {
        component:
          "List column header that sorts its list (suite list norm). A first click sorts in the column's natural direction (text A→Z, dates and sizes newest or largest first); a second click flips it. The sorted column shows an arrow and its `th` carries `aria-sort`. Used by the Drive, Docs and file picker lists.",
      },
    },
  },
  args: { initial: { key: "name", direction: "asc" } },
};

export default meta;
type Story = StoryObj<typeof SortableTableDemo>;

const firstColumnTexts = (canvasElement: HTMLElement) =>
  Array.from(canvasElement.querySelectorAll("tbody tr td:first-child")).map(
    (cell) => cell.textContent,
  );

/** Sorted by name, A→Z: natural order, case-insensitive ("Notes 10" after "budget"). */
export const ByName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expect(firstColumnTexts(canvasElement)).toEqual(["budget", "Notes 10", "Roadmap 2026"]);
  },
};

/** A first click on another column uses its own first direction; a second click flips it. */
export const ClickToSort: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const size = canvas.getByRole("button", { name: "Size" });

    await userEvent.click(size);
    await expect(canvas.getByRole("columnheader", { name: /Size/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await expect(canvas.getByRole("columnheader", { name: /Name/ })).not.toHaveAttribute(
      "aria-sort",
    );
    await expect(firstColumnTexts(canvasElement)).toEqual(["budget", "Roadmap 2026", "Notes 10"]);

    await userEvent.click(size);
    await expect(canvas.getByRole("columnheader", { name: /Size/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expect(firstColumnTexts(canvasElement)).toEqual(["Notes 10", "Roadmap 2026", "budget"]);
  },
};

/** Newest first: the date column starts descending. */
export const ByModifiedNewestFirst: Story = {
  args: { initial: { key: "modified", direction: "desc" } },
};
