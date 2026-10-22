<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapFileNode;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * `/jmap/download` streams (#1500): memory does not grow with the file,
 * Content-Length comes from the file at stream time, and single Range
 * requests are honoured.
 */
final class JmapDownloadStreamTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const MIB = 1024 * 1024;

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

    public function test_a_download_larger_than_a_string_would_allow_streams_in_bounded_memory(): void
    {
        $sha = $this->writeLargeFile('users/bob/big.bin', 48);
        // Written outside WGW and over the discovery cap: hash-pending, so
        // the id carries a provisional version (#1500) that downloads accept.
        $blobId = $this->blobIdFor('big.bin');
        $this->assertMatchesRegularExpression('/^fnb-fn-[0-9a-f]{32}-[0-9a-f]{8}$/', $blobId);

        memory_reset_peak_usage();
        $base = memory_get_usage();

        $response = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/jmap/download/bob/'.$blobId.'/big.bin')
            ->assertOk();
        $this->assertSame((string) (48 * self::MIB), $response->headers->get('Content-Length'));
        $this->assertSame('bytes', $response->headers->get('Accept-Ranges'));

        [$bytes, $hash] = $this->drain($response);
        $peak = memory_get_peak_usage() - $base;

        $this->assertSame(48 * self::MIB, $bytes);
        $this->assertSame($sha, $hash);
        $this->assertLessThan(16 * self::MIB, $peak, 'The download must not hold the file in memory.');
    }

    public function test_content_length_is_the_size_at_stream_time_not_the_stored_size(): void
    {
        $this->seedPrivateFile('bob', 'stale.txt', 'hello world');
        $blobId = $this->blobIdFor('stale.txt');
        JmapFileNode::query()->where('storage_key', 'users/bob/stale.txt')->update(['size_bytes' => 999]);

        $response = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/jmap/download/bob/'.$blobId.'/stale.txt')
            ->assertOk();

        $this->assertSame('11', $response->headers->get('Content-Length'));
        $this->assertSame('hello world', $response->streamedContent());
    }

    /**
     * @return iterable<string, array{0: string, 1: int, 2: string|null, 3: string|null}>
     */
    public static function ranges(): iterable
    {
        $body = self::body();
        yield 'first bytes' => ['bytes=0-9', 206, 'bytes 0-9/100', substr($body, 0, 10)];
        yield 'middle' => ['bytes=40-49', 206, 'bytes 40-49/100', substr($body, 40, 10)];
        yield 'open-ended' => ['bytes=90-', 206, 'bytes 90-99/100', substr($body, 90)];
        yield 'suffix' => ['bytes=-5', 206, 'bytes 95-99/100', substr($body, 95)];
        yield 'end past the size is clamped' => ['bytes=95-500', 206, 'bytes 95-99/100', substr($body, 95)];
        yield 'unsatisfiable' => ['bytes=100-', 416, 'bytes */100', null];
        yield 'several ranges serve the whole body' => ['bytes=0-1,5-6', 200, null, $body];
    }

    #[DataProvider('ranges')]
    public function test_single_range_requests(string $range, int $status, ?string $contentRange, ?string $expected): void
    {
        $this->seedPrivateFile('bob', 'range.txt', self::body());
        $blobId = $this->blobIdFor('range.txt');

        $response = $this->withBearer($this->userBearerToken())
            ->withHeader('Range', $range)
            ->get('/api/v1/jmap/download/bob/'.$blobId.'/range.txt');

        $response->assertStatus($status);
        $this->assertSame('bytes', $response->headers->get('Accept-Ranges'));
        $this->assertSame($contentRange, $response->headers->get('Content-Range'));
        if ($expected !== null) {
            $this->assertSame((string) strlen($expected), $response->headers->get('Content-Length'));
            $this->assertSame($expected, $response->streamedContent());
        }
    }

    public function test_head_answers_the_length_without_a_body(): void
    {
        $this->seedPrivateFile('bob', 'head.txt', self::body());
        $blobId = $this->blobIdFor('head.txt');

        $response = $this->withBearer($this->userBearerToken())
            ->call('HEAD', '/api/v1/jmap/download/bob/'.$blobId.'/head.txt', server: $this->transformHeadersToServerVars([
                'Authorization' => 'Bearer '.$this->userBearerToken(),
            ]));

        $response->assertOk();
        $this->assertSame('100', $response->headers->get('Content-Length'));
        $this->assertSame('', (string) $response->streamedContent());
    }

    public static function body(): string
    {
        return str_repeat('abcdefghij', 10);
    }

    private function blobIdFor(string $name): string
    {
        $list = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'c0']],
        ])->assertOk()->json('methodResponses.0.1.list');
        foreach ($list as $node) {
            if ($node['name'] === $name) {
                return (string) $node['blobId'];
            }
        }
        $this->fail('No FileNode named '.$name);
    }

    /**
     * Writes $mib MiB through a stream (never a whole string) and returns
     * the sha256 of the bytes.
     */
    private function writeLargeFile(string $key, int $mib): string
    {
        $source = tmpfile();
        $this->assertIsResource($source);
        $context = hash_init('sha256');
        for ($i = 0; $i < $mib; $i++) {
            $chunk = str_repeat(chr(65 + ($i % 26)), self::MIB);
            hash_update($context, $chunk);
            fwrite($source, $chunk);
        }
        rewind($source);
        app(WgwStorage::class)->files()->writeStream($key, $source);
        fclose($source);

        return hash_final($context);
    }

    /**
     * Runs the streamed body through an output buffer that hashes and
     * discards each chunk, so the test itself never holds the body.
     *
     * @return array{0: int, 1: string}
     */
    private function drain(TestResponse $response): array
    {
        $context = hash_init('sha256');
        $bytes = 0;
        ob_start(static function (string $buffer) use ($context, &$bytes): string {
            hash_update($context, $buffer);
            $bytes += strlen($buffer);

            return '';
        }, self::MIB);
        try {
            $response->baseResponse->sendContent();
        } finally {
            ob_end_flush();
        }

        return [$bytes, hash_final($context)];
    }
}
