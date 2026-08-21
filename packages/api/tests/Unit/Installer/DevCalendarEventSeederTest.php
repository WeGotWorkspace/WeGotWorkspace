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
use RuntimeException;
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

    public function test_seed_refuses_outside_local_or_testing(): void
    {
        $this->app['env'] = 'production';

        try {
            $this->calendarSeeder()->seed('admin', DevCalendarEventCatalog::PROFILE_COMPACT, now: $this->now);
            $this->fail('Expected seed to refuse production.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('outside local/testing', $e->getMessage());
        }

        $this->assertSame(0, $this->seededObjectCount());
    }

    public function test_seed_refuses_docker_install_channel(): void
    {
        $this->app['env'] = 'local';
        config(['wgw.install_channel' => 'docker']);

        try {
            $this->calendarSeeder()->seed('admin', DevCalendarEventCatalog::PROFILE_COMPACT, now: $this->now);
            $this->fail('Expected seed to refuse the Docker install channel.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('docker install channel', $e->getMessage());
        }

        $this->assertSame(0, $this->seededObjectCount());
    }

    public function test_seed_refuses_zip_install_channel(): void
    {
        $this->app['env'] = 'local';
        config(['wgw.install_channel' => 'zip']);

        try {
            $this->calendarSeeder()->seed('admin', DevCalendarEventCatalog::PROFILE_COMPACT, now: $this->now);
            $this->fail('Expected seed to refuse the ZIP install channel.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('zip install channel', $e->getMessage());
        }

        $this->assertSame(0, $this->seededObjectCount());
    }

    public function test_seed_refuses_zip_extract_without_monorepo_workspace(): void
    {
        $isolated = sys_get_temp_dir().'/wgw-zip-seed-'.uniqid('', true);
        mkdir($isolated.'/packages/api', 0775, true);
        $this->app['env'] = 'local';
        $this->app->setBasePath($isolated.'/packages/api');

        try {
            $this->calendarSeeder()->seed('admin', DevCalendarEventCatalog::PROFILE_COMPACT, now: $this->now);
            $this->fail('Expected seed to refuse a ZIP extract layout.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('monorepo checkout', $e->getMessage());
        } finally {
            @rmdir($isolated.'/packages/api');
            @rmdir($isolated.'/packages');
            @rmdir($isolated);
        }

        $this->assertSame(0, $this->seededObjectCount());
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
