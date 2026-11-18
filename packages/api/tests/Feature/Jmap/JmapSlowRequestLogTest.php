<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A slow JMAP call or upload logs `jmap.slow_request` with its method names
 * and its database and storage time, and nothing of its content (#2244).
 */
final class JmapSlowRequestLogTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    /** @var list<array{message: string, context: array<string, mixed>}> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config(['wgw.jmap.maintenance_share' => 0]);
        Log::listen(function ($event): void {
            $this->logged[] = ['message' => $event->message, 'context' => $event->context];
        });
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_a_slow_jmap_call_logs_its_methods_and_time_split_without_content(): void
    {
        config(['wgw.slow_request_log_ms' => 1]);

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE],
            'methodCalls' => [
                ['Core/echo', ['secret-note' => 'private words'], 'c0'],
                ['Nope/unknown', ['other' => 'private too'], 'c1'],
            ],
        ])->assertOk();

        $context = $this->slowRequest();
        $this->assertSame('api/v1/jmap', $context['route']);
        $this->assertSame(200, $context['status']);
        $this->assertLessThan(60_000, $context['ms'], 'timed from the request start, not the PHP process start');
        $this->assertGreaterThan(0, $context['db_queries'], 'the bearer check reads the database');
        foreach (['ms', 'db_ms', 'db_commit_ms', 'storage_ms', 'storage_ops', 'other_ms'] as $key) {
            $this->assertIsInt($context[$key], $key);
        }
        $this->assertSame(max(0, $context['ms'] - $context['db_ms'] - $context['storage_ms']), $context['other_ms']);
        // Only registered methods are timed: an unknown name from the caller never reaches the log.
        $this->assertSame(['Core/echo'], array_column($context['methods'], 'name'));
        $this->assertSame(['name', 'ms', 'db_ms', 'storage_ms'], array_keys($context['methods'][0]));

        $json = (string) json_encode($context);
        $this->assertStringNotContainsString('private', $json);
        $this->assertStringNotContainsString('Nope', $json);
        $this->assertStringNotContainsString('bob', $json);
    }

    public function test_a_slow_upload_logs_its_storage_time_and_size_but_not_the_account(): void
    {
        config(['wgw.slow_request_log_ms' => 1]);

        $this->upload('some bytes of a file')->assertStatus(201);

        $context = $this->slowRequest();
        $this->assertSame('api/v1/jmap/upload/{accountId}', $context['route']);
        $this->assertSame(201, $context['status']);
        $this->assertSame(strlen('some bytes of a file'), $context['request_bytes']);
        $this->assertGreaterThan(0, $context['storage_ops'], 'the upload writes and moves the blob on the wgw_data disk');
        $this->assertSame([], $context['methods']);
        $this->assertStringNotContainsString('bob', (string) json_encode($context));
    }

    public function test_a_request_under_the_threshold_logs_nothing(): void
    {
        config(['wgw.slow_request_log_ms' => 600_000]);

        $this->upload('quick')->assertStatus(201);

        $this->assertSame([], $this->slowRequests());
    }

    public function test_zero_turns_the_log_off(): void
    {
        config(['wgw.slow_request_log_ms' => 0]);

        $this->upload('quick')->assertStatus(201);

        $this->assertSame([], $this->slowRequests());
    }

    /** @return TestResponse<Response> */
    private function upload(string $content): TestResponse
    {
        return $this->call(
            'POST',
            '/api/v1/jmap/upload/bob',
            server: $this->transformHeadersToServerVars([
                'Authorization' => 'Bearer '.$this->userBearerToken(),
                'Content-Type' => 'application/octet-stream',
                'Content-Length' => (string) strlen($content),
            ]),
            content: $content,
        );
    }

    /** @return array<string, mixed> */
    private function slowRequest(): array
    {
        $found = $this->slowRequests();
        $this->assertCount(1, $found);

        return $found[0];
    }

    /** @return list<array<string, mixed>> */
    private function slowRequests(): array
    {
        return array_values(array_map(
            static fn (array $entry): array => $entry['context'],
            array_filter($this->logged, static fn (array $entry): bool => $entry['message'] === 'jmap.slow_request'),
        ));
    }
}
