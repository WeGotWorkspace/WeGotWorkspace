<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Events\WorkspaceEvent;
use App\Events\WorkspaceEventListener;

final class RecordingWorkspaceEventListener implements WorkspaceEventListener
{
    /** @var list<WorkspaceEvent> */
    public array $events = [];

    public function handle(WorkspaceEvent $event): void
    {
        $this->events[] = $event;
    }

    /**
     * @return list<WorkspaceEvent>
     */
    public function matching(string $domain, string $action): array
    {
        return array_values(array_filter(
            $this->events,
            static fn (WorkspaceEvent $event): bool => $event->domain === $domain && $event->action === $action,
        ));
    }
}
