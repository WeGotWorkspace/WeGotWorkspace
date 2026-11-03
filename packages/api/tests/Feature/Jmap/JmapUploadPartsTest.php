<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Http\Support\WgwOversizedPost;
use App\Models\JmapBlob;
use App\Services\Jmap\Blobs\JmapBlobLimits;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\Local\LocalDiskFiles;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use League\Flysystem\Config;
use League\Flysystem\Filesystem;
use League\Flysystem\Local\LocalFilesystemAdapter;
use League\Flysystem\UnableToWriteFile;
use Symfony\Component\Process\Process;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Streamed, checked parts on POST /jmap/upload (#1500): the advertised
 * limit, streaming without a whole-body string, both oversize shapes, a
 * discarded body answered as `limit`, declared length/sha256 checks, and
 * 507 when the storage is full.
 */
final class JmapUploadPartsTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config(['wgw.jmap.maintenance_share' => 0]);
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    /**
     * @param  string|resource  $content
     * @param  array<string, string>  $headers
     */
    private function upload($content, array $headers = []): TestResponse
    {
        return $this->call(
            'POST',
            '/api/v1/jmap/upload/bob',
            server: $this->transformHeadersToServerVars($headers + [
                'Authorization' => 'Bearer '.$this->userBearerToken(),
                'Content-Type' => 'application/octet-stream',
            ]),
            content: $content,
        );
    }

    public function test_session_advertises_the_smaller_of_config_and_post_max_size(): void
    {
        config(['wgw.jmap.max_size_upload' => PHP_INT_MAX]);

        $advertised = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json('capabilities.'.str_replace('.', '\\.', JmapCapabilities::CORE).'.maxSizeUpload');

        $post = WgwOversizedPost::iniBytes((string) ini_get('post_max_size'));
        $this->assertSame($post > 0 ? $post : PHP_INT_MAX, $advertised);
        $this->assertSame(JmapBlobLimits::maxSizeUpload(), $advertised);
    }

    public function test_a_part_is_streamed_without_a_whole_body_string(): void
    {
        $size = min(JmapBlobLimits::maxSizeUpload(), 8 * 1024 * 1024);
        $body = LocalDiskFiles::tempStream();
        $context = hash_init('sha256');
        $chunk = random_bytes(64 * 1024);
        for ($written = 0; $written < $size; $written += strlen($chunk)) {
            $piece = substr($chunk, 0, $size - $written);
            fwrite($body, $piece);
            hash_update($context, $piece);
        }
        rewind($body);
        $sha256 = hash_final($context);
        $token = $this->userBearerToken();

        gc_collect_cycles();
        $before = memory_get_usage();
        memory_reset_peak_usage();
        $response = $this->upload($body, [
            'Authorization' => 'Bearer '.$token,
            'Wgw-Part-Length' => (string) $size,
            'Wgw-Part-Sha256' => $sha256,
        ]);
        $peak = memory_get_peak_usage() - $before;

        $response->assertStatus(201);
        $this->assertSame($size, $response->json('size'));
        $this->assertSame('jb-'.substr($sha256, 0, 40), $response->json('blobId'));
        $this->assertSame($sha256, JmapBlob::query()->where('blob_id', $response->json('blobId'))->value('sha256'));
        // Reading the body into one string would cost at least $size.
        $this->assertLessThan(intdiv($size, 2), $peak, 'The part was buffered in memory.');
    }

    public function test_declared_content_length_over_the_limit_is_the_limit_problem(): void
    {
        config(['wgw.jmap.max_size_upload' => 8]);

        $this->upload('nine bytes', ['Content-Length' => '10'])
            ->assertStatus(400)
            ->assertHeader('Content-Type', 'application/problem+json')
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:limit')
            ->assertJsonPath('limit', 'maxSizeUpload');
        $this->assertSame(0, JmapBlob::query()->count());
    }

    public function test_body_over_the_limit_without_a_length_is_the_limit_problem(): void
    {
        config(['wgw.jmap.max_size_upload' => 8]);

        $this->upload('this body is far longer than eight bytes', ['Transfer-Encoding' => 'chunked'])
            ->assertStatus(400)
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:limit');
        $this->assertSame(0, JmapBlob::query()->count());
        $this->assertSame([], Storage::disk('wgw_data')->allFiles('jmap/tmp'));
    }

    public function test_front_controller_answers_an_oversized_post_with_413_post_too_large(): void
    {
        $process = new Process(
            [PHP_BINARY, '-d', 'post_max_size=1K', '-d', 'display_errors=0', base_path('public/index.php')],
            base_path(),
            ['CONTENT_LENGTH' => '4096', 'REQUEST_METHOD' => 'POST'],
        );
        $process->run();

        $this->assertSame(
            ['error' => 'Upload too large. Current server post_max_size is 1K.', 'code' => 'post_too_large'],
            json_decode($process->getOutput(), true),
        );
    }

    public function test_an_empty_body_with_a_declared_length_is_a_discarded_body_never_an_empty_part(): void
    {
        $this->upload('', ['Content-Length' => '5000'])
            ->assertStatus(400)
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:limit');

        $this->upload('', ['Wgw-Part-Length' => '5000'])
            ->assertStatus(400)
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:limit');

        $this->upload('', ['Transfer-Encoding' => 'chunked'])
            ->assertStatus(400)
            ->assertJsonPath('type', 'urn:ietf:params:jmap:error:limit');

        $this->assertSame(0, JmapBlob::query()->count());
    }

    public function test_a_real_empty_part_is_still_stored(): void
    {
        $this->upload('', ['Content-Length' => '0', 'Wgw-Part-Length' => '0'])
            ->assertStatus(201)
            ->assertJsonPath('size', 0);
    }

    public function test_wrong_declared_length_is_rejected_and_not_stored(): void
    {
        $response = $this->upload('truncated', ['Wgw-Part-Length' => '20'])
            ->assertStatus(400)
            ->assertHeader('Content-Type', 'application/problem+json')
            ->assertJsonPath('type', 'https://wegotworkspace.org/jmap/problem/part-mismatch')
            ->assertJsonPath('mismatch', ['length'])
            ->assertJsonPath('expectedLength', 20)
            ->assertJsonPath('receivedLength', 9);

        $this->assertNull($response->json('blobId'));
        $this->assertSame(0, JmapBlob::query()->count());
        $this->assertSame([], Storage::disk('wgw_data')->allFiles('jmap'));
    }

    public function test_wrong_declared_sha256_is_rejected_and_not_stored(): void
    {
        $this->upload('corrupted', ['Wgw-Part-Sha256' => hash('sha256', 'original')])
            ->assertStatus(400)
            ->assertJsonPath('type', 'https://wegotworkspace.org/jmap/problem/part-mismatch')
            ->assertJsonPath('mismatch', ['sha256'])
            ->assertJsonPath('receivedSha256', hash('sha256', 'corrupted'));
        $this->assertSame(0, JmapBlob::query()->count());
    }

    public function test_matching_declarations_are_accepted(): void
    {
        $this->upload('exact', ['Wgw-Part-Length' => '5', 'Wgw-Part-Sha256' => strtoupper(hash('sha256', 'exact'))])
            ->assertStatus(201)
            ->assertJsonPath('blobId', 'jb-'.substr(hash('sha256', 'exact'), 0, 40));
    }

    public function test_malformed_declarations_are_a_bad_request(): void
    {
        $this->upload('x', ['Wgw-Part-Length' => '-1'])->assertStatus(400)->assertJsonPath('type', 'about:blank');
        $this->upload('x', ['Wgw-Part-Sha256' => 'abc'])->assertStatus(400)->assertJsonPath('type', 'about:blank');
    }

    public function test_a_full_disk_answers_507_with_a_problem_body(): void
    {
        $root = (string) config('filesystems.disks.wgw_data.root');
        $adapter = new class($root) extends LocalFilesystemAdapter
        {
            public function writeStream(string $path, $contents, Config $config): void
            {
                throw UnableToWriteFile::atLocation($path, 'fwrite(): Write of 8192 bytes failed with errno=122 Disk quota exceeded');
            }
        };
        Storage::set('wgw_data', new FilesystemAdapter(new Filesystem($adapter), $adapter, ['throw' => true]));

        $this->upload('no room for this')
            ->assertStatus(507)
            ->assertHeader('Content-Type', 'application/problem+json')
            ->assertJsonPath('type', 'https://wegotworkspace.org/jmap/problem/insufficient-storage');
        $this->assertSame(0, JmapBlob::query()->count());
    }
}
