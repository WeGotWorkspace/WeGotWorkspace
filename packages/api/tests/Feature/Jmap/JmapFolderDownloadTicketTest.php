<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\DriveFolderDownloadTicket;
use App\Models\User;
use App\Services\Auth\JwtTokenService;
use App\Services\Auth\RefreshCookie;
use App\Services\Drive\FolderZip\FolderZipReadCheck;
use App\Services\Drive\FolderZip\FolderZipStreamer;
use App\Services\Jmap\Download\DownloadTicketService;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeMapper;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Carbon;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\ZipArchiveInspector;

/**
 * Folder zip downloads (#1621): a ticket bound to a folder node, and a
 * stored zip streamed from the folder with what the caller sees in Drive.
 */
final class JmapFolderDownloadTicketTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private string $zipPath = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config([
            'wgw.jmap.download_ticket_idle_minutes' => 30,
            'wgw.jmap.download_ticket_lifetime_hours' => 24,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        if ($this->zipPath !== '' && is_file($this->zipPath)) {
            unlink($this->zipPath);
        }
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_the_zip_holds_the_folder_tree_with_empty_folders_and_utf8_names(): void
    {
        $this->writeDriveFile('users/bob/Project/readme.txt', 'read me');
        $this->writeDriveFile('users/bob/Project/Design/Überblick — ñ.md', '# Überblick');
        $this->writeDriveFile('users/bob/Project/Design/deep/er/leaf.txt', 'leaf');
        $this->disk()->makeDirectory('users/bob/Project/Empty');
        touch($this->disk()->path('users/bob/Project/readme.txt'), 1_600_000_000);

        $token = $this->userBearerToken();
        $issued = $this->issue($token, $this->nodeId('users/bob/Project'));
        $this->assertSame('Project.zip', $issued['name']);
        $this->assertStringEndsWith('/Project.zip', $issued['url']);

        $this->flushHeaders();
        $response = $this->get($this->path($issued))->assertOk();
        $this->assertSame('application/zip', $response->headers->get('Content-Type'));
        $this->assertSame('attachment; filename="Project.zip"; filename*=UTF-8\'\'Project.zip', $response->headers->get('Content-Disposition'));
        $this->assertSame('none', $response->headers->get('Accept-Ranges'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $bytes = $this->save($response->streamedContent());

        $entries = ZipArchiveInspector::contents($this->zipPath);
        ksort($entries);
        $this->assertSame([
            'Project/' => null,
            'Project/Design/' => null,
            'Project/Design/deep/' => null,
            'Project/Design/deep/er/' => null,
            'Project/Design/deep/er/leaf.txt' => 'leaf',
            'Project/Design/Überblick — ñ.md' => '# Überblick',
            'Project/Empty/' => null,
            'Project/readme.txt' => 'read me',
        ], $entries);

        $records = ZipArchiveInspector::centralRecords($bytes);
        foreach ($records as $record) {
            $this->assertSame(0x0800, $record['flags'] & 0x0800, $record['name'].' has the UTF-8 flag');
            if ($record['name'] === 'Project/readme.txt') {
                $this->assertSame(1_600_000_000, $record['mtime']);
            }
        }
    }

    public function test_a_non_ascii_folder_name_downloads_under_its_own_name(): void
    {
        $this->writeDriveFile('users/bob/École ñ/a.txt', 'a');
        $issued = $this->issue($this->userBearerToken(), $this->nodeId('users/bob/École ñ'));
        $this->assertSame('École ñ.zip', $issued['name']);

        $this->flushHeaders();
        $response = $this->get($this->path($issued))->assertOk();
        $this->assertSame(
            'attachment; filename="_cole _.zip"; filename*=UTF-8\'\''.rawurlencode('École ñ.zip'),
            $response->headers->get('Content-Disposition'),
        );
        $this->save($response->streamedContent());
        $this->assertSame(['École ñ/' => null, 'École ñ/a.txt' => 'a'], ZipArchiveInspector::contents($this->zipPath));
    }

    public function test_hidden_names_trash_notes_and_sidecars_are_left_out(): void
    {
        $this->writeDriveFile('users/bob/Project/plan.md', 'plan');
        $this->writeDriveFile('users/bob/Project/.plan.md.yjs', 'yjs state');
        $this->writeDriveFile('users/bob/Project/.hidden', 'hidden');
        $this->writeDriveFile('users/bob/Project/.Trash/old.txt', 'trashed');
        $this->writeDriveFile('users/bob/Project/.attachments/doc/image.png', 'png');
        $this->writeDriveFile('users/bob/Project/.notes/n.md', 'note');
        $this->writeDriveFile('users/bob/Project/Sub/.secret/x.txt', 'x');
        $this->writeDriveFile('users/bob/Project/Sub/kept.txt', 'kept');

        $this->assertSame([
            'Project/' => null,
            'Project/Sub/' => null,
            'Project/Sub/kept.txt' => 'kept',
            'Project/plan.md' => 'plan',
        ], $this->download($this->userBearerToken(), 'users/bob/Project'));
    }

    public function test_a_file_removed_from_drive_is_left_out(): void
    {
        $this->writeDriveFile('users/bob/Project/keep.txt', 'keep');
        $this->writeDriveFile('users/bob/Project/gone.txt', 'gone');
        $token = $this->userBearerToken();
        $nodeId = $this->nodeId('users/bob/Project');
        $this->reconcile('users/bob/Project');
        $this->disk()->delete('users/bob/Project/gone.txt');

        $this->assertSame(['Project/' => null, 'Project/keep.txt' => 'keep'], $this->downloadNode($token, $nodeId));
    }

    public function test_a_folder_in_trash_or_a_file_cannot_get_a_folder_ticket(): void
    {
        $this->writeDriveFile('users/bob/.Trash/Old/a.txt', 'a');
        $this->writeDriveFile('users/bob/file.txt', 'f');
        $token = $this->userBearerToken();

        $this->flushHeaders();
        $this->withBearer($token)->postJson('/api/v1/jmap/folder-download-tickets/bob', ['nodeId' => $this->nodeId('users/bob/.Trash/Old')])->assertNotFound();
        $this->flushHeaders();
        $this->withBearer($token)->postJson('/api/v1/jmap/folder-download-tickets/bob', ['nodeId' => $this->nodeId('users/bob/file.txt')])->assertNotFound();
        $this->flushHeaders();
        $this->withBearer($token)->postJson('/api/v1/jmap/folder-download-tickets/bob', ['nodeId' => 'fn-'.str_repeat('0', 32)])->assertNotFound();
        foreach (['', '../users', 'fn-XYZ', str_repeat('a', 300)] as $bad) {
            $this->flushHeaders();
            $this->withBearer($token)->postJson('/api/v1/jmap/folder-download-tickets/bob', ['nodeId' => $bad])->assertStatus(400);
        }
    }

    public function test_an_unreadable_subfolder_is_left_out_with_its_subtree(): void
    {
        $this->writeDriveFile('users/bob/Project/open.txt', 'open');
        $this->writeDriveFile('users/bob/Project/Secret/plans.txt', 'secret');
        $this->writeDriveFile('users/bob/Project/Secret/Deeper/more.txt', 'more');
        $this->app->instance(FolderZipReadCheck::class, new class(app(FileNodeMapper::class)) extends FolderZipReadCheck
        {
            public function mayRead(string $key, array $principal): bool
            {
                return ! str_starts_with($key, 'users/bob/Project/Secret') && parent::mayRead($key, $principal);
            }
        });

        $this->assertSame(
            ['Project/' => null, 'Project/open.txt' => 'open'],
            $this->download($this->userBearerToken(), 'users/bob/Project'),
        );
    }

    public function test_a_shared_folder_downloads_for_the_grantee_until_the_share_is_withdrawn(): void
    {
        $this->writeDriveFile('users/bob/Shared/a.txt', 'shared a');
        $this->writeDriveFile('users/bob/Shared/Inner/b.txt', 'shared b');
        $this->writeDriveFile('users/bob/Private/p.txt', 'private');
        $bob = $this->userBearerToken();
        $shareId = $this->share($bob, '/users/bob/Shared');
        $carol = $this->carolBearerToken();

        // Carol cannot get a ticket for a folder she cannot read, nor for Bob's account.
        $this->flushHeaders();
        $this->withBearer($carol)->postJson('/api/v1/jmap/folder-download-tickets/carol', ['nodeId' => $this->nodeId('users/bob/Private')])->assertNotFound();
        $this->flushHeaders();
        $this->withBearer($carol)->postJson('/api/v1/jmap/folder-download-tickets/bob', ['nodeId' => $this->nodeId('users/bob/Shared')])->assertNotFound();

        $issued = $this->issue($carol, $this->nodeId('users/bob/Shared'), 'carol');
        $this->flushHeaders();
        $this->save($this->get($this->path($issued))->assertOk()->streamedContent());
        $entries = ZipArchiveInspector::contents($this->zipPath);
        ksort($entries);
        $this->assertSame([
            'Shared/' => null,
            'Shared/Inner/' => null,
            'Shared/Inner/b.txt' => 'shared b',
            'Shared/a.txt' => 'shared a',
        ], $entries);

        $this->flushHeaders();
        $this->withBearer($bob)->deleteJson('/api/v1/files/shares/'.$shareId)->assertOk();
        $this->flushHeaders();
        $this->get($this->path($issued))->assertNotFound();
    }

    public function test_the_secret_is_stored_hashed_and_expiry_slides_until_idle(): void
    {
        Carbon::setTestNow('2026-11-03 10:00:00');
        $this->writeDriveFile('users/bob/Project/a.txt', 'a');
        $path = $this->path($this->issue($this->userBearerToken(), $this->nodeId('users/bob/Project')));
        $secret = explode('/', $path)[5];
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $secret);
        $this->assertSame(0, DriveFolderDownloadTicket::query()->where('secret_hash', $secret)->count());
        $this->assertSame(1, DriveFolderDownloadTicket::query()->where('secret_hash', DownloadTicketService::hashSecret($secret))->count());
        $this->flushHeaders();
        $this->withHeader('Authorization', 'Bearer '.$secret)->getJson('/api/v1/jmap/session')->assertUnauthorized();
        $this->flushHeaders();
        // A folder secret is not a file ticket.
        $this->get('/api/v1/jmap/download-ticket/'.$secret.'/a.txt')->assertNotFound();

        Carbon::setTestNow('2026-11-03 10:20:00');
        $this->get($path)->assertOk();
        Carbon::setTestNow('2026-11-03 10:45:00');
        $this->get($path)->assertOk();
        Carbon::setTestNow('2026-11-03 11:16:00');
        $this->get($path)->assertNotFound();
        $this->assertSame(0, DriveFolderDownloadTicket::query()->count());
    }

    public function test_the_absolute_lifetime_caps_the_sliding_expiry(): void
    {
        config(['wgw.jmap.download_ticket_lifetime_hours' => 1]);
        Carbon::setTestNow('2026-11-03 10:00:00');
        $this->writeDriveFile('users/bob/Project/a.txt', 'a');
        $path = $this->path($this->issue($this->userBearerToken(), $this->nodeId('users/bob/Project')));
        $this->flushHeaders();

        foreach (['10:20:00', '10:40:00', '10:59:00'] as $time) {
            Carbon::setTestNow('2026-11-03 '.$time);
            $this->get($path)->assertOk();
        }
        Carbon::setTestNow('2026-11-03 11:01:00');
        $this->get($path)->assertNotFound();
    }

    public function test_signing_out_ends_that_sessions_folder_tickets_only(): void
    {
        $this->writeDriveFile('users/bob/Project/a.txt', 'a');
        $first = $this->login('bob');
        $second = $this->login('bob');
        $nodeId = $this->nodeId('users/bob/Project');
        $pathOne = $this->path($this->issue($first['access'], $nodeId));
        $pathTwo = $this->path($this->issue($second['access'], $nodeId));

        $this->flushHeaders();
        $this->withBearer($first['access'])
            ->withUnencryptedCookie(RefreshCookie::NAME, $first['refresh'])
            ->withCredentials()
            ->postJson('/api/v1/auth/revoke')
            ->assertOk();

        $this->flushHeaders();
        $this->get($pathOne)->assertNotFound();
        $this->get($pathTwo)->assertOk();
    }

    public function test_a_disabled_account_and_a_token_without_a_session_are_refused(): void
    {
        $this->writeDriveFile('users/bob/Project/a.txt', 'a');
        $token = $this->userBearerToken();
        $nodeId = $this->nodeId('users/bob/Project');
        $path = $this->path($this->issue($token, $nodeId));

        $legacy = app(JwtTokenService::class)->issue([
            'sub' => 'bob',
            'role' => 'user',
            'exp' => time() + 600,
            'uid' => (int) User::query()->where('username', 'bob')->value('id'),
        ]);
        $this->flushHeaders();
        $this->withBearer($legacy)->postJson('/api/v1/jmap/folder-download-tickets/bob', ['nodeId' => $nodeId])
            ->assertForbidden()->assertJsonPath('code', 'session_required');

        User::query()->where('username', 'bob')->update(['enabled' => false]);
        $this->flushHeaders();
        $this->get($path)->assertNotFound();
    }

    public function test_a_large_folder_streams_with_bounded_memory(): void
    {
        $chunk = random_bytes(1024 * 1024);
        $big = $this->disk()->path('users/bob/Big/video.bin');
        @mkdir(dirname($big), 0777, true);
        $out = fopen($big, 'wb');
        $this->assertIsResource($out);
        for ($i = 0; $i < 48; $i++) {
            fwrite($out, $chunk);
        }
        fclose($out);
        for ($i = 0; $i < 150; $i++) {
            $this->writeDriveFile('users/bob/Big/part-'.intdiv($i, 50).'/file-'.$i.'.txt', str_repeat((string) $i, 2000));
        }
        $folder = app(FileNodeIndexService::class)->liveByNodeId($this->nodeId('users/bob/Big'));
        $this->assertNotNull($folder);
        $this->reconcileTree('users/bob/Big');

        $hash = hash_init('sha256');
        $written = 0;
        $sink = static function (string $bytes) use ($hash, &$written): void {
            hash_update($hash, $bytes);
            $written += strlen($bytes);
        };
        $before = memory_get_usage();
        memory_reset_peak_usage();
        app(FolderZipStreamer::class)->stream($folder, $this->drivePrincipal('bob'), $sink);
        $peak = memory_get_peak_usage() - $before;

        $this->assertGreaterThan(48 * 1024 * 1024, $written);
        // Two 1 MiB chunks in flight plus the walk; the 48 MiB file never is.
        $this->assertLessThan(8 * 1024 * 1024, $peak, 'peak memory above the baseline: '.$peak);
    }

    public function test_files_that_change_or_disappear_mid_zip_keep_the_zip_valid(): void
    {
        // Indexed one after the other, so the walk (by index row) reads grows.txt first.
        $this->writeDriveFile('users/bob/Live/grows.txt', 'start-');
        $folder = app(FileNodeIndexService::class)->liveByNodeId($this->nodeId('users/bob/Live'));
        $this->assertNotNull($folder);
        $this->reconcile('users/bob/Live');
        $this->writeDriveFile('users/bob/Live/vanishes.txt', 'soon gone');
        $this->reconcile('users/bob/Live');

        $disk = $this->disk();
        $out = '';
        $grown = false;
        $sink = static function (string $bytes) use (&$out, &$grown, $disk): void {
            $out .= $bytes;
            // The first content chunk of grows.txt: append to it and delete the other file.
            if (! $grown && $bytes === 'star') {
                $grown = true;
                file_put_contents($disk->path('users/bob/Live/grows.txt'), 'MORE', FILE_APPEND);
                $disk->delete('users/bob/Live/vanishes.txt');
            }
        };
        $streamer = $this->app->make(FolderZipStreamer::class, ['chunkBytes' => 4]);
        $streamer->stream($folder, $this->drivePrincipal('bob'), $sink);
        $this->save($out);

        $entries = ZipArchiveInspector::contents($this->zipPath);
        $this->assertTrue($grown, 'grows.txt was read before vanishes.txt');
        $this->assertSame(['Live/', 'Live/grows.txt'], array_keys($entries));
        $this->assertSame('start-MORE', $entries['Live/grows.txt']);
    }

    /**
     * @return array<string, string|null>
     */
    private function download(string $token, string $key): array
    {
        return $this->downloadNode($token, $this->nodeId($key));
    }

    /**
     * @return array<string, string|null>
     */
    private function downloadNode(string $token, string $nodeId): array
    {
        $issued = $this->issue($token, $nodeId);
        $this->flushHeaders();
        $this->save($this->get($this->path($issued))->assertOk()->streamedContent());
        $entries = ZipArchiveInspector::contents($this->zipPath);
        ksort($entries);

        return $entries;
    }

    /**
     * @return array{url: string, name: string, idleExpires: string, absoluteExpires: string}
     */
    private function issue(string $token, string $nodeId, string $account = 'bob'): array
    {
        $this->flushHeaders();

        /** @var array{url: string, name: string, idleExpires: string, absoluteExpires: string} $issued */
        $issued = $this->withBearer($token)
            ->postJson('/api/v1/jmap/folder-download-tickets/'.$account, ['nodeId' => $nodeId])
            ->assertCreated()
            ->json();

        return $issued;
    }

    /**
     * @param  array{url: string}  $issued
     */
    private function path(array $issued): string
    {
        return (string) parse_url($issued['url'], PHP_URL_PATH);
    }

    private function save(string $bytes): string
    {
        $this->zipPath = (string) tempnam(sys_get_temp_dir(), 'wgw-folder-zip-');
        file_put_contents($this->zipPath, $bytes);

        return $bytes;
    }

    private function share(string $token, string $path): string
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
    private function nodeId(string $key): string
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

    private function reconcile(string $dirKey): void
    {
        app(FileNodeIndexService::class)->reconcileDirectory($dirKey);
    }

    private function reconcileTree(string $dirKey): void
    {
        $this->reconcile($dirKey);
        foreach ($this->disk()->directories($dirKey) as $child) {
            $this->reconcileTree($child);
        }
    }

    private function writeDriveFile(string $key, string $content): void
    {
        $this->disk()->put($key, $content);
    }

    private function disk(): Filesystem
    {
        return app(WgwStorage::class)->files();
    }

    /**
     * @return array{access: string, refresh: string}
     */
    private function login(string $username): array
    {
        $this->flushHeaders();
        $response = $this->postJson('/api/v1/auth/token', ['username' => $username, 'password' => 'secret'])->assertOk();

        return ['access' => (string) $response->json('access_token'), 'refresh' => $this->refreshCookieValue($response)];
    }
}
