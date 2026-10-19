<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Services\Calendars\Conversion\ICalendarJmapEventConverter;
use Tests\TestCase;

/**
 * #1393: only a WGW Meet link on the workspace origin is written as a video
 * conference (CONFERENCE + X-GOOGLE-CONFERENCE); any other link stays URL.
 */
final class CalendarMeetConferenceLinkTest extends TestCase
{
    private const ORIGIN = 'https://workspace.test';

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.url' => self::ORIGIN]);
    }

    public function test_room_link_is_written_as_wgw_meet_conference(): void
    {
        $out = $this->icsWithLink(self::ORIGIN.'/meet/guest?room=abcd-efgh-jklm');

        $this->assertMatchesRegularExpression('/URL(?:;[^:\r\n]*)?:https:\/\/workspace\.test\/meet\/guest\?room=abcd-efgh-jklm/', $out);
        $this->assertMatchesRegularExpression('/CONFERENCE;[^\r\n]*VALUE=URI[^\r\n]*:https:\/\/workspace\.test\/meet\/guest\?room=abcd-efgh-jklm/', $out);
        $this->assertStringContainsString('FEATURE=VIDEO', $out);
        $this->assertStringContainsString('WeGotWorkspace Meet', $out);
        $this->assertStringContainsString('X-GOOGLE-CONFERENCE:https://workspace.test/meet/guest?room=abcd-efgh-jklm', $out);
        $this->assertStringNotContainsString('X-MICROSOFT-SKYPETEAMSMEETINGURL', $out);
    }

    public function test_meetings_and_channel_links_are_wgw_meet_conferences(): void
    {
        $this->assertStringContainsString('WeGotWorkspace Meet', $this->icsWithLink(self::ORIGIN.'/meet/meetings/abcd-efgh-jklm'));
        $this->assertStringContainsString('WeGotWorkspace Meet', $this->icsWithLink(self::ORIGIN.'/meet/channels/chan-1'));
    }

    public function test_other_links_stay_url_only(): void
    {
        foreach ([
            'https://example.com/agenda',
            'https://zoom.us/j/1',
            'https://other.test/meet/guest?room=abcd-efgh-jklm',
            self::ORIGIN.'/docs/agenda',
            self::ORIGIN.'/meet/guest?room=team-sync-2026',
        ] as $href) {
            $out = $this->icsWithLink($href);

            $this->assertStringContainsString('URL;VALUE=URI:'.$href, $out, $href);
            $this->assertStringNotContainsString('CONFERENCE', $out, $href);
        }
    }

    private function icsWithLink(string $href): string
    {
        $ics = (new ICalendarJmapEventConverter)->icsFromEvent([
            '@type' => 'Event',
            'uid' => 'meet-conf-1',
            'title' => 'Standup',
            'start' => '2026-06-15T10:00:00Z',
            'end' => '2026-06-15T11:00:00Z',
            'calendarIds' => ['default' => true],
            'links' => ['link1' => ['@type' => 'Link', 'href' => $href]],
        ]);

        return str_replace("\r\n ", '', $ics);
    }
}
