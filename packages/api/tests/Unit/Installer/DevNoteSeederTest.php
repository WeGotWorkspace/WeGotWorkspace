<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\NoteStar;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Installer\DevNoteCatalog;
use App\Services\Installer\DevNoteSeeder;
use DateTimeImmutable;
use DateTimeZone;
use RuntimeException;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class DevNoteSeederTest extends WgwDatabaseTestCase
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

    public function test_full_catalog_has_about_one_thousand_notes_across_notebooks(): void
    {
        $notes = app(DevNoteCatalog::class)->notes(DevNoteCatalog::PROFILE_FULL, $this->now);

        $this->assertSame(DevNoteCatalog::FULL_TARGET, count($notes));
        $uris = array_column($notes, 'notebookUri');
        $this->assertContains(CalendarCollectionUris::NOTE_GENERAL, $uris);
        $this->assertContains(DevNoteCatalog::NOTEBOOK_WORK, $uris);
        $this->assertContains(DevNoteCatalog::NOTEBOOK_IDEAS, $uris);
        $this->assertCount(count($notes), array_unique(array_column($notes, 'objectUri')));
        $this->assertTrue(collect($notes)->contains(fn (array $note): bool => ($note['note']['status'] ?? null) === 'CANCELLED'));
        $this->assertTrue(collect($notes)->contains(fn (array $note): bool => $note['starred'] === true));
    }

    public function test_compact_seed_writes_tags_archive_and_extra_notebooks(): void
    {
        $result = $this->noteSeeder()->seed(
            'admin',
            DevNoteCatalog::PROFILE_COMPACT,
            now: $this->now,
        );

        $this->assertGreaterThanOrEqual(DevNoteCatalog::COMPACT_TARGET, $result['created']);
        $this->assertSame(0, $result['skipped']);
        $this->assertSame(0, $result['deleted']);
        $this->assertSame(2, $result['notebooks']);
        $this->assertGreaterThan(0, $result['starred']);

        $blob = $this->seededIcs();
        $this->assertStringContainsString('BEGIN:VJOURNAL', $blob);
        $this->assertStringContainsString('SUMMARY:Welcome to Notes', $blob);
        $this->assertStringContainsString('CATEGORIES', $blob);
        $this->assertStringContainsString('STATUS:CANCELLED', $blob);

        $byNotebook = $this->seededCountByNotebook();
        $this->assertGreaterThan(0, $byNotebook[CalendarCollectionUris::NOTE_GENERAL] ?? 0);
        $this->assertGreaterThan(0, $byNotebook[DevNoteCatalog::NOTEBOOK_WORK] ?? 0);
        $this->assertGreaterThan(0, $byNotebook[DevNoteCatalog::NOTEBOOK_IDEAS] ?? 0);
        $this->assertGreaterThan(0, NoteStar::query()->where('username', 'admin')->count());
    }

    public function test_seed_is_idempotent_and_force_recreates(): void
    {
        $first = $this->noteSeeder()->seed('admin', DevNoteCatalog::PROFILE_COMPACT, now: $this->now);
        $second = $this->noteSeeder()->seed('admin', DevNoteCatalog::PROFILE_COMPACT, now: $this->now);

        $this->assertSame(0, $second['created']);
        $this->assertSame($first['created'], $second['skipped']);
        $this->assertSame($first['created'], $this->seededObjectCount());

        $forced = $this->noteSeeder()->seed(
            'admin',
            DevNoteCatalog::PROFILE_COMPACT,
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
            $this->noteSeeder()->seed('admin', DevNoteCatalog::PROFILE_COMPACT, now: $this->now);
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
            $this->noteSeeder()->seed('admin', DevNoteCatalog::PROFILE_COMPACT, now: $this->now);
            $this->fail('Expected seed to refuse the Docker install channel.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('docker install channel', $e->getMessage());
        }

        $this->assertSame(0, $this->seededObjectCount());
    }

    private function noteSeeder(): DevNoteSeeder
    {
        return app(DevNoteSeeder::class);
    }

    private function seededObjectCount(): int
    {
        return CalendarObject::query()
            ->where('uri', 'like', DevNoteCatalog::URI_PREFIX.'%')
            ->count();
    }

    private function seededIcs(): string
    {
        return CalendarObject::query()
            ->where('uri', 'like', DevNoteCatalog::URI_PREFIX.'%')
            ->get()
            ->map(static fn (CalendarObject $object): string => (string) $object->calendardata)
            ->implode("\n");
    }

    /**
     * @return array<string, int>
     */
    private function seededCountByNotebook(): array
    {
        $counts = [];
        $instances = CalendarInstance::query()
            ->where('principaluri', 'principals/admin')
            ->whereIn('uri', DevNoteCatalog::NOTEBOOK_URIS)
            ->get();

        foreach ($instances as $instance) {
            $counts[(string) $instance->uri] = CalendarObject::query()
                ->where('calendarid', $instance->calendarid)
                ->where('uri', 'like', DevNoteCatalog::URI_PREFIX.'%')
                ->count();
        }

        return $counts;
    }
}
