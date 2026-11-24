<?php

declare(strict_types=1);

namespace Tests\Feature\Projects\Cycle;

use App\Services\Jmap\JmapCapabilities;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #819: the membership cycle of one Team and one Project, seen through Calendar.
 */
final class CalendarCycleTest extends WgwDatabaseTestCase
{
    use WalksTheMembershipCycle;

    public function test_the_membership_cycle_in_calendar(): void
    {
        $this->walkTheCycle();
    }

    protected function seesProjectContent(string $user): ?bool
    {
        $list = $this->jmapCall($user, JmapCapabilities::CALENDARS, [['Calendar/get', ['accountId' => $user], 'g']])['list'] ?? [];

        return in_array($this->resource('calendarId'), array_map('strval', array_column($list, 'id')), true);
    }
}
