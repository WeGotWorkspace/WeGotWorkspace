<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use Symfony\Component\Process\Process;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * Contract C7: the Yjs sidecar carries an ETag, and a save without a current
 * precondition is refused with 412 instead of overwriting concurrent work.
 */
final class CollabDocumentEtagTest extends WgwDatabaseTestCase
{
    private const ROOM = '/users/alice/docs/together.md';

    private const SIDECAR_STORAGE_PATH = 'users/alice/docs/.together.md.yjs';

    private const STALE_ETAG = '"sidecar-rev-does-not-match"';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->dataDir = storage_path('framework/testing/wgw-collab-etag-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/files/users/alice/docs');
        WgwTestDisks::refresh($this->dataDir);
        $this->configureWgwJwtKeys();

        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }

        parent::tearDown();
    }

    public function test_yjs_get_returns_the_etag_of_the_sidecar_bytes(): void
    {
        $token = $this->issueBearerToken();
        $yjsBytes = [1, 2, 3, 255];

        $this->withBearer($token)
            ->putJson($this->collaborationUrl(), ['markdown' => "# Doc\n", 'yjs' => $yjsBytes])
            ->assertOk();

        $this->withBearer($token)
            ->get($this->collaborationUrl().'&format=yjs')
            ->assertOk()
            ->assertHeader('ETag', $this->expectedEtag("\x01\x02\x03\xff"));
    }

    public function test_yjs_get_without_a_sidecar_is_204_without_an_etag(): void
    {
        $response = $this->withBearer($this->issueBearerToken())
            ->get($this->collaborationUrl().'&format=yjs');

        $response->assertNoContent();
        $this->assertFalse(
            $response->headers->has('ETag'),
            'A 204 means "no sidecar" and must not carry an ETag.'
        );
    }

    public function test_successful_put_returns_the_new_etag(): void
    {
        $response = $this->withBearer($this->issueBearerToken())
            ->putJson($this->collaborationUrl(), ['markdown' => "# Doc\n", 'yjs' => [1, 2, 3]]);

        $response->assertOk();
        $response->assertHeader('ETag', $this->expectedEtag("\x01\x02\x03"));
    }

    public function test_put_with_a_matching_if_match_succeeds(): void
    {
        $token = $this->issueBearerToken();
        $this->withBearer($token)
            ->putJson($this->collaborationUrl(), ['markdown' => "# One\n", 'yjs' => [1]])
            ->assertOk();

        $etag = $this->expectedEtag("\x01");

        $this->withBearer($token)
            ->putJson(
                $this->collaborationUrl(),
                ['markdown' => "# Two\n", 'yjs' => [2]],
                ['If-Match' => $etag],
            )
            ->assertOk()
            ->assertHeader('ETag', $this->expectedEtag("\x02"));
    }

    public function test_put_with_a_stale_if_match_is_refused_with_412(): void
    {
        $token = $this->issueBearerToken();
        $this->withBearer($token)
            ->putJson($this->collaborationUrl(), ['markdown' => "# One\n", 'yjs' => [1]])
            ->assertOk();

        $this->withBearer($token)
            ->putJson(
                $this->collaborationUrl(),
                ['markdown' => "# Overwritten\n", 'yjs' => [9]],
                ['If-Match' => self::STALE_ETAG],
            )
            ->assertStatus(412)
            ->assertJsonPath('error', 'precondition_failed');
    }

    public function test_a_refused_put_leaves_the_stored_document_untouched(): void
    {
        $token = $this->issueBearerToken();
        $this->withBearer($token)
            ->putJson($this->collaborationUrl(), ['markdown' => "# One\n", 'yjs' => [1]])
            ->assertOk();

        $this->withBearer($token)
            ->putJson(
                $this->collaborationUrl(),
                ['markdown' => "# Overwritten\n", 'yjs' => [9]],
                ['If-Match' => self::STALE_ETAG],
            )
            ->assertStatus(412);

        $storage = app(WgwStorage::class)->files();
        $stored = (string) $storage->get('users/alice/docs/together.md');
        $this->assertStringContainsString('# One', $stored);
        $this->assertStringNotContainsString('Overwritten', $stored);
        $this->assertSame("\x01", (string) $storage->get(self::SIDECAR_STORAGE_PATH));
    }

    public function test_put_with_if_none_match_star_succeeds_when_there_is_no_sidecar(): void
    {
        $this->withBearer($this->issueBearerToken())
            ->putJson(
                $this->collaborationUrl(),
                ['markdown' => "# First\n", 'yjs' => [1]],
                ['If-None-Match' => '*'],
            )
            ->assertOk()
            ->assertHeader('ETag', $this->expectedEtag("\x01"));
    }

    public function test_put_with_if_none_match_star_is_refused_when_a_sidecar_exists(): void
    {
        $token = $this->issueBearerToken();
        $this->withBearer($token)
            ->putJson($this->collaborationUrl(), ['markdown' => "# One\n", 'yjs' => [1]])
            ->assertOk();

        $this->withBearer($token)
            ->putJson(
                $this->collaborationUrl(),
                ['markdown' => "# Second seed\n", 'yjs' => [2]],
                ['If-None-Match' => '*'],
            )
            ->assertStatus(412)
            ->assertJsonPath('error', 'precondition_failed');
    }

    public function test_yjs_get_returns_304_when_if_none_match_still_matches(): void
    {
        $token = $this->issueBearerToken();
        $this->withBearer($token)
            ->putJson($this->collaborationUrl(), ['markdown' => "# Doc\n", 'yjs' => [1, 2, 3]])
            ->assertOk();

        $etag = $this->expectedEtag("\x01\x02\x03");
        $response = $this->withBearer($token)->get(
            $this->collaborationUrl().'&format=yjs',
            ['If-None-Match' => $etag],
        );

        $response->assertStatus(304);
        $response->assertHeader('ETag', $etag);
        $this->assertSame('', $response->getContent());
    }

    public function test_a_held_lock_blocks_the_first_open_until_the_other_writer_finishes(): void
    {
        $lockPath = app(WgwStorage::class)->files()->path(self::SIDECAR_STORAGE_PATH.'.lock');
        $flag = $this->dataDir.'/lock-held';
        $script = $this->dataDir.'/hold-lock.php';
        file_put_contents($script, <<<'PHP'
<?php
$handle = fopen($argv[1], 'c');
if ($handle === false || ! flock($handle, LOCK_EX)) {
    fwrite(STDERR, "lock failed\n");
    exit(1);
}
file_put_contents($argv[2], 'held');
usleep(1200000);
flock($handle, LOCK_UN);
fclose($handle);
PHP);
        $process = new Process([PHP_BINARY, $script, $lockPath, $flag]);
        $process->start();

        $deadline = microtime(true) + 5;
        while (! is_file($flag) && microtime(true) < $deadline) {
            usleep(20000);
        }
        $this->assertFileExists($flag, $process->getErrorOutput());

        $token = $this->issueBearerToken();
        $started = microtime(true);
        $this->withBearer($token)
            ->putJson(
                $this->collaborationUrl(),
                ['markdown' => "# First\n", 'yjs' => [1]],
                ['If-None-Match' => '*'],
            )
            ->assertOk();
        $this->assertGreaterThan(
            0.8,
            microtime(true) - $started,
            'The first open must wait on the sidecar lock instead of racing the other writer.',
        );
        $process->wait();

        $this->withBearer($token)
            ->putJson(
                $this->collaborationUrl(),
                ['markdown' => "# Second\n", 'yjs' => [2]],
                ['If-None-Match' => '*'],
            )
            ->assertStatus(412);
    }

    public function test_put_without_a_precondition_is_still_accepted(): void
    {
        $token = $this->issueBearerToken();
        $this->withBearer($token)
            ->putJson($this->collaborationUrl(), ['markdown' => "# One\n", 'yjs' => [1]])
            ->assertOk();

        // Old clients send no precondition at all and must keep working.
        $this->withBearer($token)
            ->putJson($this->collaborationUrl(), ['markdown' => "# Two\n", 'yjs' => [2]])
            ->assertOk();
    }

    public function test_a_markdown_only_put_is_not_blocked_by_a_sidecar_precondition(): void
    {
        $token = $this->issueBearerToken();
        $this->withBearer($token)
            ->putJson($this->collaborationUrl(), ['markdown' => "# One\n", 'yjs' => [1]])
            ->assertOk();

        $this->withBearer($token)
            ->putJson(
                $this->collaborationUrl(),
                ['markdown' => "# Two\n"],
                ['If-Match' => $this->expectedEtag("\x01")],
            )
            ->assertOk();
    }

    private function collaborationUrl(): string
    {
        return '/api/v1/files/collaboration?path='.urlencode(self::ROOM);
    }

    /** C7: the ETag is the sha1 of the stored sidecar bytes. */
    private function expectedEtag(string $sidecarBytes): string
    {
        return '"'.sha1($sidecarBytes).'"';
    }
}
