<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\SabreServerFactory;
use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\CalendarSubscription;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CollectionKind;
use Illuminate\Support\Str;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A feed subscription is read-only over CalDAV (#2370): the feed refresh owns its
 * events, so a PUT or rename from a calendar app would be wiped as stale. A create
 * request for a subscription (MKCOL with cs:subscribed) is refused cleanly.
 */
final class CalDavSubscriptionReadOnlyTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        config(['wgw.data_dir' => sys_get_temp_dir().'/wgw-sub-ro-'.uniqid('', true)]);
        $this->seedNamedCalendarFor('bob', 'feed', 'Holidays');
        $this->seedNamedCalendarFor('bob', 'own', 'Own');
        $this->subscribe('bob', 'feed');
        $this->seedEventViaPdo('bob', 'holiday.ics', $this->sampleIcs('Holiday'), 'feed');
        $this->seedEventViaPdo('bob', 'mine.ics', $this->sampleIcs('Mine'), 'own');
    }

    public function test_propfind_reports_read_only_privileges_on_a_subscription_calendar(): void
    {
        $privileges = $this->privilegesOf('bob', '/calendars/bob/feed');

        $this->assertContains('read', $privileges);
        foreach (['write', 'write-content', 'write-properties', 'bind', 'unbind', 'share'] as $denied) {
            $this->assertNotContains($denied, $privileges, "{$denied} must not be granted on a subscription");
        }
        $this->assertContains('write', $this->privilegesOf('bob', '/calendars/bob/own'));
    }

    public function test_put_delete_proppatch_and_mkcol_are_refused_on_a_subscription_calendar(): void
    {
        $put = $this->dav('bob', 'PUT', '/calendars/bob/feed/new.ics', $this->sampleIcs('Added'), ['Content-Type' => 'text/calendar']);
        $this->assertSame(403, $put['status']);

        $overwrite = $this->dav('bob', 'PUT', '/calendars/bob/feed/holiday.ics', $this->sampleIcs('Changed'), ['Content-Type' => 'text/calendar']);
        $this->assertSame(403, $overwrite['status']);

        $this->assertSame(403, $this->dav('bob', 'DELETE', '/calendars/bob/feed/holiday.ics')['status']);

        $rename = $this->dav('bob', 'PROPPATCH', '/calendars/bob/feed', '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:displayname>Renamed</D:displayname></D:prop></D:set></D:propertyupdate>', ['Content-Type' => 'application/xml']);
        $this->assertSame(403, $rename['status'], $rename['body']);

        $this->assertSame(403, $this->dav('bob', 'MKCOL', '/calendars/bob/feed/sub')['status']);
        $this->assertSame(403, $this->dav('bob', 'DELETE', '/calendars/bob/feed')['status']);

        $this->assertSame('Holiday', $this->summary('feed', 'holiday.ics'));
        $this->assertSame(404, $this->dav('bob', 'GET', '/calendars/bob/feed/new.ics')['status']);
        $this->assertSame('Holidays', $this->displayName('feed'));
    }

    public function test_a_normal_calendar_still_accepts_writes(): void
    {
        $put = $this->dav('bob', 'PUT', '/calendars/bob/own/new.ics', $this->sampleIcs('Added'), ['Content-Type' => 'text/calendar']);
        $this->assertSame(201, $put['status']);
        $this->assertSame(204, $this->dav('bob', 'DELETE', '/calendars/bob/own/mine.ics')['status']);
    }

    public function test_reading_a_subscription_calendar_still_works(): void
    {
        $this->assertSame(200, $this->dav('bob', 'GET', '/calendars/bob/feed/holiday.ics')['status']);
        $this->assertSame(207, $this->dav('bob', 'PROPFIND', '/calendars/bob/feed', '', ['Depth' => '1'])['status']);
    }

    public function test_a_subscription_made_into_a_team_collection_is_read_only_for_members(): void
    {
        $team = $this->seedWgwGroup('principals/groups/feeds', 'Feeds');
        $this->addPrincipalToGroup($team, Principal::forUsername('bob'));
        $this->addPrincipalToGroup($team, Principal::forUsername('carol'));
        app(WgwCalendarBackendFactory::class)->make()->createCollection(CollectionKind::EventCalendar, AdminConstants::GROUP_PREFIX.'feeds', 'team-feed', [
            '{DAV:}displayname' => 'Team feed',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
        ]);
        $this->subscribe('bob', 'team-feed', AdminConstants::GROUP_PREFIX.'feeds');

        $home = $this->dav('carol', 'PROPFIND', '/calendars/carol/team~feeds~team-feed', '', ['Depth' => '0']);
        $this->assertSame(207, $home['status']);
        $put = $this->dav('carol', 'PUT', '/calendars/carol/team~feeds~team-feed/x.ics', $this->sampleIcs('Added'), ['Content-Type' => 'text/calendar']);
        $this->assertSame(403, $put['status']);
    }

    public function test_only_the_calendar_a_subscription_names_is_read_only_when_a_personal_and_a_team_calendar_share_a_uri(): void
    {
        $team = $this->seedWgwGroup('principals/groups/crew', 'Crew');
        $this->addPrincipalToGroup($team, Principal::forUsername('bob'));
        $this->seedNamedCalendarFor('bob', 'villa', 'Villa personal');
        app(WgwCalendarBackendFactory::class)->make()->createCollection(CollectionKind::EventCalendar, AdminConstants::GROUP_PREFIX.'crew', 'villa', [
            '{DAV:}displayname' => 'Villa team',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
        ]);
        // Bob subscribed the Team's `villa`; his personal `villa` is a normal calendar.
        $this->subscribe('bob', 'villa', AdminConstants::GROUP_PREFIX.'crew');

        $ics = $this->sampleIcs('Added');
        $personal = $this->dav('bob', 'PUT', '/calendars/bob/villa/a.ics', $ics, ['Content-Type' => 'text/calendar']);
        $this->assertSame(201, $personal['status'], $personal['body']);
        $teamPut = $this->dav('bob', 'PUT', '/calendars/bob/team~crew~villa/a.ics', $ics, ['Content-Type' => 'text/calendar']);
        $this->assertSame(403, $teamPut['status'], $teamPut['body']);
    }

    public function test_a_team_calendar_is_not_read_only_because_someone_has_a_personal_subscription_with_its_uri(): void
    {
        $team = $this->seedWgwGroup('principals/groups/crew', 'Crew');
        $this->addPrincipalToGroup($team, Principal::forUsername('bob'));
        app(WgwCalendarBackendFactory::class)->make()->createCollection(CollectionKind::EventCalendar, AdminConstants::GROUP_PREFIX.'crew', 'villa', [
            '{DAV:}displayname' => 'Villa team',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
        ]);
        $this->seedNamedCalendarFor('carol', 'villa', 'Villa carol');
        $this->subscribe('carol', 'villa');

        $put = $this->dav('bob', 'PUT', '/calendars/bob/team~crew~villa/a.ics', $this->sampleIcs('Added'), ['Content-Type' => 'text/calendar']);
        $this->assertSame(201, $put['status'], $put['body']);
    }

    public function test_mkcol_with_cs_subscribed_is_a_clean_client_error(): void
    {
        $body = '<?xml version="1.0"?><D:mkcol xmlns:D="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop>'
            .'<D:resourcetype><D:collection/><cs:subscribed/></D:resourcetype>'
            .'<D:displayname>Feed</D:displayname>'
            .'<cs:source><D:href>https://example.test/feed.ics</D:href></cs:source>'
            .'</D:prop></D:set></D:mkcol>';

        $response = $this->dav('bob', 'MKCOL', '/calendars/bob/apple-subscribed', $body, ['Content-Type' => 'application/xml']);

        $this->assertGreaterThanOrEqual(400, $response['status']);
        $this->assertLessThan(500, $response['status'], $response['body']);
        $this->assertStringNotContainsString('getHref', $response['body']);
    }

    private function subscribe(string $username, string $calendarUri, ?string $principalUri = null): void
    {
        CalendarSubscription::query()->create([
            'id' => (string) Str::uuid(),
            'username' => $username,
            'principal_uri' => $principalUri ?? 'principals/'.$username,
            'calendar_uri' => $calendarUri,
            'url' => 'https://example.test/'.$calendarUri.'.ics',
            'name' => $calendarUri,
            'last_fetched_at' => now(),
        ]);
    }

    /** @return list<string> */
    private function privilegesOf(string $username, string $path): array
    {
        $body = '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-privilege-set/></D:prop></D:propfind>';
        $response = $this->dav($username, 'PROPFIND', $path, $body, ['Depth' => '0', 'Content-Type' => 'application/xml']);
        $this->assertSame(207, $response['status'], $response['body']);
        preg_match_all('#<d:privilege>\s*<(?:d|[a-z0-9]+):([a-z-]+)\s*/>#i', $response['body'], $matches);

        return $matches[1];
    }

    private function summary(string $calendarUri, string $object): string
    {
        $row = CalendarObject::query()->where('uri', $object)->firstOrFail();
        preg_match('/SUMMARY:(.*)/', (string) $row->calendardata, $m);

        return trim($m[1] ?? '');
    }

    private function displayName(string $calendarUri): string
    {
        return (string) CalendarInstance::query()->where('uri', $calendarUri)->value('displayname');
    }

    /**
     * @param  array<string, string>  $headers
     * @return array{status: int, body: string}
     */
    private function dav(string $username, string $method, string $path, string $body = '', array $headers = []): array
    {
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;
        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest($method, $path, ['Authorization' => $auth] + $headers, $body);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            return ['status' => $e->getHTTPCode(), 'body' => trim($e->getMessage().' '.$response->getBodyAsString())];
        } catch (\Throwable $e) {
            return ['status' => 500, 'body' => $e->getMessage()];
        }

        return ['status' => (int) $response->getStatus(), 'body' => (string) $response->getBodyAsString()];
    }
}
