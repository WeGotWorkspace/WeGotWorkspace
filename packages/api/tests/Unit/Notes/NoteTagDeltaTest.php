<?php

declare(strict_types=1);

namespace Tests\Unit\Notes;

use App\Services\Notes\NoteTag;
use PHPUnit\Framework\TestCase;

final class NoteTagDeltaTest extends TestCase
{
    public function test_add_appends_after_the_stored_set(): void
    {
        $this->assertSame(['a', 'b'], NoteTag::applyDelta(['a'], ['b'], []));
    }

    public function test_remove_drops_a_stored_tag_and_keeps_order(): void
    {
        $this->assertSame(['b'], NoteTag::applyDelta(['a', 'b'], [], ['a']));
    }

    public function test_remove_runs_before_add_so_a_tag_in_both_lists_stays(): void
    {
        $this->assertSame(['keep', 'a'], NoteTag::applyDelta(['keep', 'a'], ['a'], ['a']));
    }

    public function test_unknown_remove_and_duplicate_add_leave_one_copy(): void
    {
        $this->assertSame(['a'], NoteTag::applyDelta(['a'], [], ['missing']));
        $this->assertSame(['a', 'b'], NoteTag::applyDelta(['a'], ['b', 'B', 'b'], []));
        $this->assertSame(['a'], NoteTag::applyDelta(['a'], ['A'], []));
    }
}
