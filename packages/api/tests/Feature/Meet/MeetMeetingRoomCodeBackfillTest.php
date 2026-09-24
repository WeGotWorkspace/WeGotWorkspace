<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use App\Models\CalendarInstance;
use App\Models\ChatChannelMeta;
use App\Services\Calendars\CalendarMeetLinkHref;
use App\Services\Meet\MeetMeetingRoomCodeBackfill;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Old meetings are `chat-{slug}` with room_code null. Upgrade assigns a code
 * and leaves the collection id alone.
 */
final class MeetMeetingRoomCodeBackfillTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    public function test_slug_only_meetings_receive_a_room_code_and_keep_their_uri(): void
    {
        $slugId = (string) $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/chat/channels', [
                'name' => 'Standup',
                'kind' => 'channel',
            ])
            ->assertCreated()
            ->json('id');
        $this->assertSame('chat-standup', $slugId);

        $calendarId = (int) CalendarInstance::query()->where('uri', $slugId)->value('calendarid');
        ChatChannelMeta::query()->where('calendarid', $calendarId)->update([
            'kind' => ChatChannelMeta::KIND_MEETING,
            'room_code' => null,
        ]);

        $kept = (string) $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/chat/channels', [
                'name' => 'Weekly',
                'kind' => 'meeting',
                'guestRoomCode' => 'g744-8kfg-adjz',
            ])
            ->assertCreated()
            ->json('guestRoomCode');

        $plainId = (string) $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/chat/channels', [
                'name' => 'General',
                'kind' => 'channel',
            ])
            ->assertCreated()
            ->json('id');

        $migration = require base_path('database/migrations/wgw/2026_09_23_000420_wgw_backfill_meeting_room_codes.php');
        $migration->up();

        $meta = ChatChannelMeta::query()->where('calendarid', $calendarId)->first();
        $this->assertNotNull($meta);
        $this->assertSame(1, preg_match(CalendarMeetLinkHref::ROOM_CODE_PATTERN, (string) $meta->room_code));
        $this->assertSame($slugId, CalendarInstance::query()->where('calendarid', $calendarId)->value('uri'));
        $this->assertNotSame($slugId, 'chat-'.$meta->room_code);

        $this->assertSame($kept, ChatChannelMeta::query()->where('room_code', $kept)->value('room_code'));
        $plainCalendarId = (int) CalendarInstance::query()->where('uri', $plainId)->value('calendarid');
        $this->assertNull(ChatChannelMeta::query()->where('calendarid', $plainCalendarId)->value('room_code'));

        $code = (string) $meta->room_code;
        $this->flushHeaders()->postJson('/api/v1/rooms/'.$slugId.'/participants', [
            'peerId' => 'peer-guest',
            'name' => 'Visitor',
        ])->assertForbidden()->assertJsonPath('error', 'forbidden');
        $this->flushHeaders()->postJson('/api/v1/rooms/'.$code.'/participants', [
            'peerId' => 'peer-guest',
            'name' => 'Visitor',
        ])->assertForbidden()->assertJsonPath('error', 'knock_required');

        $again = app(MeetMeetingRoomCodeBackfill::class)->assignMissing();
        $this->assertSame(0, $again);
        $this->assertSame($code, ChatChannelMeta::query()->where('calendarid', $calendarId)->value('room_code'));
    }
}
