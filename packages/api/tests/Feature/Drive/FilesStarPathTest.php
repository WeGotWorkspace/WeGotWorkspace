<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Dav\Server\DriveStarPathPlugin;
use App\Models\DriveStarredItem;
use App\Services\Drive\DriveService;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use Illuminate\Testing\TestResponse;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class FilesStarPathTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_rename_moves_the_star_and_leaves_file_bytes(): void
    {
        $token = $this->userBearerToken();
        $path = $this->seedPrivateFile('bob', 'report.txt', 'quarterly numbers');
        $this->star($token, $path);
        $createdAt = $this->starCreatedAt('bob', $path);

        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            $path,
            'report-renamed.txt',
        );

        $renamed = '/users/bob/report-renamed.txt';
        $this->assertSame([$renamed], $this->starredPaths($token));
        $this->assertSame([], $this->storedPaths('bob', $path));
        $this->assertSame($createdAt, $this->starCreatedAt('bob', $renamed));
        $this->assertSame('quarterly numbers', app(WgwStorage::class)->files()->get('users/bob/report-renamed.txt'));
        $this->assertFalse(app(WgwStorage::class)->files()->fileExists('users/bob/report.txt'));
    }

    public function test_folder_rename_and_move_carry_nested_stars_only(): void
    {
        $token = $this->userBearerToken();
        $folder = '/users/bob/Projects';
        $nested = $this->seedPrivateFile('bob', 'Projects/plan.txt', 'plan');
        $sibling = $this->seedPrivateFile('bob', 'report.txt', 'stay');
        $stringPrefix = $this->seedPrivateFile('bob', 'Projects-extra.txt', 'not nested');
        $this->star($token, $folder);
        $this->star($token, $nested);
        $this->star($token, $sibling);
        $this->star($token, $stringPrefix);

        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            $folder,
            'Archive',
        );

        $this->assertEqualsCanonicalizing([
            '/users/bob/Archive',
            '/users/bob/Archive/plan.txt',
            $sibling,
            $stringPrefix,
        ], $this->starredPaths($token));
        $this->assertSame('plan', app(WgwStorage::class)->files()->get('users/bob/Archive/plan.txt'));

        app(DriveService::class)->movePath(
            $this->drivePrincipal('bob'),
            '/users/bob/Archive/plan.txt',
            '/users/bob/plan.txt',
        );

        $this->assertEqualsCanonicalizing([
            '/users/bob/Archive',
            '/users/bob/plan.txt',
            $sibling,
            $stringPrefix,
        ], $this->starredPaths($token));
        $this->assertSame('plan', app(WgwStorage::class)->files()->get('users/bob/plan.txt'));
    }

    public function test_delete_drops_star_rows_so_a_new_item_at_that_path_is_not_starred(): void
    {
        $token = $this->userBearerToken();
        $path = $this->seedPrivateFile('bob', 'Projects/plan.txt', 'plan');
        $sibling = $this->seedPrivateFile('bob', 'other.txt', 'other');
        $this->star($token, '/users/bob/Projects');
        $this->star($token, $path);
        $this->star($token, $sibling);
        $this->insertStar('carol', $path, 50);

        app(DriveService::class)->deleteItems(
            $this->drivePrincipal('bob'),
            [['path' => '/users/bob/Projects']],
        );

        $this->assertSame([$sibling], $this->starredPaths($token));
        $this->assertSame([], $this->storedPaths('carol', $path));
        $this->assertSame([], $this->storedPaths('bob', '/users/bob/Projects'));

        $this->seedPrivateFile('bob', 'Projects/plan.txt', 'new plan');
        $this->assertSame([$sibling], $this->starredPaths($token));
        $this->assertSame([], $this->storedPaths('bob', $path));
    }

    public function test_rename_does_not_let_a_destination_row_attach_to_the_moved_item(): void
    {
        $token = $this->userBearerToken();
        $source = $this->seedPrivateFile('bob', 'report.txt', 'bytes');
        $this->star($token, $source);
        $sourceCreatedAt = $this->starCreatedAt('bob', $source);
        $this->insertStar('bob', '/users/bob/taken.txt', 1);

        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            $source,
            'taken.txt',
        );

        $this->assertSame(['/users/bob/taken.txt'], $this->starredPaths($token));
        $this->assertSame($sourceCreatedAt, $this->starCreatedAt('bob', '/users/bob/taken.txt'));
        $this->assertSame('bytes', app(WgwStorage::class)->files()->get('users/bob/taken.txt'));

        $plain = $this->seedPrivateFile('bob', 'plain.txt', 'plain');
        $this->insertStar('bob', '/users/bob/orphan.txt', 9);
        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            $plain,
            'orphan.txt',
        );

        $this->assertNotContains('/users/bob/orphan.txt', $this->starredPaths($token));
        $this->assertSame([], $this->storedPaths('bob', '/users/bob/orphan.txt'));
        $this->assertSame('plain', app(WgwStorage::class)->files()->get('users/bob/orphan.txt'));
    }

    public function test_other_users_star_follows_rename(): void
    {
        $token = $this->userBearerToken();
        $path = $this->seedPrivateFile('bob', 'shared-look.txt', 'body');
        $this->star($token, $path);
        $this->insertStar('carol', $path, 77);

        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            $path,
            'shared-look-renamed.txt',
        );

        $renamed = '/users/bob/shared-look-renamed.txt';
        $this->assertSame([$renamed], $this->storedPaths('bob'));
        $this->assertSame([$renamed], $this->storedPaths('carol'));
        $this->assertSame(77, $this->starCreatedAt('carol', $renamed));
    }

    public function test_filenode_rename_move_and_destroy_keep_stars_with_the_item(): void
    {
        $token = $this->userBearerToken();
        $this->seedPrivateFile('bob', 'A/doc.txt', 'doc bytes');
        app(WgwStorage::class)->files()->makeDirectory('users/bob/B');
        $nested = '/users/bob/A/doc.txt';
        $this->star($token, '/users/bob/A');
        $this->star($token, $nested);

        $nodes = $this->fileNodes();
        $fileId = $this->nodeIdByName($nodes, 'doc.txt');
        $dirId = $this->nodeIdByName($nodes, 'A');
        $targetId = $this->nodeIdByName($nodes, 'B');

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$fileId => ['name' => 'doc-renamed.txt']]], 'c0'],
        ])->assertOk();

        $this->assertEqualsCanonicalizing([
            '/users/bob/A',
            '/users/bob/A/doc-renamed.txt',
        ], $this->starredPaths($token));
        $this->assertSame('doc bytes', app(WgwStorage::class)->files()->get('users/bob/A/doc-renamed.txt'));

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$fileId => ['parentId' => $targetId]]], 'c1'],
        ])->assertOk();

        $this->assertEqualsCanonicalizing([
            '/users/bob/A',
            '/users/bob/B/doc-renamed.txt',
        ], $this->starredPaths($token));

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$dirId]], 'c2'],
        ])->assertOk();

        $this->assertSame(['/users/bob/B/doc-renamed.txt'], $this->starredPaths($token));

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$fileId]], 'c3'],
        ])->assertOk();

        $this->assertSame([], $this->starredPaths($token));
        $this->seedPrivateFile('bob', 'B/doc-renamed.txt', 'replacement');
        $this->assertSame([], $this->starredPaths($token));
    }

    public function test_webdav_move_and_delete_rewrite_star_rows(): void
    {
        $plugin = app(DriveStarPathPlugin::class);
        $this->insertStar('bob', '/users/bob/folder', 3);
        $this->insertStar('bob', '/users/bob/folder/a.txt', 4);
        $this->insertStar('carol', '/users/bob/folder/a.txt', 5);
        $this->insertStar('bob', '/users/bob/other.txt', 6);
        $this->insertStar('bob', '/users/bob/folder-extra.txt', 7);

        $plugin->afterMove(
            new SabreRequest('MOVE', '/files/users/bob/folder', ['Destination' => '/files/users/bob/renamed']),
            new SabreResponse(201),
        );

        $this->assertEqualsCanonicalizing([
            '/users/bob/renamed',
            '/users/bob/renamed/a.txt',
        ], $this->storedPaths('bob', '/users/bob/renamed'));
        $this->assertSame(['/users/bob/renamed/a.txt'], $this->storedPaths('carol'));
        $this->assertSame(['/users/bob/other.txt'], $this->storedPaths('bob', '/users/bob/other.txt'));
        $this->assertSame(['/users/bob/folder-extra.txt'], $this->storedPaths('bob', '/users/bob/folder-extra.txt'));
        $this->assertSame(5, $this->starCreatedAt('carol', '/users/bob/renamed/a.txt'));

        $plugin->afterMove(
            new SabreRequest('MOVE', '/calendars/users/bob/home', ['Destination' => '/calendars/users/bob/away']),
            new SabreResponse(201),
        );
        $this->assertSame(['/users/bob/other.txt'], $this->storedPaths('bob', '/users/bob/other.txt'));

        $plugin->afterDelete(
            new SabreRequest('DELETE', '/files/users/bob/renamed'),
            new SabreResponse(204),
        );
        $this->assertSame(['/users/bob/folder-extra.txt', '/users/bob/other.txt'], $this->storedPaths('bob'));
        $this->assertSame([], $this->storedPaths('carol'));

        $plugin->afterDelete(
            new SabreRequest('DELETE', '/files/users/bob/other.txt'),
            new SabreResponse(500),
        );
        $this->assertSame(['/users/bob/other.txt'], $this->storedPaths('bob', '/users/bob/other.txt'));
    }

    private function star(string $token, string $path): void
    {
        $this->withBearer($token)->postJson('/api/v1/files/star?path='.$path)
            ->assertOk();
    }

    /**
     * @return list<string>
     */
    private function starredPaths(string $token): array
    {
        $paths = $this->withBearer($token)->getJson('/api/v1/files/starred')
            ->assertOk()
            ->json('data.paths');
        $this->assertIsArray($paths);

        /** @var list<string> $paths */
        return $paths;
    }

    /**
     * @return list<string>
     */
    private function storedPaths(string $username, ?string $prefix = null): array
    {
        $query = DriveStarredItem::query()->where('username', $username)->orderBy('path');
        if ($prefix !== null) {
            $query->where(function ($builder) use ($prefix): void {
                $builder->where('path', $prefix)->orWhere('path', 'like', $prefix.'/%');
            });
        }

        /** @var list<string> $paths */
        $paths = $query->pluck('path')->all();

        return $paths;
    }

    private function starCreatedAt(string $username, string $path): int
    {
        $row = DriveStarredItem::query()
            ->where('username', $username)
            ->where('path', $path)
            ->first();
        $this->assertNotNull($row);

        return (int) $row->created_at;
    }

    private function insertStar(string $username, string $path, int $createdAt): void
    {
        DriveStarredItem::query()->insert([
            'username' => $username,
            'path' => $path,
            'created_at' => $createdAt,
        ]);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => $methodCalls,
        ]);
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function fileNodes(): array
    {
        $list = $this->jmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $this->assertIsArray($list);

        $byId = [];
        foreach ($list as $node) {
            $this->assertIsArray($node);
            $byId[$node['id']] = $node;
        }

        return $byId;
    }

    /**
     * @param  array<string, array<string, mixed>>  $nodes
     */
    private function nodeIdByName(array $nodes, string $name): string
    {
        foreach ($nodes as $node) {
            if ($node['name'] === $name) {
                return (string) $node['id'];
            }
        }

        $this->fail('No node named '.$name);
    }
}
