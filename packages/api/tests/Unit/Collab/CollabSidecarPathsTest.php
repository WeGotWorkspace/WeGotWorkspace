<?php

declare(strict_types=1);

namespace Tests\Unit\Collab;

use App\Services\Collab\CollabSidecarPaths;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class CollabSidecarPathsTest extends TestCase
{
    /**
     * @return iterable<string, array{0: string, 1: bool}>
     */
    public static function sidecarNameProvider(): iterable
    {
        yield 'markdown sidecar' => ['.together.md.yjs', true];
        yield 'csv sidecar' => ['.data.csv.yjs', true];
        yield 'short sidecar' => ['.a.yjs', true];
        yield 'plain document' => ['together.md', false];
        yield 'visible yjs name' => ['notes.yjs', false];
        yield 'bare suffix' => ['.yjs', false];
        yield 'other hidden name' => ['.hidden', false];
    }

    #[DataProvider('sidecarNameProvider')]
    public function test_is_sidecar_name(string $name, bool $expected): void
    {
        $this->assertSame($expected, CollabSidecarPaths::isSidecarName($name));
    }

    /**
     * @return iterable<string, array{0: string, 1: bool}>
     */
    public static function davProtectedProvider(): iterable
    {
        yield 'user sidecar' => ['files/users/alice/.x.md.yjs', true];
        yield 'group nested sidecar' => ['files/groups/ops/sub/.x.md.yjs', true];
        yield 'user document' => ['files/users/alice/x.md', false];
        yield 'calendar path' => ['calendars/alice/.x.md.yjs', false];
        yield 'principal' => ['principals/alice', false];
    }

    #[DataProvider('davProtectedProvider')]
    public function test_dav_is_protected(string $davPath, bool $expected): void
    {
        $this->assertSame($expected, CollabSidecarPaths::davIsProtected($davPath));
    }
}
