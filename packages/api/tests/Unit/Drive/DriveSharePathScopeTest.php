<?php

declare(strict_types=1);

namespace Tests\Unit\Drive;

use App\Services\Drive\DriveSharePathScope;
use App\Storage\StoragePaths;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class DriveSharePathScopeTest extends TestCase
{
    /**
     * @return iterable<string, array{0: string, 1: string, 2: bool}>
     */
    public static function scopeProvider(): iterable
    {
        yield 'same root' => ['/users/bob/docs', '/users/bob/docs', true];
        yield 'descendant path' => ['/users/bob/docs', '/users/bob/docs/plan.md', true];
        yield 'sibling denied' => ['/users/bob/docs', '/users/bob/private.md', false];
        yield 'parent denied' => ['/users/bob/docs', '/users/bob', false];
        yield 'normalization still in scope' => ['/users/bob/docs', '/users/bob//docs/./plan.md', true];
        yield 'dotdot escape denied' => ['/users/bob/docs', '/users/bob/docs/../private.md', false];
    }

    #[DataProvider('scopeProvider')]
    public function test_scope_check(string $root, string $requested, bool $expected): void
    {
        $scope = new DriveSharePathScope(new StoragePaths);

        $this->assertSame($expected, $scope->isWithin($root, $requested));
    }

    /**
     * @return iterable<string, array{0: string, 1: bool}>
     */
    public static function topLevelDriveProvider(): iterable
    {
        yield 'user home' => ['/users/bob', true];
        yield 'group drive' => ['/groups/team', true];
        yield 'users root' => ['/users', false];
        yield 'groups root' => ['/groups', false];
        yield 'nested user path' => ['/users/bob/docs', false];
        yield 'nested group path' => ['/groups/team/plan.md', false];
        yield 'trailing slash normalized' => ['/users/bob/', true];
    }

    #[DataProvider('topLevelDriveProvider')]
    public function test_is_top_level_drive(string $path, bool $expected): void
    {
        $scope = new DriveSharePathScope(new StoragePaths);

        $this->assertSame($expected, $scope->isTopLevelDrive($path));
    }
}
