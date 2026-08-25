<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\SabreServerFactory;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Sabre\CalDAV\Plugin as CalDavPlugin;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * CalDAV calendarserver-sharing ↔ JMAP shareWith interop (Task #606 / Chunk D).
 */
final class CalendarsCalDavSharingTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const ALICE_MAILTO = 'mailto:alice@example.test';

    private string $dataDir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedDefaultCalendarFor('alice');
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['email' => null, 'displayname' => 'Groups'],
        );
        $this->dataDir = sys_get_temp_dir().'/wgw-sabre-caldav-share-'.uniqid('', true);
        mkdir($this->dataDir, 0775, true);
        config(['wgw.data_dir' => $this->dataDir]);
    }

    public function test_options_dav_includes_calendarserver_sharing(): void
    {
        $response = $this->sabre('bob', 'OPTIONS', '/calendars/bob/default');

        $this->assertSame(200, $response['status']);
        $dav = strtolower($response['headers']['dav'] ?? '');
        $this->assertStringContainsString('calendarserver-sharing', $dav);
        $this->assertStringContainsString('resource-sharing', $dav);
    }

    public function test_jmap_share_appears_on_owner_invite_and_recipient_home(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Shared Projects', 'shared-projects');
        $this->shareViaJmap('bob', $calendarId, 'alice', write: true);

        $invite = $this->sabre('bob', 'PROPFIND', '/calendars/bob/'.$calendarId, $this->invitePropfindXml(), [
            'Depth' => '0',
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(207, $invite['status']);
        $this->assertMatchesRegularExpression('#<(?:[\w-]+:)?invite\b#', $invite['body']);
        $this->assertStringContainsString(self::ALICE_MAILTO, $invite['body']);

        $home = $this->sabre('alice', 'PROPFIND', '/calendars/alice', $this->homePropfindXml(), [
            'Depth' => '1',
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(207, $home['status'], 'PROPFIND /calendars/alice: '.$home['body']);
        $this->assertStringContainsString('Shared Projects', $home['body']);
        $this->assertMatchesRegularExpression(
            '#<(?:[\w-]+:)?(?:read-write|read)\b#',
            $home['body'],
            'Recipient home must advertise share-access 2 or 3 (read / read-write)',
        );

        $access = CalendarInstance::query()
            ->where('principaluri', 'principals/alice')
            ->where('share_href', self::ALICE_MAILTO)
            ->value('access');
        $this->assertContains((int) $access, [SharingPlugin::ACCESS_READ, SharingPlugin::ACCESS_READWRITE]);
    }

    public function test_caldav_cs_share_appears_in_jmap_share_with(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'From Apple', 'from-apple');

        $posted = $this->sabre('bob', 'POST', '/calendars/bob/'.$calendarId, $this->csShareXml(self::ALICE_MAILTO, write: true), [
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(200, $posted['status'], $posted['body']);

        $shareWith = $this->ownerShareWith('bob', $calendarId);
        $this->assertIsArray($shareWith['alice'] ?? null, 'CalDAV CS:share must map mailto: to JMAP id alice');
        $this->assertTrue($shareWith['alice']['mayWriteAll']);

        $shared = $this->calendarNamed('alice', 'From Apple');
        $this->assertTrue($shared['myRights']['mayWriteAll']);
        $this->assertNull($shared['shareWith']);
    }

    public function test_caldav_dav_share_resource_appears_in_jmap_share_with(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Dav Sharing', 'dav-sharing');

        $posted = $this->sabre('bob', 'POST', '/calendars/bob/'.$calendarId, $this->davShareResourceXml(self::ALICE_MAILTO, write: false), [
            'Content-Type' => 'application/davsharing+xml',
        ]);
        $this->assertSame(200, $posted['status'], $posted['body']);

        $shareWith = $this->ownerShareWith('bob', $calendarId);
        $this->assertIsArray($shareWith['alice'] ?? null, 'DAV:share-resource must map mailto: to JMAP id alice');
        $this->assertFalse($shareWith['alice']['mayWriteAll']);
    }

    public function test_revoke_on_either_side_clears_the_other(): void
    {
        $jmapId = $this->createPersonalCalendar('bob', 'Revoke Jmap First', 'revoke-jmap-first');
        $this->shareViaJmap('bob', $jmapId, 'alice', write: false);

        $revoked = $this->sabre('bob', 'POST', '/calendars/bob/'.$jmapId, $this->csRevokeXml(self::ALICE_MAILTO), [
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(200, $revoked['status'], $revoked['body']);
        $this->assertNull($this->ownerShareWith('bob', $jmapId));
        $this->assertNotContains('Revoke Jmap First', $this->calendarNames('alice'));

        $caldavId = $this->createPersonalCalendar('bob', 'Revoke Caldav First', 'revoke-caldav-first');
        $posted = $this->sabre('bob', 'POST', '/calendars/bob/'.$caldavId, $this->csShareXml(self::ALICE_MAILTO, write: true), [
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(200, $posted['status'], $posted['body']);
        $this->assertIsArray($this->ownerShareWith('bob', $caldavId)['alice'] ?? null);

        $this->jmapAs('bob', [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$caldavId => [
                'shareWith' => ['alice' => null],
            ]]], 'c0'],
        ])->assertOk();

        $this->assertNull($this->ownerShareWith('bob', $caldavId));
        $this->assertNotContains('Revoke Caldav First', $this->calendarNames('alice'));

        $invite = $this->sabre('bob', 'PROPFIND', '/calendars/bob/'.$caldavId, $this->invitePropfindXml(), [
            'Depth' => '0',
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(207, $invite['status']);
        $this->assertStringNotContainsString(self::ALICE_MAILTO, $invite['body']);
    }

    public function test_read_only_share_denies_caldav_put(): void
    {
        $calendarId = $this->createPersonalCalendar('bob', 'Read Only Dav', 'read-only-dav');
        $this->shareViaJmap('bob', $calendarId, 'alice', write: false);
        $sharedId = (string) $this->calendarNamed('alice', 'Read Only Dav')['id'];

        $put = $this->sabre(
            'alice',
            'PUT',
            '/calendars/alice/'.$sharedId.'/denied.ics',
            $this->sampleIcs('Should Fail'),
            ['Content-Type' => 'text/calendar'],
        );
        $this->assertContains(
            $put['status'],
            [401, 403],
            'Read-only share must deny CalDAV PUT of a new event; path=/calendars/alice/'.$sharedId.'/denied.ics status='.$put['status'].' '.$put['body'],
        );
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

    private function createPersonalCalendar(string $username, string $name, string $id): string
    {
        $created = $this->jmapAs($username, [
            ['Calendar/set', ['accountId' => $username, 'create' => ['c' => [
                'name' => $name,
                'id' => $id,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c');

        return (string) $created['id'];
    }

    private function shareViaJmap(string $owner, string $calendarId, string $sharee, bool $write): void
    {
        $rights = $write
            ? ['mayWriteAll' => true]
            : ['mayReadItems' => true];

        $args = $this->jmapAs($owner, [
            ['Calendar/set', ['accountId' => $owner, 'update' => [$calendarId => [
                'shareWith' => [$sharee => $rights],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertNull($args['notUpdated'][$calendarId] ?? null);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function ownerShareWith(string $username, string $calendarId): ?array
    {
        $shareWith = $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => [$calendarId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0.shareWith');

        return is_array($shareWith) ? $shareWith : null;
    }

    /**
     * @return array<string, mixed>
     */
    private function calendarNamed(string $username, string $name): array
    {
        $list = $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $calendar = collect($list)->first(static fn (array $row): bool => $row['name'] === $name);
        $this->assertIsArray($calendar, "Expected {$username} to see calendar {$name}");

        return $calendar;
    }

    /**
     * @return list<string>
     */
    private function calendarNames(string $username): array
    {
        $list = $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        return array_values(array_map(
            static fn (array $row): string => (string) $row['name'],
            $list,
        ));
    }

    /**
     * @param  array<string, string>  $headers
     * @return array{status: int, headers: array<string, string>, body: string}
     */
    private function sabre(string $username, string $method, string $path, string $body = '', array $headers = []): array
    {
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;
        $headers = array_merge([
            'Authorization' => $auth,
        ], $headers);

        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest($method, $path, $headers, $body);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            return [
                'status' => $e->getHTTPCode(),
                'headers' => $this->headerMap($response),
                'body' => trim($e->getMessage().' '.(string) $response->getBodyAsString()),
            ];
        }

        $status = $response->getStatus();

        return [
            'status' => is_int($status) ? $status : 500,
            'headers' => $this->headerMap($response),
            'body' => (string) $response->getBodyAsString(),
        ];
    }

    /**
     * @return array<string, string>
     */
    private function headerMap(SabreResponse $response): array
    {
        $headers = [];
        foreach ($response->getHeaders() as $name => $values) {
            $headers[strtolower((string) $name)] = is_array($values) ? implode(', ', $values) : (string) $values;
        }

        return $headers;
    }

    private function invitePropfindXml(): string
    {
        return '<?xml version="1.0" encoding="utf-8"?>'
            .'<d:propfind xmlns:d="DAV:" xmlns:cs="'.CalDavPlugin::NS_CALENDARSERVER.'">'
            .'<d:prop><cs:invite/><d:invite/><d:share-access/><d:displayname/></d:prop>'
            .'</d:propfind>';
    }

    private function homePropfindXml(): string
    {
        return '<?xml version="1.0" encoding="utf-8"?>'
            .'<d:propfind xmlns:d="DAV:" xmlns:cs="'.CalDavPlugin::NS_CALENDARSERVER.'">'
            .'<d:prop><d:displayname/><d:resourcetype/><d:share-access/></d:prop>'
            .'</d:propfind>';
    }

    private function csShareXml(string $mailto, bool $write): string
    {
        $access = $write ? '<cs:read-write/>' : '<cs:read/>';

        return '<?xml version="1.0" encoding="utf-8"?>'
            .'<cs:share xmlns:d="DAV:" xmlns:cs="'.CalDavPlugin::NS_CALENDARSERVER.'">'
            .'<cs:set><d:href>'.$mailto.'</d:href><cs:common-name>Alice</cs:common-name>'.$access.'</cs:set>'
            .'</cs:share>';
    }

    private function csRevokeXml(string $mailto): string
    {
        return '<?xml version="1.0" encoding="utf-8"?>'
            .'<cs:share xmlns:d="DAV:" xmlns:cs="'.CalDavPlugin::NS_CALENDARSERVER.'">'
            .'<cs:remove><d:href>'.$mailto.'</d:href></cs:remove>'
            .'</cs:share>';
    }

    private function davShareResourceXml(string $mailto, bool $write): string
    {
        $access = $write ? '<d:read-write/>' : '<d:read/>';

        return '<?xml version="1.0" encoding="utf-8"?>'
            .'<d:share-resource xmlns:d="DAV:">'
            .'<d:sharee><d:href>'.$mailto.'</d:href>'
            .'<d:share-access>'.$access.'</d:share-access>'
            .'</d:sharee></d:share-resource>';
    }
}
