import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";

function DialogHeaderCloseHarness() {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <Button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New event</DialogTitle>
          </DialogHeader>
          <Input placeholder="Title" aria-label="Title" />
          <DialogFooter>
            <Button type="button" variant="primary" onClick={() => setOpen(false)}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const meta = {
  title: "Shared/Dialog",
  component: DialogHeaderCloseHarness,
} satisfies Meta<typeof DialogHeaderCloseHarness>;

export default meta;
type Story = StoryObj<typeof DialogHeaderCloseHarness>;

export const Default: Story = {};
