<?php

declare(strict_types=1);

namespace App\Events;

use Illuminate\Support\Facades\Log;

/**
 * In-process, exception-isolated dispatch. Listener failures never fail the write.
 */
final class EventDispatch
{
    /**
     * @param  list<WorkspaceEventListener>  $listeners
     */
    public function __construct(private array $listeners = []) {}

    public function fire(WorkspaceEvent $event): void
    {
        foreach ($this->listeners as $listener) {
            try {
                $listener->handle($event);
            } catch (\Throwable $e) {
                $this->logFailure($event, $listener, $e);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function fireMutation(
        string $actor,
        string $domain,
        string $action,
        string $target,
        array $data = [],
        string $visibility = WorkspaceEvent::VISIBILITY_INTERNAL,
        ?string $eventId = null,
    ): void {
        if ($actor === '') {
            return;
        }

        $this->fire(WorkspaceEvent::make(
            actor: $actor,
            domain: $domain,
            action: $action,
            target: $target,
            data: $data,
            visibility: $visibility,
            eventId: $eventId,
        ));
    }

    public function listen(WorkspaceEventListener $listener): void
    {
        $this->listeners[] = $listener;
    }

    private function logFailure(WorkspaceEvent $event, WorkspaceEventListener $listener, \Throwable $e): void
    {
        try {
            Log::warning('event_dispatch_failed', [
                'event_id' => $event->eventId,
                'domain' => $event->domain,
                'action' => $event->action,
                'target' => $event->target,
                'listener' => $listener::class,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);
        } catch (\Throwable) {
            // Logging is optional outside the Laravel container (e.g. unit tests).
        }
    }
}
