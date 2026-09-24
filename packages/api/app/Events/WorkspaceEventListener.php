<?php

declare(strict_types=1);

namespace App\Events;

interface WorkspaceEventListener
{
    public function handle(WorkspaceEvent $event): void;
}
