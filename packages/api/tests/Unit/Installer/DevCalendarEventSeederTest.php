<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Installer\DevCalendarEventCatalog;
use App\Services\Installer\DevCalendarEventSeeder;
use DateTimeImmutable;
use DateTimeZone;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class DevCalendarEventSeederTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    private DateTimeImmutable $now;

    protected function setUp(): void
    {
        parent::setUp();
        $this->now = new DateTimeImmutable('2026-08-17 12:00:00', new DateTimeZone('UTC'));
        $this->seedWgwUser('admin', displayName: 'Admin');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/admin');
    }

    public function test_full_catalog_has_hundreds_of_events_across_calendars(): void
    {
        $events = app(DevCalendarEventCatalog::class)->events(DevCalendarEventCatalog::PROFILE_FULL, $this->now);

        $this->assertGreaterThanOrEqual(DevCalendarEventCatalog::FULL_TARGET, count($events));
        $uris = array_column($events, 'calendarUri');
        $this->assertContains(CalendarCollectionUris::EVENT_DEFAULT, $uris);
        $this->assertContains(CalendarCollectionUris::EVENT_HOME, $uris);
        $this->assertContains(CalendarCollectionUris::EVENT_WORK, $uris);
        $this->assertCount(count($events), array_unique(array_column($events, 'objectUri')));
    }

    public function test_compact_seed_writes_recurrence_exceptions_and_alarms(): void
    {
        $result = $this->calendarSeeder()->seed(
            'admin',
            DevCalendarEventCatalog::PROFILE_COMPACT,
            now: $this->now,
        );

        $this->assertGreaterThanOrEqual(15, $result['created']);
        $this->assertSame(0, $result['skipped']);
        $this->assertSame(0, $result['deleted']);

        $blob = $this->seededIcs();
        $this->assertStringContainsString('RRULE:FREQ=WEEKLY', $blob);
        $this->assertStringContainsString('EXDATE:', $blob);
        $this->assertStringContainsString('RECURRENCE-ID:', $blob);
        $this->assertStringContainsString('STATUS:CANCELLED', $blob);
        $this->assertStringContainsString('BEGIN:VALARM', $blob);
        $this->assertStringContainsString('TRIGGER:-PT15M', $blob);
        $this->assertStringContainsString('SUMMARY:Daily standup (late)', $blob);

        $byCalendar = $this->seededCountByCalendar();
        $this->assertGreaterThan(0, $byCalendar[CalendarCollectionUris::EVENT_DEFAULT] ?? 0);
        $this->assertGreaterThan(0, $byCalendar[CalendarCollectionUris::EVENT_HOME] ?? 0);
        $this->assertGreaterThan(0, $byCalendar[CalendarCollectionUris::EVENT_WORK] ?? 0);
    }

    public function test_seed_is_idempotent_and_force_recreates(): void
    {
        $first = $this->calendarSeeder()->seed('admin', DevCalendarEventCatalog::PROFILE_COMPACT, now: $this->now);
        $second = $this->calendarSeeder()->seed('admin', DevCalendarEventCatalog::PROFILE_COMPACT, now: $this->now);

        $this->assertSame(0, $second['created']);
        $this->assertSame($first['created'], $second['skipped']);
        $this->assertSame($first['created'], $this->seededObjectCount());

        $forced = $this->calendarSeeder()->seed(
            'admin',
            DevCalendarEventCatalog::PROFILE_COMPACT,
            force: true,
            now: $this->now,
        );

        $this->assertSame($first['created'], $forced['deleted']);
        $this->assertSame($first['created'], $forced['created']);
        $this->assertSame(0, $forced['skipped']);
        $this->assertSame($first['created'], $this->seededObjectCount());
    }

    private function calendarSeeder(): DevCalendarEventSeeder
    {
        return app(DevCalendarEventSeeder::class);
    }

    private function seededObjectCount(): int
    {
        return CalendarObject::query()
            ->where('uri', 'like', DevCalendarEventCatalog::URI_PREFIX.'%')
            ->count();
    }

    private function seededIcs(): string
    {
        return CalendarObject::query()
            ->where('uri', 'like', DevCalendarEventCatalog::URI_PREFIX.'%')
            ->get()
            ->map(static fn (CalendarObject $object): string => (string) $object->calendardata)
            ->implode("\n");
    }

    /**
     * @return array<string, int>
     */
    private function seededCountByCalendar(): array
    {
        $counts = [];
        $instances = CalendarInstance::query()
            ->where('principaluri', 'principals/admin')
            ->whereIn('uri', DevCalendarEventCatalog::EVENT_CALENDAR_URIS)
            ->get();

        foreach ($instances as $instance) {
            $counts[(string) $instance->uri] = CalendarObject::query()
                ->where('calendarid', $instance->calendarid)
                ->where('uri', 'like', DevCalendarEventCatalog::URI_PREFIX.'%')
                ->count();
        }

        return $counts;
    }
}
