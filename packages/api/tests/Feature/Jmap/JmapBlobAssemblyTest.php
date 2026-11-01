<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapBlob;
use App\Models\JmapBlobAssembly;
use App\Models\JmapBlobClaim;
use App\Services\Jmap\Assembly\BlobAssemblyService;
use App\Services\Jmap\Blobs\JmapBlobMaintenance;
use App\Services\Jmap\Blobs\StorageFullException;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\Local\LocalDiskFiles;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Blob assembly extension (#1500): appends within the step budget, resume
 * after an interrupted step, TTL expiry, a finish whose id is the true
 * sha256 (the same id as a one-piece upload), hash states that cannot be
 * read back rebuilt in budgeted steps, idempotent append and finish.
 */
final class JmapBlobAssemblyTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const MIB = 1024 * 1024;

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        // Budget = max(1 MiB, …): a throughput of 1 B/s pins it to 1 MiB.
        config([
            'wgw.jmap.maintenance_share' => 0,
            'wgw.jmap.step_throughput_bytes' => 1,
        ]);
        $this->token = $this->userBearerToken();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     * @param  list<string>|null  $using
     */
    private function jmap(array $calls, ?array $using = null): TestResponse
    {
        return $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => $using ?? [JmapCapabilities::CORE, JmapCapabilities::BLOB_ASSEMBLY],
            'methodCalls' => $calls,
        ]);
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    private function method(string $method, array $args): array
    {
        $response = $this->jmap([[$method, ['accountId' => 'bob'] + $args, 'c']])->assertOk();

        return (array) $response->json('methodResponses.0.1') + ['_name' => $response->json('methodResponses.0.0')];
    }

    private function uploadPart(string $bytes, ?string $assemblyId = null): string
    {
        $headers = ['Authorization' => 'Bearer '.$this->token, 'Content-Type' => 'application/octet-stream'];
        if ($assemblyId !== null) {
            $headers['Wgw-Assembly-Id'] = $assemblyId;
        }

        return (string) $this->call('POST', '/api/v1/jmap/upload/bob', server: $this->transformHeadersToServerVars($headers), content: $bytes)
            ->assertStatus(201)
            ->json('blobId');
    }

    private function createAssembly(int $size, string $type = 'application/octet-stream'): string
    {
        $result = $this->method('BlobAssembly/set', ['create' => ['a' => ['size' => $size, 'type' => $type]]]);
        $this->assertIsString($result['created']['a']['id'] ?? null, json_encode($result) ?: '');

        return $result['created']['a']['id'];
    }

    /**
     * @param  list<string>  $partIds
     * @return array<string, mixed>
     */
    private function append(string $id, array $partIds, int $firstIndex = 0): array
    {
        $parts = [];
        foreach ($partIds as $offset => $blobId) {
            $parts[] = ['index' => $firstIndex + $offset, 'blobId' => $blobId];
        }

        return $this->method('BlobAssembly/append', ['id' => $id, 'parts' => $parts]);
    }

    /**
     * @return list<string>
     */
    private function chunks(string $bytes, int $size): array
    {
        return str_split($bytes, $size);
    }

    private function data(): Filesystem
    {
        return Storage::disk('wgw_data');
    }

    public function test_destroy_and_expiry_leave_an_assembly_alone_while_a_call_holds_its_lease(): void
    {
        $id = $this->createAssembly(10);
        JmapBlobAssembly::query()->where('assembly_id', $id)->update([
            'locked_until' => Carbon::now()->addMinute(), 'lease_token' => 'someone-else',
        ]);

        $result = $this->method('BlobAssembly/set', ['destroy' => [$id]]);
        $this->assertSame('serverFail', $result['notDestroyed'][$id]['type']);
        $this->assertSame(1, JmapBlobAssembly::query()->where('assembly_id', $id)->count());

        JmapBlobAssembly::query()->where('assembly_id', $id)->update(['expires_at' => Carbon::now()->subMinute()]);
        app(BlobAssemblyService::class)->expire();
        $this->assertSame(1, JmapBlobAssembly::query()->where('assembly_id', $id)->count());

        JmapBlobAssembly::query()->where('assembly_id', $id)->update(['locked_until' => Carbon::now()->subSecond()]);
        $this->assertSame(1, app(BlobAssemblyService::class)->expire());
        $this->assertSame(0, JmapBlobAssembly::query()->where('assembly_id', $id)->count());
    }

    public function test_capability_is_advertised_and_only_usable_when_listed_in_using(): void
    {
        $session = $this->withBearer($this->token)->getJson('/api/v1/jmap/session')->assertOk()->json();
        $this->assertSame([], $session['capabilities'][JmapCapabilities::BLOB_ASSEMBLY]);
        $account = $session['accounts']['bob']['accountCapabilities'][JmapCapabilities::BLOB_ASSEMBLY];
        $this->assertSame(self::MIB, $account['stepBudgetBytes']);
        $this->assertSame(4_000_000_000, $account['maxSizeAssembly']);
        $this->assertSame(24 * 3600, $account['assemblyTtlSeconds']);

        $response = $this->jmap([['BlobAssembly/set', ['accountId' => 'bob', 'create' => ['a' => ['size' => 1]]], 'c']], [JmapCapabilities::CORE]);
        $this->assertSame('unknownMethod', $response->json('methodResponses.0.1.type'));
    }

    public function test_parts_assemble_into_the_same_blob_as_a_one_piece_upload(): void
    {
        $bytes = random_bytes(1_800_000);
        $oneShot = $this->uploadPart($bytes);
        JmapBlob::query()->where('blob_id', $oneShot)->delete();
        $this->data()->delete('jmap/blobs/bob/'.$oneShot);

        $id = $this->createAssembly(strlen($bytes), 'video/mp4');
        $parts = array_map(fn (string $chunk): string => $this->uploadPart($chunk), $this->chunks($bytes, 600_000));

        $first = $this->append($id, array_slice($parts, 0, 1));
        $this->assertSame([0], $first['accepted']);
        $this->assertFalse($first['rebuiltOnly']);
        $this->assertSame(600_000, $first['received']);
        $second = $this->append($id, array_slice($parts, 1, 1), 1);
        $this->assertSame([1], $second['accepted']);
        $this->append($id, array_slice($parts, 2, 1), 2);

        $finish = $this->method('BlobAssembly/finish', ['id' => $id]);
        $this->assertSame('BlobAssembly/finish', $finish['_name']);
        $this->assertSame($oneShot, $finish['blobId']);
        $this->assertSame('video/mp4', $finish['type']);
        $row = JmapBlob::query()->where('blob_id', $oneShot)->firstOrFail();
        $this->assertSame(hash('sha256', $bytes), $row->sha256);
        $this->assertSame($bytes, $this->data()->get('jmap/blobs/bob/'.$oneShot));
        $this->assertFalse($this->data()->exists('jmap/assemblies/bob/'.$id));
    }

    public function test_assembled_blob_gets_the_same_filenode_blob_id_as_a_one_piece_upload(): void
    {
        $bytes = random_bytes(700_000);
        $oneShot = $this->uploadPart($bytes);
        $id = $this->createAssembly(strlen($bytes));
        $parts = array_map(fn (string $chunk): string => $this->uploadPart($chunk), $this->chunks($bytes, 350_000));
        $this->append($id, $parts);
        $assembled = $this->method('BlobAssembly/finish', ['id' => $id])['blobId'];
        $this->assertSame($oneShot, $assembled);

        $using = [JmapCapabilities::CORE, JmapCapabilities::FILENODE];
        $nodes = $this->jmap([['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g']], $using)->json('methodResponses.0.1.list');
        $root = collect($nodes)->firstWhere('name', 'bob')['id'];
        $created = $this->jmap([['FileNode/set', ['accountId' => 'bob', 'create' => [
            'one' => ['parentId' => $root, 'name' => 'one.bin', 'blobId' => $assembled],
        ]], 's']], $using)->assertOk()->json('methodResponses.0.1.created.one');

        $this->assertSame(substr(hash('sha256', $bytes), 0, 8), substr((string) $created['blobId'], -8));
    }

    public function test_an_append_over_the_step_budget_is_refused_up_front(): void
    {
        $id = $this->createAssembly(1_500_000);
        $parts = array_map(fn (string $chunk): string => $this->uploadPart($chunk), $this->chunks(random_bytes(1_500_000), 750_000));

        $error = $this->append($id, $parts);
        $this->assertSame('error', $error['_name']);
        $this->assertSame('requestTooLarge', $error['type']);
        $this->assertSame(0, JmapBlobAssembly::query()->where('assembly_id', $id)->value('received_bytes'));
    }

    public function test_a_retried_append_never_glues_a_part_twice(): void
    {
        $bytes = random_bytes(300_000);
        $id = $this->createAssembly(strlen($bytes));
        [$a, $b, $c] = array_map(fn (string $chunk): string => $this->uploadPart($chunk, $id), $this->chunks($bytes, 100_000));

        $this->assertSame([0], $this->append($id, [$a])['accepted']);
        $retry = $this->append($id, [$a]);
        $this->assertSame([0], $retry['accepted']);
        $this->assertSame(100_000, $retry['received']);

        $overlap = $this->append($id, [$a, $b]);
        $this->assertSame([0, 1], $overlap['accepted']);
        $this->assertSame(200_000, $overlap['received']);

        $conflict = $this->append($id, [$c]);
        $this->assertSame('invalidArguments', $conflict['type'], 'index 0 with another blobId');

        $this->append($id, [$c], 2);
        $this->assertSame('jb-'.substr(hash('sha256', $bytes), 0, 40), $this->method('BlobAssembly/finish', ['id' => $id])['blobId']);
    }

    public function test_resume_after_an_interrupted_step_drops_the_bytes_it_wrote(): void
    {
        $bytes = random_bytes(200_000);
        $id = $this->createAssembly(strlen($bytes));
        [$a, $b] = array_map(fn (string $chunk): string => $this->uploadPart($chunk, $id), $this->chunks($bytes, 100_000));
        $this->append($id, [$a]);

        // A step that timed out after writing part 1 but before recording it.
        $local = new LocalDiskFiles;
        $local->append($this->data(), 'jmap/assemblies/bob/'.$id, LocalDiskFiles::tempStream(substr($bytes, 100_000)));
        $state = $this->method('BlobAssembly/get', ['ids' => [$id]])['list'][0];
        $this->assertSame(1, $state['nextIndex']);
        $this->assertSame([0], $state['acceptedParts']);
        $this->assertFalse($state['hashRebuildPending']);

        $this->assertSame([1], $this->append($id, [$b], 1)['accepted']);
        $blobId = $this->method('BlobAssembly/finish', ['id' => $id])['blobId'];
        $this->assertSame($bytes, $this->data()->get('jmap/blobs/bob/'.$blobId));
    }

    public function test_an_unknown_part_is_blob_not_found_with_the_missing_ids(): void
    {
        $id = $this->createAssembly(10);
        $missing = 'jb-'.str_repeat('0', 40);

        $error = $this->append($id, [$missing]);
        $this->assertSame('blobNotFound', $error['type']);
        $this->assertSame([$missing], $error['notFound']);
    }

    public function test_an_abandoned_assembly_expires_and_releases_its_parts(): void
    {
        $id = $this->createAssembly(200_000);
        $part = $this->uploadPart(random_bytes(100_000), $id);
        $this->append($id, [$this->uploadPart(random_bytes(100_000))]);
        $this->assertSame(1, JmapBlobClaim::query()->where('assembly_id', $id)->count());

        Carbon::setTestNow(Carbon::now()->addHours(25));
        $this->assertSame('invalidArguments', $this->append($id, [$part], 1)['type']);

        $result = app(JmapBlobMaintenance::class)->runBounded();
        $this->assertSame(1, $result['assembliesExpired']);
        $this->assertNull(JmapBlobAssembly::query()->where('assembly_id', $id)->first());
        $this->assertSame(0, JmapBlobClaim::query()->where('assembly_id', $id)->count());
        $this->assertFalse($this->data()->exists('jmap/assemblies/bob/'.$id));
        // The released part is an ordinary expired blob now.
        $this->assertNull(JmapBlob::query()->where('blob_id', $part)->first());
    }

    /**
     * @return array<string, array{0: callable(JmapBlobAssembly): void}>
     */
    public static function unreadableStates(): array
    {
        return [
            'corrupt' => [static function (JmapBlobAssembly $row): void {
                $row->hash_state = base64_encode('O:11:"HashContext":1:{garbage');
            }],
            'another PHP build' => [static function (JmapBlobAssembly $row): void {
                $row->hash_build = '8.3.0|x86_64|8';
            }],
            'not a HashContext' => [static function (JmapBlobAssembly $row): void {
                $row->hash_state = base64_encode(serialize(new \ArrayObject(['x'])));
            }],
        ];
    }

    #[DataProvider('unreadableStates')]
    public function test_an_unreadable_hash_state_is_rebuilt_in_budgeted_steps(callable $spoil): void
    {
        $bytes = random_bytes(3_200_000);
        $id = $this->createAssembly(strlen($bytes));
        $parts = array_map(fn (string $chunk): string => $this->uploadPart($chunk), $this->chunks($bytes, 800_000));
        foreach (array_slice($parts, 0, 3) as $index => $blobId) {
            $this->assertSame([$index], $this->append($id, [$blobId], $index)['accepted']);
        }

        $row = JmapBlobAssembly::query()->where('assembly_id', $id)->firstOrFail();
        $spoil($row);
        $row->save();
        $this->assertTrue($this->method('BlobAssembly/get', ['ids' => [$id]])['list'][0]['hashRebuildPending']);

        // 2.4 MB assembled, 1 MiB per call: two calls only rebuild.
        $steps = [];
        do {
            $step = $this->append($id, [$parts[3]], 3);
            $steps[] = $step;
        } while ($step['accepted'] === [] && count($steps) < 10);

        $this->assertGreaterThanOrEqual(3, count($steps));
        $this->assertTrue($steps[0]['rebuiltOnly']);
        $this->assertTrue($steps[0]['hashRebuildPending']);
        $this->assertSame([], $steps[0]['accepted']);
        $this->assertSame(2_400_000, $steps[0]['received']);
        $this->assertSame([3], end($steps)['accepted']);

        $blobId = $this->method('BlobAssembly/finish', ['id' => $id])['blobId'];
        $this->assertSame('jb-'.substr(hash('sha256', $bytes), 0, 40), $blobId);
    }

    public function test_finish_rebuilds_an_unreadable_state_in_steps_too(): void
    {
        $bytes = random_bytes(1_600_000);
        $id = $this->createAssembly(strlen($bytes));
        $parts = array_map(fn (string $chunk): string => $this->uploadPart($chunk), $this->chunks($bytes, 800_000));
        $this->append($id, [$parts[0]]);
        $this->append($id, [$parts[1]], 1);
        JmapBlobAssembly::query()->where('assembly_id', $id)->update(['hash_state' => 'garbage']);

        $first = $this->method('BlobAssembly/finish', ['id' => $id]);
        $this->assertNull($first['blobId']);
        $this->assertTrue($first['hashRebuildPending']);
        $second = $this->method('BlobAssembly/finish', ['id' => $id]);
        $this->assertSame('jb-'.substr(hash('sha256', $bytes), 0, 40), $second['blobId']);
    }

    public function test_a_retried_finish_reuses_the_stored_hash_and_never_finalizes_twice(): void
    {
        $bytes = random_bytes(100_000);
        $id = $this->createAssembly(strlen($bytes));
        $this->append($id, [$this->uploadPart($bytes)]);

        // A finish that stored its final hash and then timed out before
        // committing the blob: the stored hash is reused, the (already
        // finalized) context is never touched again.
        JmapBlobAssembly::query()->where('assembly_id', $id)->update([
            'final_sha256' => hash('sha256', $bytes),
            'hash_state' => null,
        ]);
        $first = $this->method('BlobAssembly/finish', ['id' => $id]);
        $this->assertFalse($first['hashRebuildPending']);
        $this->assertSame('jb-'.substr(hash('sha256', $bytes), 0, 40), $first['blobId']);

        $again = $this->method('BlobAssembly/finish', ['id' => $id]);
        $this->assertSame($first['blobId'], $again['blobId']);
    }

    public function test_finish_checks_the_total_length(): void
    {
        $id = $this->createAssembly(10);
        $this->append($id, [$this->uploadPart('12345')]);

        $error = $this->method('BlobAssembly/finish', ['id' => $id]);
        $this->assertSame('invalidArguments', $error['type']);
        $this->assertSame('invalidArguments', $this->append($id, [$this->uploadPart('123456')], 1)['type'], 'more than the declared size');
    }

    public function test_create_refuses_more_than_max_size_assembly(): void
    {
        config(['wgw.jmap.max_size_blob_set' => 1000]);

        $result = $this->method('BlobAssembly/set', ['create' => ['a' => ['size' => 1001]]]);
        $this->assertSame('tooLarge', $result['notCreated']['a']['type']);
    }

    public function test_parts_are_deleted_as_appended_unless_still_needed(): void
    {
        $id = $this->createAssembly(300_000);
        $other = $this->createAssembly(100_000);
        $shared = random_bytes(100_000);
        $sharedId = $this->uploadPart($shared, $id);
        $this->uploadPart($shared, $other);
        $plain = $this->uploadPart(random_bytes(100_000));

        // index 0 and 1 are the same bytes (one blobId); index 2 a plain part.
        $result = $this->append($id, [$sharedId, $sharedId, $plain]);
        $this->assertSame([0, 1, 2], $result['accepted']);

        $this->assertNull(JmapBlob::query()->where('blob_id', $plain)->first(), 'consumed part deleted');
        $this->assertNotNull(JmapBlob::query()->where('blob_id', $sharedId)->first(), 'claimed by another open assembly');

        $this->append($other, [$sharedId]);
        $this->assertNull(JmapBlob::query()->where('blob_id', $sharedId)->first(), 'no one needs it any more');
        $this->assertSame(0, JmapBlobClaim::query()->count());
    }

    public function test_a_full_disk_during_an_append_answers_507_and_keeps_the_assembly(): void
    {
        $this->app->instance(LocalDiskFiles::class, new class extends LocalDiskFiles
        {
            protected function write($handle, string $chunk): void
            {
                parent::write($handle, substr($chunk, 0, 10));
                throw new StorageFullException('The storage is full.');
            }
        });
        $bytes = random_bytes(100_000);
        $id = $this->createAssembly(strlen($bytes));
        $part = $this->uploadPart($bytes);

        $this->jmap([['BlobAssembly/append', ['accountId' => 'bob', 'id' => $id, 'parts' => [['index' => 0, 'blobId' => $part]]], 'c']])
            ->assertStatus(507)
            ->assertJsonPath('type', 'https://wegotworkspace.org/jmap/problem/insufficient-storage');

        $this->app->forgetInstance(LocalDiskFiles::class);
        $this->assertSame(0, (new LocalDiskFiles)->size($this->data(), 'jmap/assemblies/bob/'.$id));
        $this->assertNotNull(JmapBlob::query()->where('blob_id', $part)->first());
    }
}
