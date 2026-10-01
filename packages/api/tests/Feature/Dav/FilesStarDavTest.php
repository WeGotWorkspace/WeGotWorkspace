<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\DriveStarredItem;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

final class FilesStarDavTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->seedWgwUser('bob', displayName: 'Bob');

        $installRoot = sys_get_temp_dir().'/wgw-star-dav-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/bob', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'bob');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($this->dataDir);
    }

    public function test_http_move_and_delete_keep_stars_off_the_old_path(): void
    {
        $auth = ['HTTP_AUTHORIZATION' => 'Basic '.base64_encode('bob:secret')];
        Storage::disk('wgw_files')->put('users/bob/folder/a.txt', 'nested bytes');
        Storage::disk('wgw_files')->put('users/bob/other.txt', 'stay');
        $this->insertStar('bob', '/users/bob/folder', 3);
        $this->insertStar('bob', '/users/bob/folder/a.txt', 4);
        $this->insertStar('carol', '/users/bob/folder/a.txt', 5);
        $this->insertStar('bob', '/users/bob/other.txt', 6);

        $this->call('MOVE', '/files/users/bob/folder', [], [], [], [
            ...$auth,
            'HTTP_DESTINATION' => '/files/users/bob/renamed',
        ])->assertSuccessful();

        $this->assertSame('nested bytes', Storage::disk('wgw_files')->get('users/bob/renamed/a.txt'));
        $this->assertFalse(Storage::disk('wgw_files')->directoryExists('users/bob/folder'));
        $this->assertEqualsCanonicalizing([
            '/users/bob/renamed',
            '/users/bob/renamed/a.txt',
            '/users/bob/other.txt',
        ], $this->storedPaths('bob'));
        $this->assertSame(['/users/bob/renamed/a.txt'], $this->storedPaths('carol'));
        $this->assertSame(4, $this->createdAt('bob', '/users/bob/renamed/a.txt'));

        $this->call('DELETE', '/files/users/bob/renamed', [], [], [], $auth)->assertSuccessful();

        $this->assertSame(['/users/bob/other.txt'], $this->storedPaths('bob'));
        $this->assertSame([], $this->storedPaths('carol'));
        $this->assertSame('stay', Storage::disk('wgw_files')->get('users/bob/other.txt'));

        Storage::disk('wgw_files')->put('users/bob/renamed/a.txt', 'replacement');
        $this->assertSame([], $this->storedPaths('bob', '/users/bob/renamed'));
        $this->assertSame([], $this->storedPaths('carol'));
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

    private function createdAt(string $username, string $path): int
    {
        $row = DriveStarredItem::query()
            ->where('username', $username)
            ->where('path', $path)
            ->first();
        $this->assertNotNull($row);

        return (int) $row->created_at;
    }
}
