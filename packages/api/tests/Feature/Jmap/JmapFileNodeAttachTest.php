<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapAttachStaging;
use App\Models\JmapBlob;
use App\Services\Jmap\Assembly\BlobAssemblyService;
use App\Services\Jmap\Assembly\BlobClaimService;
use App\Services\Jmap\Blobs\FreeSpaceSource;
use App\Services\Jmap\Blobs\JmapBlobService;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\Local\LocalDiskFiles;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use League\Flysystem\Config;
use League\Flysystem\Filesystem as Flysystem;
use League\Flysystem\Local\LocalFilesystemAdapter;
use League\Flysystem\UnableToWriteFile;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Attaching a blob to a FileNode (#1500): streamed, a move only for the
 * last reference, a streamed copy otherwise (and split across calls when
 * larger than one step), concurrent attaches never lose the blob, and a
 * full disk is overQuota.
 */
final class JmapFileNodeAttachTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config(['wgw.jmap.maintenance_share' => 0]);
        $this->token = $this->userBearerToken();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    /**
     * @param  array<string, mixed>  $args
     */
    private function set(array $args): TestResponse
    {
        return $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/set', ['accountId' => 'bob'] + $args, 's']],
        ])->assertOk();
    }

    private function upload(string $bytes): string
    {
        return (string) $this->call('POST', '/api/v1/jmap/upload/bob', server: $this->transformHeadersToServerVars([
            'Authorization' => 'Bearer '.$this->token,
            'Content-Type' => 'application/octet-stream',
        ]), content: $bytes)->assertStatus(201)->json('blobId');
    }

    private function homeId(): string
    {
        $list = $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g']],
        ])->json('methodResponses.0.1.list');

        return (string) collect($list)->firstWhere('name', 'bob')['id'];
    }

    private function files(): Filesystem
    {
        return Storage::disk('wgw_files');
    }

    private function blobExists(string $blobId): bool
    {
        return JmapBlob::query()->where('blob_id', $blobId)->exists()
            && Storage::disk('wgw_data')->exists('jmap/blobs/bob/'.$blobId);
    }

    private function forceCopies(): void
    {
        $this->app->instance(LocalDiskFiles::class, new class extends LocalDiskFiles
        {
            public function sameDevice(string $pathA, string $pathB): bool
            {
                return false;
            }
        });
    }

    /**
     * A blob larger than any upload part, written straight to the store.
     */
    private function bigBlob(int $size): string
    {
        $blobs = app(JmapBlobService::class);
        $tmp = $blobs->tmpKey('bob');
        $context = hash_init('sha256');
        $chunk = random_bytes(1024 * 1024);
        $local = new LocalDiskFiles;
        for ($written = 0; $written < $size; $written += strlen($chunk)) {
            $local->append(Storage::disk('wgw_data'), $tmp, LocalDiskFiles::tempStream($chunk));
            hash_update($context, $chunk);
        }

        return $blobs->commitFile('bob', 'video/mp4', $tmp, hash_final($context), $size)['blobId'];
    }

    public function test_the_last_reference_moves_the_blob_without_a_php_string(): void
    {
        $size = 40 * 1024 * 1024;
        $blobId = $this->bigBlob($size);
        $home = $this->homeId();

        gc_collect_cycles();
        $before = memory_get_usage();
        memory_reset_peak_usage();
        $created = $this->set(['create' => ['f' => ['parentId' => $home, 'name' => 'video.mp4', 'blobId' => $blobId]]])
            ->json('methodResponses.0.1.created.f');
        $peak = memory_get_peak_usage() - $before;

        $this->assertSame($size, $created['size']);
        // MIME sniffing (libmagic) reads a bounded sample; a string copy of
        // the blob would cost the whole 40 MB.
        $this->assertLessThan(intdiv($size, 2), $peak, 'The blob went through a PHP string.');
        $this->assertSame($size, $this->files()->size('users/bob/video.mp4'));
        $this->assertFalse($this->blobExists($blobId), 'moved, not copied');
        $this->assertSame(substr($blobId, 3, 8), substr((string) $created['blobId'], -8));
    }

    public function test_a_large_streamed_copy_stays_out_of_memory_too(): void
    {
        $this->forceCopies();
        $size = 40 * 1024 * 1024;
        $blobId = $this->bigBlob($size);
        $home = $this->homeId();

        gc_collect_cycles();
        $before = memory_get_usage();
        memory_reset_peak_usage();
        $this->set(['create' => ['f' => ['parentId' => $home, 'name' => 'copy.mp4', 'blobId' => $blobId]]])
            ->assertJsonPath('methodResponses.0.1.created.f.size', $size);

        $this->assertLessThan(intdiv($size, 2), memory_get_peak_usage() - $before);
        $this->assertTrue($this->blobExists($blobId));
    }

    public function test_the_same_blob_in_two_creates_copies_first_and_moves_last(): void
    {
        $blobId = $this->upload('same content, two names');
        $home = $this->homeId();

        $result = $this->set(['create' => [
            'a' => ['parentId' => $home, 'name' => 'a.txt', 'blobId' => $blobId],
            'b' => ['parentId' => $home, 'name' => 'b.txt', 'blobId' => $blobId],
        ]])->json('methodResponses.0.1');

        $this->assertEmpty($result['notCreated']);
        $this->assertSame('same content, two names', $this->files()->get('users/bob/a.txt'));
        $this->assertSame('same content, two names', $this->files()->get('users/bob/b.txt'));
        $this->assertSame(substr((string) $result['created']['a']['blobId'], -8), substr((string) $result['created']['b']['blobId'], -8));
        $this->assertFalse($this->blobExists($blobId));
    }

    public function test_a_reference_checker_veto_makes_it_a_copy(): void
    {
        $assembly = app(BlobAssemblyService::class)->create('bob', 10, null);
        $blobId = $this->upload('claimed part');
        app(BlobClaimService::class)->claim('bob', (string) $assembly['id'], $blobId);

        $this->set(['create' => ['f' => ['parentId' => $this->homeId(), 'name' => 'c.txt', 'blobId' => $blobId]]])
            ->assertJsonPath('methodResponses.0.1.created.f.size', 12);

        $this->assertTrue($this->blobExists($blobId));
        $this->assertSame('claimed part', $this->files()->get('users/bob/c.txt'));
    }

    public function test_a_blob_another_attach_is_copying_is_copied_not_moved(): void
    {
        $blobId = $this->upload('in use elsewhere');
        JmapBlob::query()->where('blob_id', $blobId)->update(['in_use_until' => Carbon::now()->addMinute()]);

        $this->set(['create' => ['f' => ['parentId' => $this->homeId(), 'name' => 'd.txt', 'blobId' => $blobId]]])
            ->assertJsonPath('methodResponses.0.1.created.f.size', 16);

        $this->assertTrue($this->blobExists($blobId));
    }

    public function test_after_a_move_a_concurrent_reference_fails_cleanly(): void
    {
        $blobId = $this->upload('moved once');
        $home = $this->homeId();
        $this->set(['create' => ['f' => ['parentId' => $home, 'name' => 'first.txt', 'blobId' => $blobId]]]);

        $this->set(['create' => ['g' => ['parentId' => $home, 'name' => 'second.txt', 'blobId' => $blobId]]])
            ->assertJsonPath('methodResponses.0.1.notCreated.g.type', 'invalidProperties')
            ->assertJsonPath('methodResponses.0.1.notCreated.g.properties', ['blobId']);

        $this->assertSame('moved once', $this->files()->get('users/bob/first.txt'));
        $this->assertFalse($this->files()->exists('users/bob/second.txt'));
    }

    public function test_different_volumes_mean_a_streamed_copy(): void
    {
        $this->forceCopies();
        $blobId = $this->upload('across volumes');
        $node = $this->set(['create' => ['f' => ['parentId' => $this->homeId(), 'name' => 'e.txt', 'blobId' => $blobId]]])
            ->json('methodResponses.0.1.created.f');

        $this->assertSame('across volumes', $this->files()->get('users/bob/e.txt'));
        $this->assertTrue($this->blobExists($blobId));
        $this->assertSame(substr(hash('sha256', 'across volumes'), 0, 8), substr((string) $node['blobId'], -8));
        $this->assertSame([], $this->files()->allFiles('.wgw-staging'));
    }

    public function test_a_copy_larger_than_one_step_is_split_across_calls(): void
    {
        config(['wgw.jmap.step_throughput_bytes' => 1]);
        $this->forceCopies();
        $bytes = random_bytes(2_500_000);
        $blobId = $this->upload(substr($bytes, 0, 0).$bytes);
        $home = $this->homeId();
        $create = ['create' => ['f' => ['parentId' => $home, 'name' => 'big.bin', 'blobId' => $blobId]]];

        $first = $this->set($create)->json('methodResponses.0.1.notCreated.f');
        $this->assertSame('attachInProgress', $first['type']);
        $this->assertSame(1024 * 1024, $first['copied']);
        $this->assertSame(2_500_000, $first['size']);
        $this->assertFalse($this->files()->exists('users/bob/big.bin'));

        $second = $this->set($create)->json('methodResponses.0.1.notCreated.f');
        $this->assertSame(2 * 1024 * 1024, $second['copied']);

        $done = $this->set($create)->json('methodResponses.0.1.created.f');
        $this->assertSame(2_500_000, $done['size']);
        $this->assertSame(hash('sha256', $bytes), hash('sha256', (string) $this->files()->get('users/bob/big.bin')));
        $this->assertSame(0, JmapAttachStaging::query()->count());
    }

    public function test_a_vanished_staging_file_restarts_the_copy_instead_of_filling_zeros(): void
    {
        config(['wgw.jmap.step_throughput_bytes' => 1]);
        $this->forceCopies();
        $bytes = random_bytes(2_500_000);
        $blobId = $this->upload($bytes);
        $create = ['create' => ['f' => ['parentId' => $this->homeId(), 'name' => 'big.bin', 'blobId' => $blobId]]];
        $this->set($create)->assertOk();
        $this->files()->delete(JmapAttachStaging::query()->firstOrFail()->staging_key);

        $created = null;
        for ($i = 0; $i < 6 && $created === null; $i++) {
            $created = $this->set($create)->json('methodResponses.0.1.created.f');
        }

        $this->assertNotNull($created);
        $this->assertSame(hash('sha256', $bytes), hash('sha256', (string) $this->files()->get('users/bob/big.bin')));
        $this->assertSame(0, JmapAttachStaging::query()->count());
    }

    public function test_a_staged_copy_another_call_is_writing_answers_attach_in_progress_untouched(): void
    {
        config(['wgw.jmap.step_throughput_bytes' => 1]);
        $this->forceCopies();
        $blobId = $this->upload(random_bytes(2_500_000));
        $create = ['create' => ['f' => ['parentId' => $this->homeId(), 'name' => 'big.bin', 'blobId' => $blobId]]];
        $this->set($create)->assertOk();
        JmapAttachStaging::query()->update(['locked_until' => Carbon::now()->addMinute(), 'lease_token' => 'other-call']);

        $busy = $this->set($create)->json('methodResponses.0.1.notCreated.f');

        $this->assertSame('attachInProgress', $busy['type']);
        $this->assertSame(1024 * 1024, $busy['copied']);
        $this->assertSame(1024 * 1024, JmapAttachStaging::query()->firstOrFail()->copied_bytes);
        $this->assertSame('other-call', JmapAttachStaging::query()->firstOrFail()->lease_token);
    }

    public function test_a_refused_attach_leaves_the_replaced_file_and_the_name_untouched(): void
    {
        config(['wgw.jmap.step_throughput_bytes' => 1]);
        $this->forceCopies();
        $this->seedPrivateFile('bob', 'big.bin', 'old bytes');
        $this->seedPrivateFile('bob', 'small.txt', 'small');
        $home = $this->homeId();
        $blobId = $this->upload(random_bytes(2_500_000));

        // Create with onExists replace: the copy needs more calls, nothing is destroyed yet.
        $create = $this->set(['onExists' => 'replace', 'create' => ['f' => ['parentId' => $home, 'name' => 'big.bin', 'blobId' => $blobId]]]);
        $this->assertSame('attachInProgress', $create->json('methodResponses.0.1.notCreated.f.type'));
        $this->assertSame('old bytes', $this->files()->get('users/bob/big.bin'));
        $this->assertEmpty($create->json('methodResponses.0.1.destroyed'));

        // Update with a rename and a blob: the rename waits for the attach too.
        $list = $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g']],
        ])->json('methodResponses.0.1.list');
        $smallId = (string) collect($list)->firstWhere('name', 'small.txt')['id'];
        $other = $this->upload(random_bytes(2_500_000));
        $update = $this->set(['update' => [$smallId => ['name' => 'renamed.bin', 'blobId' => $other]]]);
        $this->assertSame('attachInProgress', $update->json('methodResponses.0.1.notUpdated.'.$smallId.'.type'));
        $this->assertTrue($this->files()->exists('users/bob/small.txt'));
        $this->assertFalse($this->files()->exists('users/bob/renamed.bin'));
    }

    private function failRenames(): void
    {
        // Same device, but the rename itself fails (EXDEV between bind mounts).
        $this->app->instance(LocalDiskFiles::class, new class extends LocalDiskFiles
        {
            public function moveAcross(Filesystem $fromDisk, string $fromKey, Filesystem $toDisk, string $toKey): bool
            {
                return false;
            }
        });
    }

    public function test_a_failed_rename_then_a_refused_copy_leaves_the_replaced_file(): void
    {
        config(['wgw.jmap.step_throughput_bytes' => 1]);
        $this->failRenames();
        $this->seedPrivateFile('bob', 'a.txt', 'old bytes');
        $home = $this->homeId();
        $bytes = random_bytes(2_500_000);
        $blobId = $this->upload($bytes);
        $create = ['onExists' => 'replace', 'create' => ['f' => ['parentId' => $home, 'name' => 'a.txt', 'blobId' => $blobId]]];

        $first = $this->set($create);
        $this->assertSame('attachInProgress', $first->json('methodResponses.0.1.notCreated.f.type'));
        $this->assertSame('old bytes', $this->files()->get('users/bob/a.txt'));
        $this->assertEmpty($first->json('methodResponses.0.1.destroyed'));

        $created = null;
        for ($i = 0; $i < 6 && $created === null; $i++) {
            $created = $this->set($create)->json('methodResponses.0.1.created.f');
        }
        $this->assertNotNull($created);
        $this->assertSame(hash('sha256', $bytes), hash('sha256', (string) $this->files()->get('users/bob/a.txt')));
    }

    public function test_a_failed_rename_then_a_refused_copy_keeps_the_expected_blob_id_retryable(): void
    {
        config(['wgw.jmap.step_throughput_bytes' => 1]);
        $this->failRenames();
        $this->seedPrivateFile('bob', 'a.txt', 'old bytes');
        $list = $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g']],
        ])->json('methodResponses.0.1.list');
        $node = collect($list)->firstWhere('name', 'a.txt');
        $bytes = random_bytes(2_500_000);
        $update = ['update' => [(string) $node['id'] => ['blobId' => $this->upload($bytes), 'expectedBlobId' => $node['blobId']]]];

        $done = null;
        for ($i = 0; $i < 6 && $done === null; $i++) {
            $response = $this->set($update);
            $this->assertNotSame('versionMismatch', $response->json('methodResponses.0.1.notUpdated.'.$node['id'].'.type'));
            $done = $response->json('methodResponses.0.1.updated.'.$node['id']);
        }
        $this->assertNotNull($done);
        $this->assertSame(hash('sha256', $bytes), hash('sha256', (string) $this->files()->get('users/bob/a.txt')));
    }

    public function test_not_enough_free_space_is_over_quota(): void
    {
        $this->forceCopies();
        $blobId = $this->upload('does not fit');
        $this->app->instance(FreeSpaceSource::class, new class implements FreeSpaceSource
        {
            public function freeBytes(Filesystem $disk): ?int
            {
                return 3;
            }
        });

        $this->set(['create' => ['f' => ['parentId' => $this->homeId(), 'name' => 'f.txt', 'blobId' => $blobId]]])
            ->assertJsonPath('methodResponses.0.1.notCreated.f.type', 'overQuota');
        $this->assertFalse($this->files()->exists('users/bob/f.txt'));
    }

    public function test_a_write_the_hosting_quota_refuses_is_over_quota(): void
    {
        $this->forceCopies();
        $blobId = $this->upload('hosting quota is full');
        $home = $this->homeId();
        $root = (string) config('filesystems.disks.wgw_files.root');
        $adapter = new class($root) extends LocalFilesystemAdapter
        {
            public function writeStream(string $path, $contents, Config $config): void
            {
                throw UnableToWriteFile::atLocation($path, 'fwrite(): write of 8192 bytes failed with errno=122 Disk quota exceeded');
            }
        };
        Storage::set('wgw_files', new FilesystemAdapter(new Flysystem($adapter), $adapter, ['throw' => true]));

        $this->set(['create' => ['f' => ['parentId' => $home, 'name' => 'g.txt', 'blobId' => $blobId]]])
            ->assertJsonPath('methodResponses.0.1.notCreated.f.type', 'overQuota');
        $this->assertTrue($this->blobExists($blobId), 'the blob survives a refused write');
    }

    public function test_an_update_attaches_by_streaming_too(): void
    {
        $this->seedPrivateFile('bob', 'doc.txt', 'old');
        $home = $this->homeId();
        unset($home);
        $list = $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g']],
        ])->json('methodResponses.0.1.list');
        $docId = (string) collect($list)->firstWhere('name', 'doc.txt')['id'];
        $blobId = $this->upload('new content');

        $updated = $this->set(['update' => [$docId => ['blobId' => $blobId]]])->json('methodResponses.0.1.updated.'.$docId);

        $this->assertSame('new content', $this->files()->get('users/bob/doc.txt'));
        $this->assertSame(substr(hash('sha256', 'new content'), 0, 8), substr((string) $updated['blobId'], -8));
    }
}
