<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;

/**
 * Drive files, node ids, shares and saved zips for the folder and selection
 * zip tests (#1621, #1905). Bob owns the drive; Carol is the grantee.
 */
trait FolderZipTicketHelpers
{
    private string $zipPath = '';

    /**
     * @param  array{url: string}  $issued
     */
    protected function path(array $issued): string
    {
        return (string) parse_url($issued['url'], PHP_URL_PATH);
    }

    protected function save(string $bytes): string
    {
        $this->zipPath = (string) tempnam(sys_get_temp_dir(), 'wgw-folder-zip-');
        file_put_contents($this->zipPath, $bytes);

        return $bytes;
    }

    protected function share(string $token, string $path): string
    {
        $this->flushHeaders();

        return (string) $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk()->json('data.id');
    }

    /** Indexes every ancestor of `$key` and returns its node id. */
    protected function nodeId(string $key): string
    {
        app(FileNodeAccountSupport::class)->ensureAccountIndexed('bob');
        $parts = explode('/', $key);
        for ($i = 2; $i < count($parts); $i++) {
            $this->reconcile(implode('/', array_slice($parts, 0, $i)));
        }
        $node = app(FileNodeIndexService::class)->liveByKey($key);
        $this->assertNotNull($node, 'No index row for '.$key);

        return (string) $node->node_id;
    }

    protected function reconcile(string $dirKey): void
    {
        app(FileNodeIndexService::class)->reconcileDirectory($dirKey);
    }

    protected function reconcileTree(string $dirKey): void
    {
        $this->reconcile($dirKey);
        foreach ($this->disk()->directories($dirKey) as $child) {
            $this->reconcileTree($child);
        }
    }

    protected function writeDriveFile(string $key, string $content): void
    {
        $this->disk()->put($key, $content);
    }

    protected function disk(): Filesystem
    {
        return app(WgwStorage::class)->files();
    }
}
