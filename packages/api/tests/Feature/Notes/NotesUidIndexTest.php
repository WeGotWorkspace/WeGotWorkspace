<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use Illuminate\Support\Facades\Schema;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Note UIDs are looked up across all notebooks (create, move, room access).
 * The only other index with `uid` leads with `calendarid`, so without this
 * one a lookup by UID scans the table, and a locking read locks all of it.
 */
final class NotesUidIndexTest extends WgwDatabaseTestCase
{
    public function test_calendar_objects_are_indexed_by_uid_and_component_type(): void
    {
        $index = collect(Schema::connection('wgw')->getIndexes('calendarobjects'))
            ->firstWhere('name', 'calendarobjects_uid_componenttype');

        $this->assertNotNull($index, 'Missing index calendarobjects_uid_componenttype.');
        $this->assertSame(['uid', 'componenttype'], $index['columns']);
    }
}
