<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarCollectionUris;
use PHPUnit\Framework\TestCase;

final class CalendarCollectionUrisTest extends TestCase
{
    public function test_reserved_note_view_slugs_match_sidebar_views(): void
    {
        $slugs = CalendarCollectionUris::reservedNoteViewSlugs();
        foreach (['all', 'starred', 'archive', 'archived', 'inbox', 'shared-with-me', 'tags', 'notebooks'] as $slug) {
            $this->assertContains($slug, $slugs);
        }
        $this->assertContains('starred', CalendarCollectionUris::reservedNoteUriSlugs());
        $this->assertContains(CalendarCollectionUris::SCHEDULE_INBOX, CalendarCollectionUris::reservedNoteUriSlugs());
    }
}
