<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Dav\SabreServerFactory;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use Sabre\CalDAV\Plugin as CalDavPlugin;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;

/**
 * CalDAV calendarserver-sharing ↔ app shareWith interop, parameterized by
 * collection uri and supported-calendar-component-set (VEVENT vs VTODO).
 *
 * Sabre's sharing plugins operate on ISharedCalendar / ISharedNode and do not
 * read the component set. These cases verify that assumption; if a VTODO
 * collection is rejected, stop and document — do not paper over it.
 */
trait CalDavCollectionSharingInterop
{
    private const CALDAV_SHARE_ALICE_MAILTO = 'mailto:alice@example.test';

    private string $calDavShareDataDir;

    abstract protected function calDavSharingComponentSet(): string;

    abstract protected function optionsCollectionUri(string $username): string;

    abstract protected function createSharingCollection(string $username, string $name, string $uri): string;

    abstract protected function shareCollectionViaApp(string $owner, string $collectionId, string $sharee, bool $write): void;

    abstract protected function revokeCollectionViaApp(string $owner, string $collectionId, string $sharee): void;

    /**
     * @return array<string, mixed>|null
     */
    abstract protected function ownerCollectionShareWith(string $username, string $collectionId): ?array;

    /**
     * @return array<string, mixed>
     */
    abstract protected function collectionNamedForViewer(string $username, string $name): array;

    /**
     * @return list<string>
     */
    abstract protected function collectionNamesForViewer(string $username): array;

    abstract protected function sharingObjectIcs(string $summary): string;

