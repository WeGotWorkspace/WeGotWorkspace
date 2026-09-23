import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@/ui/button";
import { SideDrawer } from "@/ui/side-drawer";

import "@/ui/side-drawer.css";

function SideDrawerDemo({ side = "right" as const }: { side?: "left" | "right" }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="p-6">
      <Button type="button" onClick={() => setOpen(true)}>
        Open drawer
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} title="Example drawer" side={side}>
        <div className="flex h-full flex-col gap-4 p-4">
          <p className="text-sm">Reusable side drawer built on the shared Sheet primitive.</p>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </SideDrawer>
    </div>
  );
}

const meta: Meta<typeof SideDrawerDemo> = {
  title: "UI/Primitives/Side Drawer",
  component: SideDrawerDemo,
};

export default meta;
type Story = StoryObj<typeof SideDrawerDemo>;

export const Right: Story = {};

export const Left: Story = {
  render: () => <SideDrawerDemo side="left" />,
};
