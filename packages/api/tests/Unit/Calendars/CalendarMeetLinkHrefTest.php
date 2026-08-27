<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarMeetLinkHref;
use Tests\TestCase;

final class CalendarMeetLinkHrefTest extends TestCase
{
    public function test_origin_equality_rejects_prefix_and_parse_failure(): void
    {
        $hrefs = new CalendarMeetLinkHref;
        config(['app.url' => 'https://workspace.test']);

        $this->assertSame(
            'abcd-efgh-ijkl',
            $hrefs->parseWgwRoom('https://workspace.test/meet/guest?room=abcd-efgh-ijkl'),
        );
        $this->assertSame(
            'abcd-efgh-ijkl',
            $hrefs->parseWgwRoom('https://workspace.test/meet/join?room=ABCD-EFGH-IJKL'),
        );
        $this->assertNull($hrefs->parseWgwRoom('https://evil.workspace.test/meet/guest?room=abcd-efgh-ijkl'));
        $this->assertNull($hrefs->parseWgwRoom('https://workspace.test.evil/meet/guest?room=abcd-efgh-ijkl'));
        $this->assertNull($hrefs->parseWgwRoom('https://workspace.test/meet/guest?room=partial'));
        $this->assertNull($hrefs->parseWgwRoom('https://zoom.example/j/123'));
        $this->assertNull($hrefs->parseWgwRoom('not a url'));
        $this->assertNull($hrefs->origin('://missing-scheme'));
    }
}
