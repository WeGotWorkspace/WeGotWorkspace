<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapBlob;
use App\Services\Jmap\Blobs\FreeSpaceSource;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * RFC 9404 Blob/upload and the minimal Blob/get (#1500): source forms,
 * order, duplicates, missing parts, the budget refusal, maxDataSources,
 * the true sha256 of the join, and free space without double counting.
 */
final class JmapBlobUploadMethodTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config(['wgw.jmap.maintenance_share' => 0, 'wgw.jmap.step_throughput_bytes' => 1]);
        $this->token = $this->userBearerToken();
    }

    protected function tearDown(): void
    {
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
            'using' => $using ?? [JmapCapabilities::CORE, JmapCapabilities::BLOB],
            'methodCalls' => $calls,
        ]);
    }

    /**
     * @param  array<string, mixed>  $create
     * @return array<string, mixed>
     */
    private function blobUpload(array $create): array
    {
        $response = $this->jmap([['Blob/upload', ['accountId' => 'bob', 'create' => $create], 'u']])->assertOk();

        return (array) $response->json('methodResponses.0.1') + ['_name' => $response->json('methodResponses.0.0')];
    }

    private function part(string $bytes): string
    {
        return (string) $this->call('POST', '/api/v1/jmap/upload/bob', server: $this->transformHeadersToServerVars([
            'Authorization' => 'Bearer '.$this->token,
            'Content-Type' => 'application/octet-stream',
        ]), content: $bytes)->assertStatus(201)->json('blobId');
    }

    public function test_session_advertises_the_blob_capability(): void
    {
        $session = $this->withBearer($this->token)->getJson('/api/v1/jmap/session')->assertOk()->json();

        $this->assertSame([], $session['capabilities'][JmapCapabilities::BLOB]);
        $account = $session['accounts']['bob']['accountCapabilities'][JmapCapabilities::BLOB];
        $this->assertSame(4_000_000_000, $account['maxSizeBlobSet']);
        $this->assertGreaterThanOrEqual(64, $account['maxDataSources']);
        $this->assertSame([], $account['supportedTypeNames']);
        $this->assertSame([], $account['supportedDigestAlgorithms']);
    }

    public function test_all_source_forms_join_in_order_with_the_true_sha256(): void
    {
        $a = $this->part('0123456789');
        $b = $this->part('abcdefghij');

        $result = $this->blobUpload(['x' => ['type' => 'text/plain', 'data' => [
            ['blobId' => $b, 'offset' => 2, 'length' => 3],
            ['data:asText' => '|'],
            ['blobId' => $a],
            ['data:asBase64' => base64_encode("\x00\xff")],
            ['blobId' => $a, 'offset' => 8],
        ]]]);

        $expected = 'cde|0123456789'."\x00\xff".'89';
        $created = $result['created']['x'];
        $this->assertSame('jb-'.substr(hash('sha256', $expected), 0, 40), $created['id']);
        $this->assertSame(strlen($expected), $created['size']);
        $this->assertSame('text/plain', $created['type']);
        $this->assertSame(hash('sha256', $expected), JmapBlob::query()->where('blob_id', $created['id'])->value('sha256'));

        $this->assertSame($expected, Storage::disk('wgw_data')->get('jmap/blobs/bob/'.$created['id']));
    }

    public function test_duplicate_parts_and_a_single_full_source(): void
    {
        $a = $this->part('same');

        $twice = $this->blobUpload(['x' => ['data' => [['blobId' => $a], ['blobId' => $a]]]]);
        $this->assertSame('jb-'.substr(hash('sha256', 'samesame'), 0, 40), $twice['created']['x']['id']);

        // One full source is the source itself (content-addressed).
        $same = $this->blobUpload(['y' => ['data' => [['blobId' => $a]]]]);
        $this->assertSame($a, $same['created']['y']['id']);
    }

    public function test_missing_parts_fail_with_blob_not_found_listing_them(): void
    {
        $a = $this->part('present');
        $gone = 'jb-'.str_repeat('a', 40);
        $other = 'jb-'.str_repeat('b', 40);

        $result = $this->blobUpload(['x' => ['data' => [['blobId' => $gone], ['blobId' => $a], ['blobId' => $other]]]]);

        $this->assertNull($result['created']);
        $this->assertSame('blobNotFound', $result['notCreated']['x']['type']);
        $this->assertSame([$gone, $other], $result['notCreated']['x']['notFound']);
    }

    public function test_invalid_sources_are_not_created(): void
    {
        $a = $this->part('short');

        $result = $this->blobUpload([
            'pastEnd' => ['data' => [['blobId' => $a, 'offset' => 2, 'length' => 10]]],
            'twoForms' => ['data' => [['blobId' => $a, 'data:asText' => 'x']]],
            'badBase64' => ['data' => [['data:asBase64' => '***']]],
            'empty' => ['data' => []],
        ]);

        foreach (['pastEnd', 'twoForms', 'badBase64', 'empty'] as $id) {
            $this->assertSame('invalidProperties', $result['notCreated'][$id]['type'], $id);
        }
    }

    public function test_sources_over_the_step_budget_are_refused_up_front(): void
    {
        // Budget is 1 MiB; 1.2 MB of sources never starts writing.
        $a = $this->part(random_bytes(600_000));
        $b = $this->part(random_bytes(600_000));
        $before = JmapBlob::query()->count();

        $result = $this->blobUpload(['x' => ['data' => [['blobId' => $a], ['blobId' => $b]]]]);

        $this->assertSame('error', $result['_name']);
        $this->assertSame('requestTooLarge', $result['type']);
        $this->assertSame($before, JmapBlob::query()->count());
    }

    public function test_more_sources_than_max_data_sources_is_too_large(): void
    {
        $data = array_fill(0, 1025, ['data:asText' => 'x']);

        $result = $this->blobUpload(['x' => ['data' => $data]]);

        $this->assertSame('tooLarge', $result['notCreated']['x']['type']);
    }

    public function test_free_space_counts_only_the_bytes_the_join_adds(): void
    {
        $a = $this->part(str_repeat('a', 500));
        $b = $this->part(str_repeat('b', 500));
        $free = new class implements FreeSpaceSource
        {
            public ?int $bytes = 1000;

            public function freeBytes(Filesystem $disk): ?int
            {
                return $this->bytes;
            }
        };
        $this->app->instance(FreeSpaceSource::class, $free);

        // Parts already stored are not counted again: 1000 bytes fit 1000.
        $ok = $this->blobUpload(['x' => ['data' => [['blobId' => $a], ['blobId' => $b]]]]);
        $this->assertNotNull($ok['created']['x']['id'] ?? null);

        $free->bytes = 999;
        $refused = $this->blobUpload(['y' => ['data' => [['blobId' => $b], ['blobId' => $a]]]]);
        $this->assertSame('overQuota', $refused['notCreated']['y']['type']);
    }

    public function test_the_joined_blob_works_in_filenode_set(): void
    {
        $a = $this->part('hello ');
        $b = $this->part('world');
        $joined = $this->blobUpload(['x' => ['data' => [['blobId' => $a], ['blobId' => $b]]]])['created']['x']['id'];

        $using = [JmapCapabilities::CORE, JmapCapabilities::FILENODE];
        $nodes = $this->jmap([['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g']], $using)->json('methodResponses.0.1.list');
        $root = collect($nodes)->firstWhere('name', 'bob')['id'];
        $created = $this->jmap([['FileNode/set', ['accountId' => 'bob', 'create' => [
            'f' => ['parentId' => $root, 'name' => 'hello.txt', 'blobId' => $joined],
        ]], 's']], $using)->assertOk()->json('methodResponses.0.1.created.f');

        $this->assertSame(11, $created['size']);
        $this->assertSame(substr(hash('sha256', 'hello world'), 0, 8), substr((string) $created['blobId'], -8));
    }

    public function test_blob_get_serves_id_and_size_only(): void
    {
        $a = $this->part('twelve bytes');
        $missing = 'jb-'.str_repeat('c', 40);

        $get = $this->jmap([['Blob/get', ['accountId' => 'bob', 'ids' => [$a, $missing], 'properties' => ['id', 'size']], 'g']])
            ->assertOk()->json('methodResponses.0.1');
        $this->assertSame([['id' => $a, 'size' => 12]], $get['list']);
        $this->assertSame([$missing], $get['notFound']);

        $default = $this->jmap([['Blob/get', ['accountId' => 'bob', 'ids' => [$a]], 'g']])->json('methodResponses.0.1.list');
        $this->assertSame([['id' => $a, 'size' => 12]], $default);

        foreach (['data', 'data:asText', 'data:asBase64', 'digest:sha', 'isTruncated'] as $property) {
            $error = $this->jmap([['Blob/get', ['accountId' => 'bob', 'ids' => [$a], 'properties' => ['id', $property]], 'g']])
                ->json('methodResponses.0');
            $this->assertSame('error', $error[0], $property);
            $this->assertSame('invalidArguments', $error[1]['type'], $property);
        }
    }
}
