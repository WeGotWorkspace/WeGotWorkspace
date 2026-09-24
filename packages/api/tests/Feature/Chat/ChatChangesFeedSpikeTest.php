<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Services\Chat\ChatChangesFeed;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chunk B changes-feed spike (Epic #701): the whole chat sync story leans on
 * writes to `chat-` VJOURNAL collections surfacing through the Sabre calendar
 * backend's getChangesForCalendar — the exact path NoteRepository::changes
 * uses. Notes hardcodes `hasMoreChanges: false`; chat volume cannot, so this
 * spike also pins the paging semantics of the backend's $limit parameter:
 * it fetches limit+1 changelog rows, flags truncation via `result_truncated`,
 * and returns a syncToken that resumes exactly after the last processed row.
 */
final class ChatChangesFeedSpikeTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    public function test_chat_collection_write_surfaces_via_changes_feed(): void
    {
        [$instance, $backend] = $this->createChatCollection('chat-spike');
        $baseline = $this->currentSyncToken($instance);

        $backend->createCalendarObject($this->backendId($instance), 'MSG0001.ics', $this->messageIcs('MSG0001'));

        $result = app(ChatChangesFeed::class)->changes($instance->fresh('calendar'), (string) $baseline);

        $this->assertSame(['MSG0001'], $result['created']);
        $this->assertSame([], $result['updated']);
        $this->assertSame([], $result['destroyed']);
        $this->assertFalse($result['hasMoreChanges']);
        $this->assertGreaterThan($baseline, (int) $result['newState']);
    }

    public function test_update_and_delete_surface_as_updated_and_destroyed(): void
    {
        [$instance, $backend] = $this->createChatCollection('chat-mutations');
        $backend->createCalendarObject($this->backendId($instance), 'MSGA.ics', $this->messageIcs('MSGA'));
        $backend->createCalendarObject($this->backendId($instance), 'MSGB.ics', $this->messageIcs('MSGB'));
        $since = (string) $this->currentSyncToken($instance);

        $backend->updateCalendarObject($this->backendId($instance), 'MSGA.ics', $this->messageIcs('MSGA', 'edited'));
        $backend->deleteCalendarObject($this->backendId($instance), 'MSGB.ics');

        $result = app(ChatChangesFeed::class)->changes($instance->fresh('calendar'), $since);

        $this->assertSame(['MSGA'], $result['updated']);
        $this->assertSame(['MSGB'], $result['destroyed']);
        $this->assertFalse($result['hasMoreChanges']);
    }

    public function test_paging_at_volume_reports_honest_has_more_changes_and_resumes(): void
    {
        [$instance, $backend] = $this->createChatCollection('chat-volume');
        $since = (string) $this->currentSyncToken($instance);

        $expected = [];
        for ($i = 1; $i <= 25; $i++) {
            $uid = sprintf('MSG%04d', $i);
            $backend->createCalendarObject($this->backendId($instance), $uid.'.ics', $this->messageIcs($uid));
            $expected[] = $uid;
        }

        $feed = app(ChatChangesFeed::class);
        $collected = [];
        $rounds = 0;
        $cursor = $since;
        do {
            $page = $feed->changes($instance->fresh('calendar'), $cursor, limit: 10);
            $collected = array_merge($collected, $page['created']);
            // The resumable cursor is the returned newState, never a guess.
            $cursor = $page['newState'];
            $rounds++;
            $this->assertLessThanOrEqual(10, count($page['created']));
        } while ($page['hasMoreChanges'] && $rounds < 10);

        $this->assertSame(3, $rounds, 'Expected 25 changes in pages of 10 to take exactly 3 rounds.');
        $this->assertSame($expected, $collected, 'Paging must neither drop nor duplicate changes.');
        $this->assertFalse($page['hasMoreChanges']);

        // A drained cursor stays quiet until the next write.
        $idle = $feed->changes($instance->fresh('calendar'), $cursor, limit: 10);
        $this->assertSame([], $idle['created']);
        $this->assertFalse($idle['hasMoreChanges']);
    }

    public function test_initial_sync_lists_all_objects_without_paging(): void
    {
        [$instance, $backend] = $this->createChatCollection('chat-initial');
        $backend->createCalendarObject($this->backendId($instance), 'MSGX.ics', $this->messageIcs('MSGX'));
        $backend->createCalendarObject($this->backendId($instance), 'MSGY.ics', $this->messageIcs('MSGY'));

        $result = app(ChatChangesFeed::class)->changes($instance->fresh('calendar'), null, limit: 1);

        // Sabre's initial-sync branch ignores $limit and returns every object;
        // hasMoreChanges=false is honest here, not a Notes-style shortcut.
        $this->assertEqualsCanonicalizing(['MSGX', 'MSGY'], $result['created']);
        $this->assertFalse($result['hasMoreChanges']);
        $this->assertSame('0', $result['oldState']);
    }

    public function test_invalid_since_raises_cannot_calculate_changes(): void
    {
        [$instance] = $this->createChatCollection('chat-badsince');

        $this->expectException(ApiHttpException::class);
        $this->expectExceptionMessage('Sync state is invalid or expired.');
        app(ChatChangesFeed::class)->changes($instance, 'not-a-token');
    }

    /**
     * @return array{0: CalendarInstance, 1: CalPDO}
     */
    private function createChatCollection(string $uri): array
    {
        $backend = new CalPDO(DB::connection('wgw')->getPdo());
        $backend->createCalendar('principals/alice', $uri, [
            '{DAV:}displayname' => $uri,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VJOURNAL']),
        ]);

        $instance = CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', 'principals/alice')
            ->where('uri', $uri)
            ->firstOrFail();

        return [$instance, $backend];
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function backendId(CalendarInstance $instance): array
    {
        return [(int) $instance->calendarid, (int) $instance->id];
    }

    private function currentSyncToken(CalendarInstance $instance): int
    {
        return (int) ($instance->fresh('calendar')->calendar?->synctoken ?? 1);
    }

    private function messageIcs(string $uid, string $body = 'hello'): string
    {
        return implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VJOURNAL',
            'UID:'.$uid,
            'DTSTAMP:20260904T120000Z',
            'DESCRIPTION:'.$body,
            'X-WGW-AUTHOR:alice',
            'END:VJOURNAL',
            'END:VCALENDAR',
            '',
        ]);
    }
}
