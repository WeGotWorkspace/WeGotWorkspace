<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\CalendarSubscription;
use App\Models\Principal;
use App\Services\Calendars\CollectionKind;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Calendar uris are only unique per owning principal. When a personal calendar and a Team
 * calendar share a uri, only the one a subscription row names is read-only for event writes.
 */
final class CalendarSubscriptionEventWriteTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const TEAM = 'principals/groups/crew';

    protected function calendarFixtureUsersShareATeam(): bool
    {
        return false;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $team = $this->seedWgwGroup(self::TEAM, 'Crew');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($team, $bob);

        $backend = app(WgwCalendarBackendFactory::class)->make();
        foreach (['principals/bob' => 'personal', self::TEAM => 'team'] as $principal => $kind) {
            $backend->createCollection(CollectionKind::EventCalendar, $principal, 'villa', [
                '{DAV:}displayname' => 'Villa '.$kind,
                '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
            ]);
            $this->seedObject($principal, 'event-'.$kind, ucfirst($kind).' event');
        }
    }

    public function test_when_the_personal_calendar_is_the_subscription_only_it_is_read_only(): void
    {
        $this->subscribe('principals/bob');

        $this->assertUpdateRefused('event-personal');
        $this->assertUpdateStored('event-team');
    }

    public function test_when_the_team_calendar_is_the_subscription_only_it_is_read_only(): void
    {
        $this->subscribe(self::TEAM);

        $this->assertUpdateRefused('event-team');
        $this->assertUpdateStored('event-personal');
    }

    private function assertUpdateRefused(string $eventId): void
    {
        $response = $this->update($eventId);
        $this->assertArrayHasKey($eventId, $response['notUpdated'] ?? [], json_encode($response));
        $this->assertNotSame('Changed', $this->titleOf($eventId));
    }

    private function assertUpdateStored(string $eventId): void
    {
        $response = $this->update($eventId);
        $this->assertArrayNotHasKey($eventId, $response['notUpdated'] ?? [], json_encode($response));
        $this->assertSame('Changed', $this->titleOf($eventId));
    }

    /** @return array<string, mixed> */
    private function update(string $eventId): array
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => ['title' => 'Changed']]], 'c0']],
        ])->assertOk()->json('methodResponses.0.1');
    }

    private function titleOf(string $eventId): string
    {
        $row = CalendarObject::query()->where('uri', $eventId.'.ics')->firstOrFail();
        preg_match('/SUMMARY:(.*)/', (string) $row->calendardata, $m);

        return trim($m[1] ?? '');
    }

    private function seedObject(string $principalUri, string $id, string $summary): void
    {
        $calendarId = (int) CalendarInstance::query()->where('principaluri', $principalUri)->where('uri', 'villa')->value('calendarid');
        (new CalPDO(DB::connection('wgw')->getPdo()))->createCalendarObject(
            [$calendarId, (int) CalendarInstance::query()->where('principaluri', $principalUri)->where('uri', 'villa')->value('id')],
            $id.'.ics',
            $this->sampleIcs($summary, $id.'@example.test'),
        );
    }

    private function subscribe(string $principalUri): void
    {
        CalendarSubscription::query()->create([
            'id' => (string) Str::uuid(),
            'username' => 'bob',
            'principal_uri' => $principalUri,
            'calendar_uri' => 'villa',
            'url' => 'https://example.test/villa.ics',
            'name' => 'Villa',
            'last_fetched_at' => now(),
        ]);
    }
}
