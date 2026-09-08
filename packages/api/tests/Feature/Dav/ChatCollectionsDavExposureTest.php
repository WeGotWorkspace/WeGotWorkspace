<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\CalendarInstance;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;

/**
 * DAV-exposure filter for chat collections (Epic #701, chunk B).
 *
 * WHY NOTES AND CHAT ARE INTENTIONALLY TREATED DIFFERENTLY — do not
 * "simplify" this into one rule for all VJOURNAL collections:
 *
 * The same Sabre server accepts a journal PUT on a `notes-` collection while
 * refusing every DAV operation on a `chat-`/`dm-` collection. Both store
 * VJOURNAL; the difference is purely whether the payload renders semantically
 * correct in an external client — not the storage type. A note IS a real
 * journal entry: an external VJOURNAL-capable app renders it meaningfully,
 * and that interop is tolerated by design (docs/architecture/notes.md,
 * "Foreign CalDAV is not a v1 product"). A chat message only USES VJOURNAL as
 * a serialization format: X-WGW-AUTHOR, X-WGW-REACTIONS,
 * RELATED-TO-as-thread-parent and STATUS:CANCELLED-as-tombstone would render
 * foreign chat messages as broken, context-less "cancelled journal entries",
 * and a busy channel would flood an external sync with thousands of tiny
 * entries. Chat collections are API-only surfaces; the VJOURNAL storage trade
 * is conditional on this filter (.agents/specs/701-meet-chat-backend/spec.md).
 * If a future refactor generalizes "both are VJOURNAL, same rules apply",
 * this test must fail.
 */
final class ChatCollectionsDavExposureTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->configureWgwJwtKeys();

        // markInstalled points the wgw connection at a file-backed sqlite DB
        // seeded with alice only; anything else must be seeded after it.
        $installRoot = sys_get_temp_dir().'/wgw-chatdav-root-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users/alice', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'alice');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();

        $this->seedWgwUser('bob', displayName: 'Bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/alice');
    }

    public function test_chat_collections_are_dav_invisible_while_notes_stay_dav_visible(): void
    {
        // One channel with a message, created through the API-only surface.
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'General', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->seedJournalObject('principals/alice', $channelId, 'CHATMSG1');

        // A note in the always-provisioned notebook — the DAV-visible control.
        $this->seedJournalObject('principals/alice', 'notes-general', 'NOTE1');

        // 1) Home-set enumeration: the notebook is listed, the channel is not.
        $home = $this->dav('PROPFIND', '/calendars/alice/', depth: '1');
        $home->assertStatus(207);
        $this->assertStringContainsString('notes-general', (string) $home->getContent());
        $this->assertStringNotContainsString($channelId, (string) $home->getContent());

        // 2) Direct access by known URL — enumeration-hiding alone would not
        //    stop a client that knows the path.
        $this->dav('PROPFIND', '/calendars/alice/'.$channelId.'/', depth: '1')->assertNotFound();
        $this->dav('GET', '/calendars/alice/'.$channelId.'/CHATMSG1.ics')->assertNotFound();
        $this->dav('PUT', '/calendars/alice/'.$channelId.'/intruder.ics', $this->journalIcs('INTRUDER'), [
            'CONTENT_TYPE' => 'text/calendar',
        ])->assertNotFound();
        $this->dav('REPORT', '/calendars/alice/'.$channelId.'/', $this->syncCollectionReportXml(), [
            'CONTENT_TYPE' => 'application/xml',
        ])->assertNotFound();

        // 3) ICSExportPlugin is covered by the same node resolution.
        $this->dav('GET', '/calendars/alice/'.$channelId.'?export')->assertNotFound();

        // 4) The SAME operations on the notes collection stay allowed — the
        //    deliberate asymmetry this test guards (see class docblock).
        $this->dav('PROPFIND', '/calendars/alice/notes-general/', depth: '1')->assertStatus(207);
        $this->dav('GET', '/calendars/alice/notes-general/NOTE1.ics')->assertOk();
        $this->dav('PUT', '/calendars/alice/notes-general/foreign-note.ics', $this->journalIcs('FOREIGNNOTE'), [
            'CONTENT_TYPE' => 'text/calendar',
        ])->assertStatus(201);
        $this->dav('REPORT', '/calendars/alice/notes-general/', $this->syncCollectionReportXml(), [
            'CONTENT_TYPE' => 'application/xml',
        ])->assertStatus(207);
        $export = $this->dav('GET', '/calendars/alice/notes-general?export');
        $export->assertOk();
        $this->assertStringContainsString('NOTE1', (string) $export->getContent());

        // 5) REST is unaffected: the channel stays fully API-visible.
        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$channelId)->assertOk();
    }

    public function test_shared_chat_collection_stays_hidden_from_sharee_home(): void
    {
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Team', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();

        // The sharee sees the channel over REST…
        $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$channelId)->assertOk();

        // …but never over DAV: the sharee instance carries the owner's chat-
        // uri (normalized), so the prefix filter hides it here too.
        $home = $this->dav('PROPFIND', '/calendars/bob/', depth: '1', username: 'bob');
        $home->assertStatus(207);
        $this->assertStringNotContainsString($channelId, (string) $home->getContent());
        $this->dav('PROPFIND', '/calendars/bob/'.$channelId.'/', depth: '1', username: 'bob')->assertNotFound();
    }

    public function test_provisioned_dm_collections_are_dav_invisible_for_both_members(): void
    {
        // A real chunk-G DM: find-or-create via the API, shared to both sides.
        $dmId = (string) $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'bob'])
            ->assertOk()->json('id');
        $this->seedJournalObject('principals/alice', $dmId, 'DMMSG1');

        foreach (['alice', 'bob'] as $member) {
            $home = $this->dav('PROPFIND', '/calendars/'.$member.'/', depth: '1', username: $member);
            $home->assertStatus(207);
            $this->assertStringNotContainsString($dmId, (string) $home->getContent());
            $this->dav('PROPFIND', '/calendars/'.$member.'/'.$dmId.'/', depth: '1', username: $member)
                ->assertNotFound();
        }
        $this->dav('GET', '/calendars/alice/'.$dmId.'/DMMSG1.ics')->assertNotFound();

        // REST stays fully functional for both members.
        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$dmId)->assertOk();
        $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$dmId)->assertOk();
    }

    public function test_dav_clients_cannot_mint_chat_prefixed_collections(): void
    {
        // Extended MKCOL with a calendar resourcetype (MKCALENDAR is not even
        // routed by the Laravel front). The backend refuses hidden prefixes so
        // DAV clients cannot create shadow collections REST would misread as
        // channels.
        $response = $this->dav('MKCOL', '/calendars/alice/chat-shadow/', $this->mkcolCalendarXml(), [
            'CONTENT_TYPE' => 'application/xml',
        ]);
        $response->assertForbidden();
        $this->assertStringContainsString('reserved for API-only collections', (string) $response->getContent());
    }

    private function asUser(string $username)
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }

    /**
     * @param  array<string, string>  $extraServer
     */
    private function dav(
        string $method,
        string $path,
        ?string $body = null,
        array $extraServer = [],
        ?string $depth = null,
        string $username = 'alice',
    ): TestResponse {
        $server = array_merge([
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':secret'),
        ], $extraServer);
        if ($depth !== null) {
            $server['HTTP_DEPTH'] = $depth;
        }
        if ($body !== null) {
            // SabreHttpRequestFactory forwards non-PUT/POST/PATCH bodies only
            // when Content-Length is present (real DAV clients always send it).
            $server['CONTENT_LENGTH'] = (string) strlen($body);
        }

        return $this->call($method, $path, [], [], [], $server, $body);
    }

    private function seedJournalObject(string $principalUri, string $collectionUri, string $uid): void
    {
        $instance = CalendarInstance::query()
            ->where('principaluri', $principalUri)
            ->where('uri', $collectionUri)
            ->firstOrFail();

        // Stock backend on purpose: seeding must bypass the DAV-side filter.
        $backend = new CalPDO(DB::connection('wgw')->getPdo());
        $backend->createCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            $uid.'.ics',
            $this->journalIcs($uid),
        );
    }

    private function journalIcs(string $uid): string
    {
        return implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//WGW//Test//EN',
            'BEGIN:VJOURNAL',
            'UID:'.$uid,
            'DTSTAMP:20260904T120000Z',
            'SUMMARY:'.$uid,
            'END:VJOURNAL',
            'END:VCALENDAR',
            '',
        ]);
    }

    private function syncCollectionReportXml(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="utf-8" ?>
<d:sync-collection xmlns:d="DAV:">
  <d:sync-token/>
  <d:sync-level>1</d:sync-level>
  <d:prop><d:getetag/></d:prop>
</d:sync-collection>
XML;
    }

    private function mkcolCalendarXml(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="utf-8" ?>
<d:mkcol xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:displayname>shadow</d:displayname>
    </d:prop>
  </d:set>
</d:mkcol>
XML;
    }
}
