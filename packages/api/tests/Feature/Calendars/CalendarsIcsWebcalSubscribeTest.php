<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarObject;
use App\Models\CalendarSubscription;
use App\Models\Principal;
use App\Services\Calendars\HostIpResolver;
use App\Services\Jmap\JmapCapabilities;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\FakeHostIpResolver;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarsIcsWebcalSubscribeTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const FEED_URL = 'https://feeds.example.test/holidays.ics';

    private FakeHostIpResolver $dns;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->dns = (new FakeHostIpResolver)->map('feeds.example.test', ['93.184.216.34']);
        $this->app->instance(HostIpResolver::class, $this->dns);
        Http::preventStrayRequests();
    }

    public function test_subscribe_normalizes_webcal_fetches_and_exposes_subscription_id_on_calendar_get(): void
    {
        $uid = 'event-one@example.test';
        Http::fake([
            self::FEED_URL => Http::response($this->sampleIcs('Holiday', $uid), 200, [
                'Content-Type' => 'text/calendar',
            ]),
        ]);

        $created = $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => 'webcal://feeds.example.test/holidays.ics',
            'name' => 'Holidays',
            'color' => '#22c55e',
        ])->assertCreated()->json();

        $this->assertSame(self::FEED_URL, $created['url']);
        $this->assertSame('Holidays', $created['name']);
        $this->assertSame('#22c55e', $created['color']);
        $this->assertNotSame('', $created['id']);
        $this->assertNotSame('', $created['calendarId']);
        $this->assertNotNull($created['lastFetchedAt']);

        $this->asBob()->getJson('/api/v1/calendars/subscriptions')
            ->assertOk()
            ->assertJsonPath('list.0.id', $created['id'])
            ->assertJsonPath('list.0.calendarId', $created['calendarId']);

        $this->asBob()->getJson('/api/v1/calendars/subscriptions/'.$created['id'])
            ->assertOk()
            ->assertJsonPath('id', $created['id']);

        $calendar = $this->jmapCalendar($created['calendarId']);
        $this->assertSame($created['id'], $calendar['subscriptionId']);
        $this->assertTrue($calendar['isSubscribed']);
        $this->assertFalse($calendar['myRights']['mayWriteAll']);
        $this->assertTrue($calendar['myRights']['mayDelete']);

        $events = $this->jmapEvents($created['calendarId']);
        $this->assertCount(1, $events);
        $this->assertSame('Holiday', $events[0]['title']);
        $this->assertSame($uid, $events[0]['uid']);

        $this->assertSame(
            1,
            CalendarObject::query()->where('uid', $uid)->count(),
        );
    }

    public function test_invalid_ics_is_4xx_and_does_not_create_a_calendar(): void
    {
        Http::fake([
            self::FEED_URL => Http::response('not a calendar', 200),
        ]);

        $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => self::FEED_URL,
        ])->assertStatus(400);

        $this->assertSame(0, CalendarSubscription::query()->count());
        $calendars = $this->jmap([
            ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $this->assertCount(1, $calendars);
        $this->assertSame('default', $calendars[0]['id']);
    }

    public function test_rejects_non_http_schemes_and_private_targets(): void
    {
        $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => 'ftp://feeds.example.test/holidays.ics',
        ])->assertStatus(400);

        $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => 'http://127.0.0.1/secret.ics',
        ])->assertStatus(400);

        $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => 'http://169.254.169.254/latest/meta-data',
        ])->assertStatus(400);

        $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => 'http://10.1.2.3/cal.ics',
        ])->assertStatus(400);

        $this->assertSame(0, CalendarSubscription::query()->count());
    }

    public function test_rejects_redirect_to_a_private_ip(): void
    {
        Http::fake([
            'https://feeds.example.test/redirect.ics' => Http::response('', 302, [
                'Location' => 'http://127.0.0.1/secret.ics',
            ]),
        ]);

        $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => 'https://feeds.example.test/redirect.ics',
        ])->assertStatus(400);

        $this->assertSame(0, CalendarSubscription::query()->count());
    }

    public function test_oversized_ics_is_rejected(): void
    {
        Http::fake([
            self::FEED_URL => Http::response(str_repeat('A', VObjectPayloadGuard::MAX_ICS_BYTES + 1), 200),
        ]);

        $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => self::FEED_URL,
        ])->assertStatus(413);
    }

    public function test_refresh_upserts_and_deletes_by_uid(): void
    {
        $keep = 'keep@example.test';
        $gone = 'gone@example.test';
        Http::fake([
            self::FEED_URL => Http::sequence()
                ->push($this->twoEventIcs($keep, $gone), 200)
                ->push($this->sampleIcs('Updated keep', $keep), 200),
        ]);

        $created = $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => self::FEED_URL,
            'name' => 'Feed',
        ])->assertCreated()->json();

        $this->assertCount(2, $this->jmapEvents($created['calendarId']));

        $this->asBob()->postJson('/api/v1/calendars/subscriptions/'.$created['id'].'/refresh')
            ->assertOk()
            ->assertJsonPath('id', $created['id']);

        $events = $this->jmapEvents($created['calendarId']);
        $this->assertCount(1, $events);
        $this->assertSame('Updated keep', $events[0]['title']);
        $this->assertSame($keep, $events[0]['uid']);
        $this->assertSame(0, CalendarObject::query()->where('uid', $gone)->count());
    }

    public function test_event_writes_to_subscription_calendars_are_forbidden(): void
    {
        Http::fake([
            self::FEED_URL => Http::response($this->sampleIcs(), 200),
        ]);
        $created = $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => self::FEED_URL,
        ])->assertCreated()->json();

        $response = $this->jmap([
            ['CalendarEvent/set', [
                'accountId' => 'bob',
                'create' => [
                    'x' => [
                        'calendarIds' => [$created['calendarId'] => true],
                        'title' => 'Nope',
                        'start' => gmdate('Y-m-d\TH:i:s\Z', strtotime('+3 days 10:00 UTC')),
                    ],
                ],
            ], 'c0'],
        ])->assertOk();

        $this->assertArrayHasKey('x', $response->json('methodResponses.0.1.notCreated'));
    }

    public function test_delete_removes_the_subscription_calendar_and_events(): void
    {
        Http::fake([
            self::FEED_URL => Http::response($this->sampleIcs('Holiday', 'gone-with-unsub@example.test'), 200),
        ]);
        $created = $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => self::FEED_URL,
        ])->assertCreated()->json();

        $this->asBob()->deleteJson('/api/v1/calendars/subscriptions/'.$created['id'])
            ->assertNoContent();

        $this->asBob()->getJson('/api/v1/calendars/subscriptions/'.$created['id'])
            ->assertNotFound();
        $this->assertSame(0, CalendarSubscription::query()->count());
        $this->assertSame(0, CalendarObject::query()->where('uid', 'gone-with-unsub@example.test')->count());

        $ids = array_column($this->jmap([
            ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->json('methodResponses.0.1.list'), 'id');
        $this->assertNotContains($created['calendarId'], $ids);
    }

    public function test_subscribe_to_a_team_directory_exposes_the_calendar_to_group_members(): void
    {
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        $bob = Principal::forUsername('bob');
        $carol = Principal::forUsername('carol');
        $this->assertNotNull($bob);
        $this->assertNotNull($carol);
        $this->addPrincipalToGroup($team, $bob);
        $this->addPrincipalToGroup($team, $carol);

        Http::fake([
            self::FEED_URL => Http::response(
                "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:ICS Holidays\r\n"
                .$this->vevent('Holiday', 'team-hol@example.test')
                ."END:VCALENDAR\r\n",
                200,
                ['Content-Type' => 'text/calendar'],
            ),
        ]);

        $created = $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => self::FEED_URL,
            'groupSlug' => 'team',
        ])->assertCreated()->json();

        $this->assertSame('ICS Holidays', $created['name']);

        $bobCalendar = $this->jmapCalendar($created['calendarId']);
        $this->assertSame($created['id'], $bobCalendar['subscriptionId']);
        $this->assertSame('group', $bobCalendar['scope']);
        $this->assertSame('team', $bobCalendar['groupSlug']);
        $this->assertFalse($bobCalendar['myRights']['mayWriteAll']);

        $carolCalendar = $this->withBearer($this->issueBearerTokenFor('carol'))
            ->postJson('/api/v1/jmap', [
                'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
                'methodCalls' => [
                    ['Calendar/get', ['accountId' => 'carol', 'ids' => [$created['calendarId']]], 'c0'],
                ],
            ])
            ->assertOk()
            ->json('methodResponses.0.1.list.0');
        $this->assertSame($created['id'], $carolCalendar['subscriptionId']);
        $this->assertSame('team', $carolCalendar['groupSlug']);
    }

    public function test_subscription_id_is_scoped_to_the_calendar_owner(): void
    {
        $this->seedNamedCalendarFor('bob', 'work', 'Work');
        $this->seedNamedCalendarFor('carol', 'work', 'Work');
        $subscription = CalendarSubscription::query()->create([
            'id' => (string) Str::uuid(),
            'username' => 'bob',
            'calendar_uri' => 'work',
            'url' => self::FEED_URL,
            'name' => 'Work',
            'last_fetched_at' => now(),
        ]);

        $bobCalendar = $this->jmapCalendar('work');
        $this->assertSame((string) $subscription->id, $bobCalendar['subscriptionId']);
        $this->assertFalse($bobCalendar['myRights']['mayWriteAll']);

        $carolCalendar = $this->withBearer($this->issueBearerTokenFor('carol'))
            ->postJson('/api/v1/jmap', [
                'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
                'methodCalls' => [
                    ['Calendar/get', ['accountId' => 'carol', 'ids' => ['work']], 'c0'],
                ],
            ])
            ->assertOk()
            ->json('methodResponses.0.1.list.0');
        $this->assertSame('work', $carolCalendar['id']);
        $this->assertNull($carolCalendar['subscriptionId']);
        $this->assertTrue($carolCalendar['myRights']['mayWriteAll']);
    }

    public function test_deleting_a_personal_calendar_does_not_remove_another_users_subscription(): void
    {
        $this->seedNamedCalendarFor('bob', 'work', 'Work');
        $this->seedNamedCalendarFor('carol', 'work', 'Work');
        $subscription = CalendarSubscription::query()->create([
            'id' => (string) Str::uuid(),
            'username' => 'bob',
            'calendar_uri' => 'work',
            'url' => self::FEED_URL,
            'name' => 'Work',
            'last_fetched_at' => now(),
        ]);

        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->postJson('/api/v1/jmap', [
                'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
                'methodCalls' => [
                    ['Calendar/set', ['accountId' => 'carol', 'destroy' => ['work']], 'c1'],
                ],
            ])
            ->assertOk();

        $this->assertTrue(CalendarSubscription::query()->whereKey($subscription->id)->exists());
        $this->assertSame((string) $subscription->id, $this->jmapCalendar('work')['subscriptionId']);
    }

    public function test_other_users_cannot_read_or_delete_a_subscription(): void
    {
        Http::fake([
            self::FEED_URL => Http::response($this->sampleIcs(), 200),
        ]);
        $created = $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => self::FEED_URL,
        ])->assertCreated()->json();

        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->getJson('/api/v1/calendars/subscriptions/'.$created['id'])
            ->assertNotFound();
        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->deleteJson('/api/v1/calendars/subscriptions/'.$created['id'])
            ->assertNotFound();
        $this->assertSame(1, CalendarSubscription::query()->count());
    }

    private function asBob(): self
    {
        return $this->withBearer($this->userBearerToken());
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->asBob()->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function jmapCalendar(string $calendarId): array
    {
        $list = $this->jmap([
            ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $this->assertNotEmpty($list);

        return $list[0];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function jmapEvents(string $calendarId): array
    {
        return $this->jmap([
            ['CalendarEvent/query', [
                'accountId' => 'bob',
                'filter' => ['inCalendars' => [$calendarId]],
            ], 'q0'],
            ['CalendarEvent/get', [
                'accountId' => 'bob',
                '#ids' => ['resultOf' => 'q0', 'name' => 'CalendarEvent/query', 'path' => '/ids'],
            ], 'g0'],
        ])->assertOk()->json('methodResponses.1.1.list');
    }

    private function twoEventIcs(string $keepUid, string $goneUid): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"
            .$this->vevent('Keep', $keepUid)
            .$this->vevent('Gone', $goneUid)
            ."END:VCALENDAR\r\n";
    }

    private function vevent(string $summary, string $uid): string
    {
        $start = gmdate('Ymd\THis\Z', strtotime('+1 day 10:00 UTC'));
        $end = gmdate('Ymd\THis\Z', strtotime('+1 day 11:00 UTC'));

        return "BEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:{$summary}\r\nDTSTART:{$start}\r\nDTEND:{$end}\r\nEND:VEVENT\r\n";
    }
}
