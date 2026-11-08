<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\Principal;
use App\Services\Calendars\Availability\AvailabilityCalculator;
use App\Services\Calendars\Availability\AvailabilitySettings;
use App\Services\Calendars\CalendarRepository;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Tests\Support\AvailabilityTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1908: the per-week cache. Removing an object row directly (no synctoken
 * bump) leaves the fingerprint unchanged, so a result that still shows the
 * removed event proves the week came from the cache.
 */
final class AvailabilityCacheTest extends WgwDatabaseTestCase
{
    use AvailabilityTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAvailabilityFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownAvailabilityFixtures();
        parent::tearDown();
    }

    public function test_calls_with_different_exclusions_share_one_entry_without_raw_uids(): void
    {
        $this->seedEventViaPdo('bob', 'a.ics', $this->eventIcs('raw-uid-alpha', ':20300107T100000Z', ':20300107T110000Z'));
        $this->seedEventViaPdo('bob', 'b.ics', $this->eventIcs('raw-uid-beta', ':20300107T120000Z', ':20300107T130000Z'));

        $this->assertCount(2, $this->busy()->periods());
        $this->assertCount(1, $this->cacheFiles());
        $this->silentlyDropObjects();

        $this->assertSame(['2030-01-07T12:00:00Z'], self::starts($this->busy(excludeUid: 'raw-uid-alpha')));
        $this->assertSame(['2030-01-07T10:00:00Z'], self::starts($this->busy(excludeUid: 'raw-uid-beta')));
        $this->assertCount(1, $this->cacheFiles());
        foreach ($this->cacheFiles() as $file) {
            $this->assertStringNotContainsString('raw-uid', (string) File::get($file));
        }
    }

    public function test_a_one_week_call_and_a_multi_week_call_share_the_week(): void
    {
        $this->seedEventViaPdo('bob', 'a.ics', $this->eventIcs('a', ':20300107T100000Z', ':20300107T110000Z'));
        $this->busy();
        $this->silentlyDropObjects();

        $result = $this->busy(weeks: [self::week(), self::week(1)]);

        $this->assertSame(['2030-01-07T10:00:00Z'], self::starts($result));
        $this->assertCount(2, $this->cacheFiles());
    }

    public function test_a_period_across_monday_is_one_period_over_both_weeks(): void
    {
        $this->seedEventViaPdo('bob', 'late.ics', $this->eventIcs('late', ':20300113T230000Z', ':20300114T010000Z'));

        $this->assertSame(['2030-01-13T23:00:00Z'], self::starts($this->busy(weeks: [self::week(1)])));
        $this->assertSame(['2030-01-13T23:00:00Z'], self::starts($this->busy(weeks: [self::week(), self::week(1)])));
    }

    public function test_a_cache_hit_after_an_incomplete_run_stays_incomplete(): void
    {
        CalendarObject::query()->insert([
            'calendarid' => $this->calendarId('principals/bob', 'default'), 'uri' => 'broken.ics', 'componenttype' => 'VEVENT',
            'calendardata' => 'not ics', 'etag' => 'x', 'size' => 7, 'lastmodified' => 1,
        ]);
        $this->assertFalse($this->busy()->complete());
        $this->silentlyDropObjects();

        $this->assertFalse($this->busy()->complete());
    }

    public function test_a_changed_app_key_misses_the_cache(): void
    {
        $this->seedEventViaPdo('bob', 'a.ics', $this->eventIcs('a', ':20300107T100000Z', ':20300107T110000Z'));
        $this->busy();
        $this->silentlyDropObjects();

        config(['app.key' => 'base64:'.base64_encode(str_repeat('k', 32))]);

        $this->assertSame([], $this->busy()->periods());
    }

    public function test_a_write_through_plain_caldav_pdo_shows_on_the_next_call(): void
    {
        $this->assertSame([], $this->busy()->periods());
        $this->seedEventViaPdo('bob', 'a.ics', $this->eventIcs('a', ':20300107T100000Z', ':20300107T110000Z'));

        $this->assertCount(1, $this->busy()->periods());
    }

    public function test_a_write_between_the_two_fingerprint_reads_is_returned_but_not_cached(): void
    {
        $this->seedEventViaPdo('bob', 'a.ics', $this->eventIcs('a', ':20300107T100000Z', ':20300107T110000Z'));
        $written = false;
        CalendarObject::retrieved(function () use (&$written): void {
            if (! $written) {
                $written = true;
                $this->seedEventViaPdo('bob', 'b.ics', $this->eventIcs('b', ':20300107T120000Z', ':20300107T130000Z'));
            }
        });

        $this->assertSame(['2030-01-07T10:00:00Z'], self::starts($this->busy()));
        $this->assertSame([], $this->cacheFiles());
        $this->assertSame(['2030-01-07T10:00:00Z', '2030-01-07T12:00:00Z'], self::starts($this->busy()));
    }

    public function test_a_busy_period_read_never_provisions_team_collections(): void
    {
        $ops = $this->seedWgwGroup('principals/groups/ops', 'Operations');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($ops, $bob);
        $before = CalendarInstance::query()->count();

        $this->busy(weeks: [self::week(), self::week(1)]);

        $this->assertSame($before, CalendarInstance::query()->count());
        $this->assertFalse(CalendarInstance::query()->where('principaluri', 'principals/groups/ops')->exists());
    }

    public function test_the_prune_command_removes_expired_entries_and_keeps_live_ones(): void
    {
        $store = Cache::store('availability');
        $store->put('old-fingerprint', ['occurrences' => [], 'complete' => true], 300);
        $this->travel(10)->minutes();
        $store->put('live', ['occurrences' => [], 'complete' => true], 300);
        $this->assertCount(2, $this->cacheFiles());

        $this->assertSame(0, Artisan::call('wgw:availability:prune-cache'));

        $this->assertCount(1, $this->cacheFiles());
        $this->assertTrue($store->has('live'));
    }

    public function test_settings_stamp_moves_on_every_switch_include_or_detail_change(): void
    {
        $settings = app(AvailabilitySettings::class);
        $this->assertNull($settings->settingsStamp('carol'));
        $stamps = [$settings->settingsStamp('bob')];
        $calendarId = $this->calendarId('principals/bob', 'default');

        $settings->setPref('bob', $calendarId, false, null);
        $stamps[] = $settings->settingsStamp('bob');
        $settings->setPref('bob', $calendarId, null, AvailabilitySettings::DETAIL_DETAILS);
        $stamps[] = $settings->settingsStamp('bob');
        $settings->setEnabled('bob', false);
        $stamps[] = $settings->settingsStamp('bob');

        $this->assertCount(4, array_unique($stamps));
        $this->assertSame([$calendarId => ['include' => false, 'detail' => 'details']], $settings->prefs('bob'));
        $this->assertNull(app(AvailabilityCalculator::class)->busyPeriods('bob', [self::week()]));
    }

    public function test_prefs_rows_die_with_their_calendar(): void
    {
        $this->seedNamedCalendarFor('bob', 'work', 'Work');
        $calendarId = $this->calendarId('principals/bob', 'work');
        app(AvailabilitySettings::class)->setPref('bob', $calendarId, false, null);

        app(CalendarRepository::class)->delete('bob', 'work');

        $this->assertSame([], app(AvailabilitySettings::class)->prefs('bob'));
    }

    /** Removes every object row without touching synctokens. */
    private function silentlyDropObjects(): void
    {
        CalendarObject::query()->delete();
    }

    /**
     * @return list<string>
     */
    private function cacheFiles(): array
    {
        if (! File::isDirectory($this->availabilityCacheDir)) {
            return [];
        }

        return array_map(static fn ($file): string => $file->getPathname(), File::allFiles($this->availabilityCacheDir));
    }

    private function calendarId(string $principalUri, string $uri): int
    {
        return (int) CalendarInstance::query()->where('principaluri', $principalUri)->where('uri', $uri)->value('calendarid');
    }
}
