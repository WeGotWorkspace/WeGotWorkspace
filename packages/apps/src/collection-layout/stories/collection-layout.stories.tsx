import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CollectionListEnd } from "@/collection-layout/src/collection-list-end";
import { CollectionHeader, CollectionListPane } from "@/collection-layout/src/collection-layout";
import { CollectionSearchInput } from "@/collection-search-input/src/collection-search-input";

const meta: Meta = {
  title: "Shared/Collection Layout",
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <div className="flex h-dvh w-full">
      <CollectionListPane>
        <CollectionHeader>
          <h2
            className="text-3xl leading-none flex-1 min-w-0 truncate"
            style={{ fontFamily: "var(--font-serif)", color: "var(--color-ink)" }}
          >
            All Items
          </h2>
          <p
            className="text-[10px] mt-2 uppercase tracking-[0.18em]"
            style={{ color: "color-mix(in oklab, var(--color-ink) 45%, transparent)" }}
          >
            12 Items
          </p>
          <CollectionSearchInput value="" onChange={() => {}} placeholder="Search..." />
        </CollectionHeader>
        <div className="p-4 space-y-2">
          <div className="rounded-md p-3 bg-black/5">List row one</div>
          <div className="rounded-md p-3 bg-black/5">List row two</div>
          <div className="rounded-md p-3 bg-black/5">List row three</div>
        </div>
      </CollectionListPane>
      <main className="flex-1 p-6">Detail area</main>
    </div>
  ),
};

/** Invisible Mail-style list-end sentinel (observed by useCollectionListEndReached). */
export const ListEnd: Story = {
  render: function ListEndStory() {
    const listEndRef = useRef<HTMLDivElement | null>(null);
    return (
      <div className="p-4">
        <p className="text-sm">Last row</p>
        <CollectionListEnd listEndRef={listEndRef} />
      </div>
    );
  },
};
