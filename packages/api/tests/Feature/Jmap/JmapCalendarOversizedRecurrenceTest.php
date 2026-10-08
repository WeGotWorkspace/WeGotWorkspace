<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CalendarObject;
use App\Services\Calendars\HostIpResolver;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\FakeHostIpResolver;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * One over-limit series must not fail CalendarEvent/query for everyone who
 * can see the calendar, and sub-hourly recurrence is rejected on write.
 */
final class JmapCalendarOversizedRecurrenceTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const AFTER = '2026-10-05T00:00:00Z';

    private const BEFORE = '2026-10-08T00:00:00Z';

    private const REJECTED = 'Minutely and secondly recurrence is not supported.';

    protected function setUp(): void
    {
        parent::setUp();

        $installRoot = sys_get_temp_dir().'/wgw-recur-1149-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users/bob', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'admin');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        WgwTestDisks::refresh($dataDir);

        $this->setUpCalendarsFixtures();
    }

    public function test_query_returns_long_daily_series_and_a_normal_event(): void
    {
        $dailyId = $this->seedEventViaPdo('bob', 'long-daily.ics', $this->seriesIcs(
            'long-daily',
            'Long daily',
            '19000101T100000Z',
            '19000101T110000Z',
            'FREQ=DAILY',
        ));
        $normalId = $this->seedEventViaPdo('bob', 'visible.ics', $this->sampleIcs(
            'Visible meeting',
            'visible-meeting',
            '20261006T150000Z',
            '20261006T160000Z',
        ));

        $response = $this->queryWindow();
        $this->assertSame('CalendarEvent/query', $response->json('methodResponses.0.0'));
        $ids = $response->json('methodResponses.0.1.ids');
        $this->assertContains($dailyId, $ids);
        $this->assertContains($normalId, $ids);

        $stored = CalendarObject::query()->where('uri', 'long-daily.ics')->first();
        $this->assertNotNull($stored);
        $ics = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('DTSTART:19000101T100000Z', $ics);
    }

    public function test_query_skips_one_over_limit_series_and_returns_the_other_event(): void
    {
        $poisonId = $this->seedEventViaPdo('bob', 'poison-minutely.ics', $this->seriesIcs(
            'poison-minutely',
            'Poison',
            '20000101T000000Z',
            '20000101T000100Z',
            'FREQ=MINUTELY',
        ));
        $normalId = $this->seedEventViaPdo('bob', 'visible.ics', $this->sampleIcs(
            'Visible meeting',
            'visible-meeting',
            '20261006T150000Z',
            '20261006T160000Z',
        ));

        $response = $this->queryWindow();
        $this->assertSame('CalendarEvent/query', $response->json('methodResponses.0.0'));
        $ids = $response->json('methodResponses.0.1.ids');
        $this->assertContains($normalId, $ids);
        $this->assertNotContains($poisonId, $ids);
    }

    public function test_jmap_set_rejects_minutely_and_secondly_on_create_and_update(): void
    {
        foreach (['minutely', 'secondly'] as $frequency) {
            $response = $this->jmap([
                ['CalendarEvent/set', ['accountId' => 'bob', 'create' => [
                    'd' => $this->recurringPayload($frequency),
                ]], 'c0'],
            ])->assertOk();

            $this->assertSame('CalendarEvent/set', $response->json('methodResponses.0.0'));
            $this->assertSame([], $response->json('methodResponses.0.1.created'));
            $this->assertSame(self::REJECTED, $response->json('methodResponses.0.1.notCreated.d.description'));
        }

        $eventId = (string) $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => [
                'ok' => $this->sampleCalendarEventPayload(),
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.ok.id');

        $updated = $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [
                $eventId => [
                    'recurrenceRules' => [
                        ['@type' => 'RecurrenceRule', 'frequency' => 'minutely'],
                    ],
                ],
            ]], 'u0'],
        ])->assertOk();
        $this->assertSame([], $updated->json('methodResponses.0.1.updated'));
        $this->assertSame(self::REJECTED, $updated->json('methodResponses.0.1.notUpdated.'.$eventId.'.description'));
    }

    public function test_caldav_put_rejects_sub_hourly_recurrence_and_still_stores_daily(): void
    {
        $daily = $this->davPut('daily-ok.ics', $this->seriesIcs(
            'daily-ok',
            'Daily ok',
            '20261006T100000Z',
            '20261006T110000Z',
            'FREQ=DAILY',
        ));
        $daily->assertSuccessful();
        $this->assertNotNull(CalendarObject::query()->where('uri', 'daily-ok.ics')->first());

        foreach ([
            'minutely.ics' => 'FREQ=MINUTELY',
            'secondly.ics' => 'FREQ=SECONDLY',
            'minutely-interval.ics' => 'FREQ=MINUTELY;INTERVAL=60',
            'hourly-zero.ics' => 'FREQ=HOURLY;INTERVAL=0',
        ] as $uri => $rule) {
            $response = $this->davPut($uri, $this->seriesIcs(
                $uri,
                'Rejected',
                '20261006T100000Z',
                '20261006T110000Z',
                $rule,
            ));
            $this->assertGreaterThanOrEqual(400, $response->getStatusCode(), $uri);
            $this->assertLessThan(500, $response->getStatusCode(), $uri);
            $this->assertNull(CalendarObject::query()->where('uri', $uri)->first(), $uri);
        }
    }

    public function test_import_rejects_minutely_and_keeps_the_sibling_event(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
            ."BEGIN:VEVENT\r\nUID:good-import\r\nSUMMARY:Good sibling\r\n"
            ."DTSTART:20261006T150000Z\r\nDTEND:20261006T160000Z\r\nEND:VEVENT\r\n"
            ."BEGIN:VEVENT\r\nUID:bad-import\r\nSUMMARY:Minutely\r\n"
            ."DTSTART:20261006T150000Z\r\nDTEND:20261006T150100Z\r\n"
            ."RRULE:FREQ=MINUTELY\r\nEND:VEVENT\r\n"
            ."END:VCALENDAR\r\n";

        $response = $this->importIcs($ics)->assertCreated();
        $titles = collect($response->json('list'))->pluck('title')->all();
        $this->assertSame(['Good sibling'], $titles);
        $this->assertSame(self::REJECTED, $response->json('errors.0.message'));
        $this->assertSame('invalid_recurrence', $response->json('errors.0.code'));
    }

    public function test_subscription_drops_minutely_event_and_keeps_the_rest(): void
    {
        $dns = (new FakeHostIpResolver)->map('feeds.example.test', ['93.184.216.34']);
        $this->app->instance(HostIpResolver::class, $dns);
        Http::preventStrayRequests();
        Http::fake([
            'https://feeds.example.test/mixed.ics' => Http::response(
                "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
                ."BEGIN:VEVENT\r\nUID:keep-sub\r\nSUMMARY:Keep\r\n"
                ."DTSTART:20261006T150000Z\r\nDTEND:20261006T160000Z\r\nEND:VEVENT\r\n"
                ."BEGIN:VEVENT\r\nUID:drop-sub\r\nSUMMARY:Drop minutely\r\n"
                ."DTSTART:20261006T150000Z\r\nDTEND:20261006T150100Z\r\n"
                ."RRULE:FREQ=MINUTELY\r\nEND:VEVENT\r\n"
                ."END:VCALENDAR\r\n",
                200,
                ['Content-Type' => 'text/calendar'],
            ),
        ]);

        $created = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/subscriptions', [
                'url' => 'https://feeds.example.test/mixed.ics',
                'name' => 'Mixed feed',
            ])
            ->assertCreated()
            ->json();

        $events = $this->jmap([
            ['CalendarEvent/query', [
                'accountId' => 'bob',
                'filter' => ['inCalendars' => [$created['calendarId']]],
            ], 'q0'],
            ['CalendarEvent/get', [
                'accountId' => 'bob',
                '#ids' => ['resultOf' => 'q0', 'name' => 'CalendarEvent/query', 'path' => '/ids'],
            ], 'g0'],
        ])->assertOk()->json('methodResponses.1.1.list');

        $this->assertSame(['Keep'], array_column($events, 'title'));
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function queryWindow(): TestResponse
    {
        return $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => [
                'inCalendars' => ['default'],
                'after' => self::AFTER,
                'before' => self::BEFORE,
            ]], 'c0'],
        ])->assertOk();
    }

    /**
     * @return array<string, mixed>
     */
    private function recurringPayload(string $frequency): array
    {
        return [
            ...$this->sampleCalendarEventPayload(),
            'recurrenceRules' => [
                ['@type' => 'RecurrenceRule', 'frequency' => $frequency],
            ],
        ];
    }

    private function seriesIcs(string $uid, string $summary, string $start, string $end, string $rule): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:{$summary}\r\n"
            ."DTSTART:{$start}\r\nDTEND:{$end}\r\nRRULE:{$rule}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function davPut(string $uri, string $ics): TestResponse
    {
        return $this->call(
            'PUT',
            '/calendars/bob/default/'.$uri,
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('bob:secret'),
                'CONTENT_TYPE' => 'text/calendar',
            ],
            $ics,
        );
    }

    private function importIcs(string $ics): TestResponse
    {
        return $this->call(
            'POST',
            '/api/v1/calendars/events/import?calendarId=default',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Bearer '.$this->userBearerToken(),
                'CONTENT_TYPE' => 'text/calendar',
                'HTTP_ACCEPT' => 'application/json',
            ],
            $ics,
        );
    }
}
