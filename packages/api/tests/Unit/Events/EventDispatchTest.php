<?php

declare(strict_types=1);

namespace Tests\Unit\Events;

use App\Events\EventDispatch;
use App\Events\WorkspaceEvent;
use App\Events\WorkspaceEventListener;
use PHPUnit\Framework\TestCase;

final class EventDispatchTest extends TestCase
{
    public function test_throwing_listener_does_not_fail_the_write(): void
    {
        $second = new class implements WorkspaceEventListener
        {
            public bool $called = false;

            public function handle(WorkspaceEvent $event): void
            {
                $this->called = true;
            }
        };

        $dispatch = new EventDispatch([
            new class implements WorkspaceEventListener
            {
                public function handle(WorkspaceEvent $event): void
                {
                    throw new \RuntimeException('boom');
                }
            },
            $second,
        ]);

        $dispatch->fire(WorkspaceEvent::make(
            actor: 'bob',
            domain: 'calendars',
            action: 'created',
            target: 'calendars/bob/default/event.ics',
        ));

        $this->assertTrue($second->called);
    }

    public function test_empty_actor_skips_mutation_fire(): void
    {
        $listener = new class implements WorkspaceEventListener
        {
            public int $calls = 0;

            public function handle(WorkspaceEvent $event): void
            {
                $this->calls++;
            }
        };
        $dispatch = new EventDispatch([$listener]);
        $dispatch->fireMutation('', 'calendars', 'written', 'calendars/bob/default/x.ics');

        $this->assertSame(0, $listener->calls);
    }
}
