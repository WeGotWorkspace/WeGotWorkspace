<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Services\Calendars\Availability\AvailabilityCalculator;
use App\Services\Calendars\Availability\AvailabilityResult;
use App\Services\Calendars\Availability\AvailabilitySettings;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;

/**
 * Team availability fixtures: bob and carol in Team `eng` with its event
 * calendar provisioned, a per-test `availability` cache directory, and an ICS
 * builder. Weeks are fixed Mondays in 2030 so tests never depend on today.
 */
trait AvailabilityTestFixtures
{
    use CalendarsTestFixtures;

    protected string $availabilityCacheDir = '';

    protected function setUpAvailabilityFixtures(): void
    {
        $this->setUpCalendarsFixtures();
        $this->availabilityCacheDir = sys_get_temp_dir().'/wgw-availability-'.uniqid('', true);
        config(['cache.stores.availability.path' => $this->availabilityCacheDir]);
        Cache::purge('availability');

        $team = $this->seedWgwGroup('principals/groups/eng', 'Engineering');
        foreach (['bob', 'carol'] as $member) {
            $principal = Principal::forUsername($member);
            $this->assertNotNull($principal);
            $this->addPrincipalToGroup($team, $principal);
        }
        app(UserCalendarCollectionsProvisioner::class)->ensureForGroupPrincipal('principals/groups/eng', 'Engineering');
        app(AvailabilitySettings::class)->setEnabled('bob', true);
    }

    protected function tearDownAvailabilityFixtures(): void
    {
        File::deleteDirectory($this->availabilityCacheDir);
    }

    /** Monday 00:00 UTC, $offset weeks after 2030-01-07. */
    protected static function week(int $offset = 0): int
    {
        return gmmktime(0, 0, 0, 1, 7 + 7 * $offset, 2030);
    }

    /**
     * @param  list<int>|null  $weeks
     */
    protected function busy(string $owner = 'bob', ?array $weeks = null, ?string $excludeUid = null): AvailabilityResult
    {
        $result = app(AvailabilityCalculator::class)->busyPeriods($owner, $weeks ?? [self::week()], $excludeUid);
        $this->assertNotNull($result);

        return $result;
    }

    /**
     * @param  list<string>  $lines  extra VEVENT lines
     * @param  list<string>  $overrides  extra VEVENT blocks (lines without BEGIN/END)
     */
    protected function eventIcs(string $uid, string $start, string $end, array $lines = [], array $overrides = []): string
    {
        $vevent = static function (array $body): string {
            return "BEGIN:VEVENT\r\n".implode("\r\n", $body)."\r\nEND:VEVENT\r\n";
        };
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//wgw//availability test//EN\r\n";
        $ics .= $vevent(array_merge(["UID:{$uid}", 'DTSTAMP:20300101T000000Z', "DTSTART{$start}", "DTEND{$end}"], $lines));
        foreach ($overrides as $override) {
            $ics .= $vevent(array_merge(["UID:{$uid}", 'DTSTAMP:20300101T000000Z'], $override));
        }

        return $ics."END:VCALENDAR\r\n";
    }

    /**
     * @return list<string>
     */
    protected static function starts(AvailabilityResult $result): array
    {
        return array_map(static fn (array $period): string => $period['start'], $result->periods());
    }
}
