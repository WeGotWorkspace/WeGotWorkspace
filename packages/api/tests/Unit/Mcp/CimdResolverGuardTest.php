<?php

declare(strict_types=1);

namespace Tests\Unit\Mcp;

use App\Services\Mcp\CimdException;
use App\Services\Mcp\CimdResolver;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Exception\RequestException;
use GuzzleHttp\Psr7\Request;
use Illuminate\Http\Client\ConnectionException;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class CimdResolverGuardTest extends TestCase
{
    public function test_progress_abort_rejects_either_counter_past_the_cap(): void
    {
        CimdResolver::abortIfOversized(65536, 65536, 65536);

        foreach ([[65537, 0], [0, 65537]] as [$total, $downloaded]) {
            try {
                CimdResolver::abortIfOversized($total, $downloaded, 65536);
                $this->fail('expected a size-limit exception');
            } catch (CimdException $e) {
                $this->assertSame(400, $e->status());
                $this->assertStringContainsString('size limit', $e->getMessage());
            }
        }
    }

    public function test_fetch_failure_unwraps_cimd_and_only_curl_callback_aborts(): void
    {
        $size = new CimdException('CIMD metadata exceeds size limit.', 400);
        $unwrapped = CimdResolver::fetchFailure(new RuntimeException('wrapped', 0, $size));
        $this->assertSame($size, $unwrapped);

        $request = new Request('GET', 'https://metadata.example.test/client.json');
        $abort = defined('CURLE_ABORTED_BY_CALLBACK') ? CURLE_ABORTED_BY_CALLBACK : 42;
        $aborted = new RequestException('aborted', $request, null, null, ['errno' => $abort]);
        $fromAbort = CimdResolver::fetchFailure(new ConnectionException('wrapped', 0, $aborted));
        $this->assertSame(400, $fromAbort->status());
        $this->assertStringContainsString('size limit', $fromAbort->getMessage());

        $reset = new RequestException('reset', $request, null, null, ['errno' => 56]);
        $fromReset = CimdResolver::fetchFailure(new ConnectionException('wrapped', 0, $reset));
        $this->assertStringContainsString('could not be fetched', $fromReset->getMessage());

        $tls = new ConnectException('tls', $request, null, ['errno' => 35]);
        $fromTls = CimdResolver::fetchFailure(new ConnectionException('wrapped', 0, $tls));
        $this->assertStringContainsString('could not be fetched', $fromTls->getMessage());
    }

    public function test_ipv6_throttle_keys_use_the_64_prefix_and_mapped_ipv4_stays_whole(): void
    {
        $this->assertSame(
            CimdResolver::requesterThrottleKey('198.51.100.10'),
            CimdResolver::requesterThrottleKey('::ffff:198.51.100.10'),
        );
        $this->assertNotSame(
            CimdResolver::requesterThrottleKey('198.51.100.10'),
            CimdResolver::requesterThrottleKey('198.51.100.11'),
        );
        $this->assertSame(
            CimdResolver::requesterThrottleKey('2001:db8:1:2::1'),
            CimdResolver::requesterThrottleKey('2001:db8:1:2::abcd'),
        );
        $this->assertNotSame(
            CimdResolver::requesterThrottleKey('2001:db8:1:2::1'),
            CimdResolver::requesterThrottleKey('2001:db8:1:3::1'),
        );
    }

    public function test_http_options_pin_curl_resolve_and_do_not_stream(): void
    {
        $options = CimdResolver::httpOptions('metadata.example.test', 443, '2001:4860:4860::8888', 65536);

        $this->assertSame(['https'], $options['protocols']);
        $this->assertArrayNotHasKey('stream', $options);
        $this->assertSame(
            ['metadata.example.test:443:[2001:4860:4860::8888]'],
            $options['curl'][CURLOPT_RESOLVE],
        );
        $this->assertArrayNotHasKey(CURLOPT_PROTOCOLS, $options['curl']);
        $this->assertSame(
            'metadata.example.test:443:203.0.113.10',
            CimdResolver::curlResolveEntry('metadata.example.test', 443, '203.0.113.10'),
        );
    }
}
