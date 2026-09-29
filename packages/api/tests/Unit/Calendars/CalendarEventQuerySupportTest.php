<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarEventRepository;
use ReflectionMethod;
use Tests\TestCase;

final class CalendarEventQuerySupportTest extends TestCase
{
    public function test_compose_calendar_state_is_stable(): void
    {
        $a = CalendarEventRepository::composeCalendarState(['cal-a' => '1', 'cal-b' => '2']);
        $b = CalendarEventRepository::composeCalendarState(['cal-b' => '2', 'cal-a' => '1']);
        $this->assertSame($a, $b);
        $this->assertNotSame('', $a);
    }

    public function test_flatten_ids(): void
    {
        $repo = $this->app->make(CalendarEventRepository::class);
        $method = new ReflectionMethod(CalendarEventRepository::class, 'flattenIds');
        $method->setAccessible(true);

        $flat = $method->invoke($repo, [
            'a.ics' => ['evt-1', 'evt-2'],
            'b.ics' => ['evt-3'],
        ]);
        $this->assertSame(['evt-1', 'evt-2', 'evt-3'], $flat);
    }
}
