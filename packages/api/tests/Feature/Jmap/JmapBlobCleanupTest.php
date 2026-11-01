<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapAttachStaging;
use App\Models\JmapBlob;
use App\Models\JmapFileNode;
use App\Services\Jmap\Assembly\BlobAssemblyService;
use App\Services\Jmap\Assembly\BlobClaimService;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Cleanup without cron (#1500): expired blobs, assemblies, and leftovers
 * are cleaned up opportunistically during /jmap/upload and Blob/upload, in
 * bounded rounds, always honouring the reference checkers; the console
 * command does the same in full and hashes pending discovered files.
 */
final class JmapBlobCleanupTest extends WgwDatabaseTestCase
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

    private function upload(string $bytes): string
    {
        return (string) $this->call('POST', '/api/v1/jmap/upload/bob', server: $this->transformHeadersToServerVars([
            'Authorization' => 'Bearer '.$this->token,
            'Content-Type' => 'application/octet-stream',
        ]), content: $bytes)->assertStatus(201)->json('blobId');
    }

    private function expire(string $blobId): void
    {
        JmapBlob::query()->where('blob_id', $blobId)->update(['expires_at' => Carbon::now()->subHour()]);
    }

    private function exists(string $blobId): bool
    {
        return JmapBlob::query()->where('blob_id', $blobId)->exists();
    }

    public function test_an_upload_runs_bounded_cleanup_on_its_share_of_requests(): void
    {
        $expired = $this->upload('old and unreferenced');
        $this->expire($expired);

        $this->upload('no cleanup at a share of 0');
        $this->assertTrue($this->exists($expired));

        config(['wgw.jmap.maintenance_share' => 1]);
        $this->upload('this one cleans up');
        $this->assertFalse($this->exists($expired));
        $this->assertFalse(Storage::disk('wgw_data')->exists('jmap/blobs/bob/'.$expired));
    }

    public function test_blob_upload_runs_cleanup_too(): void
    {
        $expired = $this->upload('stale part');
        $source = $this->upload('fresh part');
        $this->expire($expired);
        config(['wgw.jmap.maintenance_share' => 1]);

        $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::BLOB],
            'methodCalls' => [['Blob/upload', ['accountId' => 'bob', 'create' => ['x' => ['data' => [['blobId' => $source]]]]], 'u']],
        ])->assertOk();

        $this->assertFalse($this->exists($expired));
    }

    public function test_cleanup_never_deletes_what_a_checker_still_needs(): void
    {
        $claimed = $this->upload('claimed by an open assembly');
        $copying = $this->upload('an attach is copying it');
        $staged = $this->upload('a staged copy holds it');
        $free = $this->upload('nobody needs it');
        foreach ([$claimed, $copying, $staged, $free] as $blobId) {
            $this->expire($blobId);
        }
        $assembly = app(BlobAssemblyService::class)->create('bob', 100, null);
        app(BlobClaimService::class)->claim('bob', (string) $assembly['id'], $claimed);
        JmapBlob::query()->where('blob_id', $copying)->update(['in_use_until' => Carbon::now()->addMinute()]);
        JmapAttachStaging::query()->create([
            'username' => 'bob', 'blob_id' => $staged, 'target_hash' => str_repeat('0', 64),
            'target_key' => 'users/bob/x', 'staging_key' => '.wgw-staging/bob/x', 'size_bytes' => 1, 'copied_bytes' => 0,
        ]);
        config(['wgw.jmap.maintenance_share' => 1]);

        $this->upload('trigger');

        $this->assertTrue($this->exists($claimed));
        $this->assertTrue($this->exists($copying));
        $this->assertTrue($this->exists($staged));
        $this->assertFalse($this->exists($free));
    }

    public function test_a_round_is_bounded(): void
    {
        $now = Carbon::now();
        $rows = [];
        for ($i = 0; $i < 130; $i++) {
            $rows[] = [
                'username' => 'bob', 'blob_id' => 'jb-'.str_pad(dechex($i), 40, '0', STR_PAD_LEFT), 'media_type' => null,
                'size_bytes' => 0, 'sha256' => str_repeat('0', 64), 'expires_at' => $now->copy()->subHour(),
                'created_at' => $now, 'updated_at' => $now,
            ];
        }
        JmapBlob::query()->insert($rows);
        config(['wgw.jmap.maintenance_share' => 1]);

        $this->upload('trigger');

        // 100 per round; the fresh upload itself is not expired.
        $this->assertSame(31, JmapBlob::query()->count());
    }

    public function test_orphaned_temp_files_and_stale_staging_are_swept(): void
    {
        $data = Storage::disk('wgw_data');
        $data->put('jmap/tmp/bob/orphan', 'left by a killed request');
        touch($data->path('jmap/tmp/bob/orphan'), Carbon::now()->subDays(2)->getTimestamp());
        $data->put('jmap/tmp/bob/young', 'still being written');
        Storage::disk('wgw_files')->put('.wgw-staging/bob/abandoned', 'half a copy');
        $staging = JmapAttachStaging::query()->create([
            'username' => 'bob', 'blob_id' => 'jb-'.str_repeat('e', 40), 'target_hash' => str_repeat('1', 64),
            'target_key' => 'users/bob/y', 'staging_key' => '.wgw-staging/bob/abandoned', 'size_bytes' => 10, 'copied_bytes' => 5,
        ]);
        JmapAttachStaging::query()->where('id', $staging->id)->update(['updated_at' => Carbon::now()->subDays(2)]);

        $this->assertSame(0, Artisan::call('wgw:jmap:blobs-gc'));

        $this->assertFalse($data->exists('jmap/tmp/bob/orphan'));
        $this->assertTrue($data->exists('jmap/tmp/bob/young'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('.wgw-staging/bob/abandoned'));
        $this->assertSame(0, JmapAttachStaging::query()->count());
    }

    public function test_the_gc_command_hashes_pending_discovered_files(): void
    {
        config(['wgw.jmap.discovery_hash_max_bytes' => 10]);
        $bytes = random_bytes(5000);
        Storage::disk('wgw_files')->put('users/bob/restored.bin', $bytes);
        $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g']],
        ])->assertOk();
        $this->assertTrue((bool) JmapFileNode::query()->where('storage_key', 'users/bob/restored.bin')->value('hash_pending'));

        $this->assertSame(0, Artisan::call('wgw:jmap:blobs-gc'));

        $row = JmapFileNode::query()->where('storage_key', 'users/bob/restored.bin')->firstOrFail();
        $this->assertFalse($row->hash_pending);
        $this->assertSame(hash('sha256', $bytes), $row->content_sha256);
    }
}
