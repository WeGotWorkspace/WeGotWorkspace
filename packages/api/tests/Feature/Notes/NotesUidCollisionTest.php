<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * The collab room key is the note UID, and room access is "may read a note
 * with this UID". A note UID is only unique per notebook (calendarid, uid), so
 * a second note with someone else's UID in your own notebook would pass that
 * check for their room.
 */
final class NotesUidCollisionTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $installRoot = sys_get_temp_dir().'/wgw-note-uid-'.uniqid('', true);
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
        $provisioner = app(UserCalendarCollectionsProvisioner::class);
        $provisioner->ensureForPrincipal('principals/alice');
        $provisioner->ensureForPrincipal('principals/bob');
    }

    public function test_another_user_cannot_reuse_a_note_uid_over_caldav_to_join_its_room(): void
    {
        $uid = (string) $this->as('alice')->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Private',
            'body' => 'secret',
        ])->assertCreated()->json('id');

        $this->davPutJournal('bob', CalendarCollectionUris::NOTE_GENERAL, $uid)->assertStatus(409);

        $this->as('bob')->postJson(
            '/api/v1/rooms/'.RoomTestHelper::fileRoomId($uid).'/participants',
            ['name' => 'Bob'],
        )->assertForbidden();
    }

    public function test_another_user_cannot_reuse_a_note_uid_on_create_to_join_its_room(): void
    {
        // A create retry is matched on the client UID, so that UID must never
        // reach a note the caller cannot already read.
        $uid = (string) $this->as('alice')->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Private',
            'body' => 'secret',
        ])->assertCreated()->json('id');

        $this->as('bob')->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'uid' => $uid,
            'title' => 'Mine now',
            'body' => '',
        ])->assertStatus(409)->assertJsonPath('code', 'alreadyExists')->assertJsonMissing(['title' => 'Private']);

        $room = '/api/v1/rooms/'.RoomTestHelper::fileRoomId($uid).'/participants';
        $this->as('bob')->postJson($room, ['name' => 'Bob'])->assertForbidden();
        $this->as('alice')->postJson($room, ['name' => 'Alice'])->assertSuccessful();
        $this->as('alice')->getJson('/api/v1/notes/items/'.$uid)->assertOk()->assertJsonPath('title', 'Private');
    }

    public function test_a_caldav_client_still_writes_its_own_notes(): void
    {
        $uid = 'dav-client-note-1';

        $this->davPutJournal('bob', CalendarCollectionUris::NOTE_GENERAL, $uid)->assertCreated();
        $this->davPutJournal('bob', CalendarCollectionUris::NOTE_GENERAL, $uid)->assertNoContent();
    }

    private function davPutJournal(string $username, string $calendarUri, string $uid): TestResponse
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VJOURNAL\r\n"
            ."UID:{$uid}\r\nDTSTAMP:20261022T120000Z\r\nSUMMARY:copy\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n";

        return $this->call(
            'PUT',
            "/calendars/{$username}/{$calendarUri}/copy.ics",
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':secret'),
                'CONTENT_TYPE' => 'text/calendar',
                'CONTENT_LENGTH' => (string) strlen($ics),
            ],
            $ics,
        );
    }

    private function as(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