    protected function setUpCalDavSharingInterop(): void
    {
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['email' => null, 'displayname' => 'Groups'],
        );
        $this->calDavShareDataDir = sys_get_temp_dir().'/wgw-sabre-caldav-share-'.uniqid('', true);
        mkdir($this->calDavShareDataDir, 0775, true);
        config(['wgw.data_dir' => $this->calDavShareDataDir]);
    }

    public function test_options_dav_includes_calendarserver_sharing(): void
    {
        $uri = $this->optionsCollectionUri('bob');
        $response = $this->calDavShareSabre('bob', 'OPTIONS', '/calendars/bob/'.$uri);

        $this->assertSame(200, $response['status']);
        $dav = strtolower($response['headers']['dav'] ?? '');
        $this->assertStringContainsString('calendarserver-sharing', $dav);
        $this->assertStringContainsString('resource-sharing', $dav);
    }

    public function test_app_share_appears_on_owner_invite_and_recipient_home(): void
    {
        $collectionId = $this->createSharingCollection('bob', 'Shared Projects', 'shared-projects');
        $this->assertCollectionComponentSet('bob', $collectionId);
        $this->shareCollectionViaApp('bob', $collectionId, 'alice', write: true);

        $invite = $this->calDavShareSabre('bob', 'PROPFIND', '/calendars/bob/'.$collectionId, $this->invitePropfindXml(), [
            'Depth' => '0',
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(207, $invite['status']);
        $this->assertMatchesRegularExpression('#<(?:[\w-]+:)?invite\b#', $invite['body']);
        $this->assertStringContainsString(self::CALDAV_SHARE_ALICE_MAILTO, $invite['body']);

        $home = $this->calDavShareSabre('alice', 'PROPFIND', '/calendars/alice', $this->homePropfindXml(), [
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
            ->where('share_href', self::CALDAV_SHARE_ALICE_MAILTO)
            ->value('access');
        $this->assertContains((int) $access, [SharingPlugin::ACCESS_READ, SharingPlugin::ACCESS_READWRITE]);
    }

    public function test_caldav_cs_share_appears_in_app_share_with(): void
    {
        $collectionId = $this->createSharingCollection('bob', 'From Apple', 'from-apple');
        $this->assertCollectionComponentSet('bob', $collectionId);

        $posted = $this->calDavShareSabre('bob', 'POST', '/calendars/bob/'.$collectionId, $this->csShareXml(self::CALDAV_SHARE_ALICE_MAILTO, write: true), [
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(
            200,
            $posted['status'],
            'Sabre must accept CS:share on a '.$this->calDavSharingComponentSet()
                .' collection (collection-level, not component-gated). '.$posted['body'],
        );

        $shareWith = $this->ownerCollectionShareWith('bob', $collectionId);
        $this->assertIsArray($shareWith['alice'] ?? null, 'CalDAV CS:share must map mailto: to app shareWith id alice');
        $this->assertShareGrantWrite((array) $shareWith['alice'], true);

        $shared = $this->collectionNamedForViewer('alice', 'From Apple');
        $this->assertTrue($shared['myRights']['mayWriteAll']);
        $this->assertNull($shared['shareWith']);
    }

    public function test_caldav_dav_share_resource_appears_in_app_share_with(): void
    {
        $collectionId = $this->createSharingCollection('bob', 'Dav Sharing', 'dav-sharing');
        $this->assertCollectionComponentSet('bob', $collectionId);

        $posted = $this->calDavShareSabre('bob', 'POST', '/calendars/bob/'.$collectionId, $this->davShareResourceXml(self::CALDAV_SHARE_ALICE_MAILTO, write: false), [
            'Content-Type' => 'application/davsharing+xml',
        ]);
        $this->assertSame(
            200,
            $posted['status'],
            'Sabre must accept DAV:share-resource on a '.$this->calDavSharingComponentSet()
                .' collection (collection-level, not component-gated). '.$posted['body'],
        );

        $shareWith = $this->ownerCollectionShareWith('bob', $collectionId);
        $this->assertIsArray($shareWith['alice'] ?? null, 'DAV:share-resource must map mailto: to app shareWith id alice');
        $this->assertShareGrantWrite((array) $shareWith['alice'], false);
    }

    public function test_revoke_on_either_side_clears_the_other(): void
    {
        $appId = $this->createSharingCollection('bob', 'Revoke App First', 'revoke-app-first');
        $this->shareCollectionViaApp('bob', $appId, 'alice', write: false);

        $revoked = $this->calDavShareSabre('bob', 'POST', '/calendars/bob/'.$appId, $this->csRevokeXml(self::CALDAV_SHARE_ALICE_MAILTO), [
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(200, $revoked['status'], $revoked['body']);
        $this->assertNull($this->ownerCollectionShareWith('bob', $appId));
        $this->assertNotContains('Revoke App First', $this->collectionNamesForViewer('alice'));

        $caldavId = $this->createSharingCollection('bob', 'Revoke Caldav First', 'revoke-caldav-first');
        $posted = $this->calDavShareSabre('bob', 'POST', '/calendars/bob/'.$caldavId, $this->csShareXml(self::CALDAV_SHARE_ALICE_MAILTO, write: true), [
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(200, $posted['status'], $posted['body']);
        $this->assertIsArray($this->ownerCollectionShareWith('bob', $caldavId)['alice'] ?? null);

        $this->revokeCollectionViaApp('bob', $caldavId, 'alice');

        $this->assertNull($this->ownerCollectionShareWith('bob', $caldavId));
        $this->assertNotContains('Revoke Caldav First', $this->collectionNamesForViewer('alice'));

        $invite = $this->calDavShareSabre('bob', 'PROPFIND', '/calendars/bob/'.$caldavId, $this->invitePropfindXml(), [
            'Depth' => '0',
            'Content-Type' => 'application/xml',
        ]);
        $this->assertSame(207, $invite['status']);
        $this->assertStringNotContainsString(self::CALDAV_SHARE_ALICE_MAILTO, $invite['body']);
    }

    public function test_read_only_share_denies_caldav_put(): void
    {
        $collectionId = $this->createSharingCollection('bob', 'Read Only Dav', 'read-only-dav');
        $this->shareCollectionViaApp('bob', $collectionId, 'alice', write: false);
        $sharedId = (string) $this->collectionNamedForViewer('alice', 'Read Only Dav')['id'];

        $put = $this->calDavShareSabre(
            'alice',
            'PUT',
            '/calendars/alice/'.$sharedId.'/denied.ics',
            $this->sharingObjectIcs('Should Fail'),
            ['Content-Type' => 'text/calendar'],
        );
        $this->assertContains(
            $put['status'],
            [401, 403],
            'Read-only share must deny CalDAV PUT; path=/calendars/alice/'.$sharedId.'/denied.ics status='.$put['status'].' '.$put['body'],
        );
    }

    /**
     * @param  array<string, string>  $headers
     * @return array{status: int, headers: array<string, string>, body: string}
     */
    protected function calDavShareSabre(string $username, string $method, string $path, string $body = '', array $headers = []): array
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
                'headers' => $this->calDavShareHeaderMap($response),
                'body' => trim($e->getMessage().' '.(string) $response->getBodyAsString()),
            ];
        }

        $status = $response->getStatus();

        return [
            'status' => is_int($status) ? $status : 500,
            'headers' => $this->calDavShareHeaderMap($response),
            'body' => (string) $response->getBodyAsString(),
        ];
    }

    /**
     * @return array<string, string>
     */
    private function calDavShareHeaderMap(SabreResponse $response): array
    {
        $headers = [];
        foreach ($response->getHeaders() as $name => $values) {
            $headers[strtolower((string) $name)] = is_array($values) ? implode(', ', $values) : (string) $values;
        }

        return $headers;
    }

    /**
     * @param  array<string, mixed>  $grant
     */
    private function assertShareGrantWrite(array $grant, bool $write): void
    {
        $mayWrite = (bool) ($grant['mayWriteAll'] ?? $grant['mayWrite'] ?? false);
        if ($write) {
            $this->assertTrue($mayWrite, 'Expected write grant on shareWith entry');
        } else {
            $this->assertFalse($mayWrite, 'Expected read-only grant on shareWith entry');
        }
    }

    private function assertCollectionComponentSet(string $username, string $collectionId): void
    {
        $expected = $this->calDavSharingComponentSet();
        $propfind = $this->calDavShareSabre(
            $username,
            'PROPFIND',
            '/calendars/'.$username.'/'.$collectionId,
            $this->componentSetPropfindXml(),
            [
                'Depth' => '0',
                'Content-Type' => 'application/xml',
            ],
        );
        $this->assertSame(207, $propfind['status'], $propfind['body']);
        $this->assertMatchesRegularExpression(
            '#<(?:[\w-]+:)?comp\b[^>]*\bname="'.$expected.'"#',
            $propfind['body'],
            'Collection '.$collectionId.' must advertise '.$expected,
        );
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

    private function componentSetPropfindXml(): string
    {
        return '<?xml version="1.0" encoding="utf-8"?>'
            .'<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
            .'<d:prop><c:supported-calendar-component-set/></d:prop>'
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
