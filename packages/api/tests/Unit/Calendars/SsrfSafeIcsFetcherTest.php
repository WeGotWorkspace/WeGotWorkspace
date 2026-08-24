<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Exceptions\ApiHttpException;
use App\Services\Calendars\SsrfSafeIcsFetcher;
use App\Services\VObject\VObjectPayloadGuard;
use Tests\Support\FakeHostIpResolver;
use Tests\TestCase;

final class SsrfSafeIcsFetcherTest extends TestCase
{
    public function test_normalizes_webcal_to_https(): void
    {
        $fetcher = $this->fetcher();

        $this->assertSame(
            'https://feeds.example.test/cal.ics',
            $fetcher->normalizeUrl('webcal://feeds.example.test/cal.ics'),
        );
        $this->assertSame(
            'https://feeds.example.test/cal.ics',
            $fetcher->normalizeUrl('webcals://feeds.example.test/cal.ics'),
        );
    }

    public function test_rejects_private_loopback_and_metadata_hosts(): void
    {
        $fetcher = $this->fetcher();

        foreach ([
            'http://127.0.0.1/x.ics',
            'http://localhost/x.ics',
            'http://10.0.0.8/x.ics',
            'http://192.168.1.9/x.ics',
            'http://169.254.169.254/latest/meta-data',
            'http://[::1]/x.ics',
        ] as $url) {
            try {
                $fetcher->assertSafeUrl($url);
                $this->fail('Expected SSRF rejection for '.$url);
            } catch (ApiHttpException $exception) {
                $this->assertSame(400, $exception->getStatusCode());
            }
        }
    }

    public function test_accepts_a_public_resolved_host(): void
    {
        $fetcher = $this->fetcher();
        $fetcher->assertSafeUrl('https://feeds.example.test/cal.ics');
        $this->addToAssertionCount(1);
    }

    private function fetcher(): SsrfSafeIcsFetcher
    {
        $dns = (new FakeHostIpResolver)
            ->map('feeds.example.test', ['93.184.216.34'])
            ->map('localhost', ['127.0.0.1']);

        return new SsrfSafeIcsFetcher($dns, new VObjectPayloadGuard);
    }
}
