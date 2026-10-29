<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\SabreServerFactory;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Dismissing an inbound calendar share ends access by every id, over JMAP and
 * CalDAV, until the sharee restores it with `isSubscribed: true`. The owner's
 * grant stays.
 */
final class CalendarShareDismissTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedDefaultCalendarFor('alice');
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['email' => null, 'displayname' => 'Groups'],
        );
        $dataDir = sys_get_temp_dir().'/wgw-calendar-dismiss-'.uniqid('', true);
        mkdir($dataDir, 0775, true);
        config(['wgw.data_dir' => $dataDir]);
    }

    public function test_dismissed_calendar_no_longer_resolves_by_id(): void
    {
        [$calendarId, $sharedId, $eventId] = $this->sharedCalendarWithEvent('Dismiss Me', 'dismiss-me');

        $this->dismiss($sharedId);

        $this->assertSame([$sharedId], $this->jmap('alice', 'Calendar/get', ['ids' => [$sharedId]])['notFound']);
        $this->assertSame('notFound', $this->jmap('alice', 'Calendar/set', ['update' => [$sharedId => ['name' => 'Renamed']]])['notUpdated'][$sharedId]['type']);
        $this->assertSame('notFound', $this->jmap('alice', 'Calendar/set', ['destroy' => [$sharedId]])['notDestroyed'][$sharedId]['type']);
        $this->assertSame([$eventId], $this->jmap('alice', 'CalendarEvent/get', ['ids' => [$eventId]])['notFound']);

        $set = $this->jmap('alice', 'CalendarEvent/set', [
            'create' => ['e' => $this->sampleCalendarEventPayload($sharedId)],
            'update' => [$eventId => ['title' => 'Edited']],
            'destroy' => [$eventId],
        ]);
        $this->assertSame([], $set['created'] ?? []);
        $this->assertArrayHasKey('e', $set['notCreated']);
        $this->assertSame('notFound', $set['notUpdated'][$eventId]['type']);
        $this->assertSame('notFound', $set['notDestroyed'][$eventId]['type']);

        $query = fn (string $id): array => $this->jmapAs('alice', [
            ['CalendarEvent/query', ['accountId' => 'alice', 'filter' => ['inCalendars' => [$id]]], 'c0'],
        ])->assertOk()->json('methodResponses.0');
        $this->assertSame('error', $query($sharedId)[0]);
        $this->assertSame($query('no-such-calendar')[1], $query($sharedId)[1]);

        $this->assertNotContains('Dismiss Me', $this->calendarNames('alice'));
        $owner = $this->jmap('bob', 'Calendar/get', ['ids' => [$calendarId]])['list'][0];
        $this->assertIsArray($owner['shareWith']['alice']);
        $this->assertSame('Owner event', $this->jmap('bob', 'CalendarEvent/get', ['ids' => [$eventId]])['list'][0]['title']);
    }

    public function test_dismissed_calendar_is_gone_from_the_caldav_home(): void
    {
        [, $sharedId] = $this->sharedCalendarWithEvent('Over Dav', 'over-dav');
        $this->assertStringContainsString('Over Dav', $this->propfindHome('alice'));

        $this->dismiss($sharedId);

        $this->assertStringNotContainsString('Over Dav', $this->propfindHome('alice'));
        $this->assertSame(404, $this->sabre('alice', 'PROPFIND', '/calendars/alice/'.$sharedId, '', ['Depth' => '0'])['status']);
        $this->assertStringContainsString('Over Dav', $this->propfindHome('bob'));

        $this->jmap('alice', 'Calendar/set', ['update' => [$sharedId => ['isSubscribed' => true]]]);

        $this->assertStringContainsString('Over Dav', $this->propfindHome('alice'));
    }

    public function test_restoring_a_dismissed_calendar_brings_access_back(): void
    {
        [, $sharedId, $eventId] = $this->sharedCalendarWithEvent('Come Back', 'come-back');
        $this->dismiss($sharedId);

        $restored = $this->jmap('alice', 'Calendar/set', ['update' => [$sharedId => ['isSubscribed' => true, 'name' => 'My Copy']]]);
        $this->assertArrayHasKey($sharedId, $restored['updated']);

        $this->assertContains('My Copy', $this->calendarNames('alice'));
        $this->assertSame('Owner event', $this->jmap('alice', 'CalendarEvent/get', ['ids' => [$eventId]])['list'][0]['title']);
        $created = $this->jmap('alice', 'CalendarEvent/set', ['create' => ['e' => $this->sampleCalendarEventPayload($sharedId)]]);
        $this->assertArrayHasKey('e', $created['created']);
    }

    public function test_is_subscribed_false_dismisses_like_destroy(): void
    {
        [, $sharedId, $eventId] = $this->sharedCalendarWithEvent('Unsubscribe', 'unsubscribe');

        $updated = $this->jmap('alice', 'Calendar/set', ['update' => [$sharedId => ['isSubscribed' => false]]]);
        $this->assertArrayHasKey($sharedId, $updated['updated']);

        $this->assertNotContains('Unsubscribe', $this->calendarNames('alice'));
        $this->assertSame([$eventId], $this->jmap('alice', 'CalendarEvent/get', ['ids' => [$eventId]])['notFound']);
    }

    public function test_a_rejected_restore_leaves_the_calendar_dismissed(): void
    {
        [, $sharedId, $eventId] = $this->sharedCalendarWithEvent('Stay Gone', 'stay-gone');
        $this->dismiss($sharedId);

        foreach ([['description' => 'Not mine to change'], ['timeZone' => 'Europe/Amsterdam'], ['name' => ' ']] as $extra) {
            $updated = $this->jmap('alice', 'Calendar/set', ['update' => [$sharedId => ['isSubscribed' => true, ...$extra]]]);
            $this->assertArrayHasKey($sharedId, $updated['notUpdated'], (string) json_encode($extra));
        }

        $this->assertSame([$sharedId], $this->jmap('alice', 'Calendar/get', ['ids' => [$sharedId]])['notFound']);
        $this->assertSame([$eventId], $this->jmap('alice', 'CalendarEvent/get', ['ids' => [$eventId]])['notFound']);
    }

    public function test_is_subscribed_must_be_a_boolean(): void
    {
        [, $sharedId] = $this->sharedCalendarWithEvent('Typed', 'typed');

        $updated = $this->jmap('alice', 'Calendar/set', ['update' => [$sharedId => ['isSubscribed' => 'yes']]]);

        $this->assertSame('invalidProperties', $updated['notUpdated'][$sharedId]['type']);
        $this->assertContains('Typed', $this->calendarNames('alice'));
    }

    public function test_a_revoked_share_cannot_be_restored(): void
    {
        [$calendarId, $sharedId] = $this->sharedCalendarWithEvent('Revoked', 'revoked');
        $this->dismiss($sharedId);
        $this->jmap('bob', 'Calendar/set', ['update' => [$calendarId => ['shareWith' => ['alice' => null]]]]);

        $updated = $this->jmap('alice', 'Calendar/set', ['update' => [$sharedId => ['isSubscribed' => true]]]);

        $this->assertSame('notFound', $updated['notUpdated'][$sharedId]['type']);
        $this->assertNotContains('Revoked', $this->calendarNames('alice'));
    }

    /**
     * @return array{0: string, 1: string, 2: string} owner calendar id, sharee calendar id, owner event id
     */
    private function sharedCalendarWithEvent(string $name, string $id): array
    {
        $calendarId = (string) $this->jmap('bob', 'Calendar/set', ['create' => ['c' => ['name' => $name, 'id' => $id]]])['created']['c']['id'];
        $shared = $this->jmap('bob', 'Calendar/set', ['update' => [$calendarId => ['shareWith' => ['alice' => ['mayWriteAll' => true]]]]]);
        $this->assertArrayHasKey($calendarId, $shared['updated']);
        $eventId = (string) $this->jmap('bob', 'CalendarEvent/set', ['create' => ['e' => array_merge(
            $this->sampleCalendarEventPayload($calendarId),
            ['title' => 'Owner event'],
        )]])['created']['e']['id'];

        $sharedRow = collect($this->jmap('alice', 'Calendar/get', ['ids' => null])['list'])
            ->first(static fn (array $row): bool => $row['name'] === $name);
        $this->assertIsArray($sharedRow);

        return [$calendarId, (string) $sharedRow['id'], $eventId];
    }

    private function dismiss(string $sharedId): void
    {
        $this->assertSame([$sharedId], $this->jmap('alice', 'Calendar/set', ['destroy' => [$sharedId]])['destroyed']);
    }

    /**
     * @return list<string>
     */
    private function calendarNames(string $username): array
    {
        return array_column($this->jmap($username, 'Calendar/get', ['ids' => null])['list'], 'name');
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    private function jmap(string $username, string $method, array $args): array
    {
        $response = $this->jmapAs($username, [[$method, ['accountId' => $username, ...$args], 'c0']])
            ->assertOk()
            ->json('methodResponses.0');
        $this->assertSame($method, $response[0], json_encode($response) ?: '');

        return $response[1];
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function propfindHome(string $username): string
    {
        $body = '<?xml version="1.0" encoding="utf-8"?>'
            .'<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>';
        $home = $this->sabre($username, 'PROPFIND', '/calendars/'.$username, $body, [
            'Depth' => '1',
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(207, $home['status'], $home['body']);

        return $home['body'];
    }

    /**
     * @param  array<string, string>  $headers
     * @return array{status: int, body: string}
     */
    private function sabre(string $username, string $method, string $path, string $body = '', array $headers = []): array
    {
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;
        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest($method, $path, ['Authorization' => $auth, ...$headers], $body);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            return ['status' => $e->getHTTPCode(), 'body' => $e->getMessage()];
        }
        $status = $response->getStatus();

        return ['status' => is_int($status) ? $status : 500, 'body' => (string) $response->getBodyAsString()];
    }
}
