<?php

declare(strict_types=1);

namespace Tests\Unit\Jmap;

use App\Exceptions\ApiHttpException;
use App\Services\Jmap\JmapPatchObject;
use PHPUnit\Framework\TestCase;

final class JmapPatchObjectTest extends TestCase
{
    public function test_top_level_map_replaces_the_property(): void
    {
        $out = JmapPatchObject::apply(['alerts' => ['a' => 1, 'b' => 2]], ['alerts' => ['a' => 1]]);

        $this->assertSame(['alerts' => ['a' => 1]], $out);
    }

    public function test_map_with_null_entries_is_a_partial_update(): void
    {
        $out = JmapPatchObject::apply(['alerts' => ['a' => 1, 'b' => 2]], ['alerts' => ['b' => null, 'c' => 3]]);

        $this->assertSame(['alerts' => ['a' => 1, 'c' => 3]], $out);
    }

    public function test_pointer_sets_and_removes_nested_values(): void
    {
        $out = JmapPatchObject::apply(
            ['participants' => ['p1' => ['name' => 'A', 'roles' => ['attendee' => true]], 'p~/x' => ['name' => 'B']]],
            ['participants/p1/name' => 'Ann', 'participants/p1/roles' => null, 'participants/p~0~1x' => null],
        );

        $this->assertSame(['participants' => ['p1' => ['name' => 'Ann']]], $out);
    }

    public function test_null_removes_a_top_level_property_and_id_is_ignored(): void
    {
        $out = JmapPatchObject::apply(['id' => 'e1', 'description' => 'x', 'title' => 't'], ['description' => null, 'id' => 'other']);

        $this->assertSame(['id' => 'e1', 'title' => 't'], $out);
    }

    public function test_pointer_through_a_missing_object_is_invalid_patch(): void
    {
        $this->expectException(ApiHttpException::class);

        JmapPatchObject::apply(['participants' => []], ['participants/p9/name' => 'X']);
    }
}
