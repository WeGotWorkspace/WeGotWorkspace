<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Exceptions\ApiHttpException;
use App\Services\Calendars\SsrfSafeIcsFetcher;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Support\Facades\Http;
use Tests\Support\FakeHostIpResolver;
use Tests\Support\SequentialHostIpResolver;
use Tests\TestCase;

final class SsrfSafeIcsFetcherTest extends TestCase
{
    private const PUBLIC_IP = '93.184.216.34';

    private const OTHER_PUBLIC_IP = '198.51.100.10';

    private const PRIVATE_IP = '127.0.0.1';

    private const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

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
        $this->assertSame([self::PUBLIC_IP], $fetcher->assertSafeUrl('https://feeds.example.test/cal.ics'));
    }

    public function test_pins_http_client_to_first_validated_ip_and_does_not_resolve_again(): void
    {
        $dns = (new SequentialHostIpResolver)
            ->queue('feeds.example.test', [self::PUBLIC_IP], [self::PRIVATE_IP]);
        $pins = [];
        Http::preventStrayRequests();
        Http::fake(function ($request, array $options) use (&$pins) {
            $pins[] = $options['curl'][CURLOPT_RESOLVE] ?? [];

            return Http::response(self::ICS, 200);
        });

        $body = (new SsrfSafeIcsFetcher($dns, new VObjectPayloadGuard))
            ->fetch('https://feeds.example.test/cal.ics');

        $this->assertSame(self::ICS, $body);
        $this->assertSame(1, $dns->resolveCount('feeds.example.test'));
        $this->assertCount(1, $pins);
        $this->assertSame(['feeds.example.test:443:'.self::PUBLIC_IP], $pins[0]);
    }

    public function test_pins_each_redirect_hop_to_that_hop_first_validated_ip(): void
    {
        $dns = (new SequentialHostIpResolver)
            ->queue('feeds.example.test', [self::PUBLIC_IP], [self::PRIVATE_IP])
            ->queue('other.example.test', [self::OTHER_PUBLIC_IP], [self::PRIVATE_IP]);
        $pins = [];
        Http::preventStrayRequests();
        Http::fake(function ($request, array $options) use (&$pins) {
            $pins[] = $options['curl'][CURLOPT_RESOLVE] ?? [];
            $url = (string) $request->url();
            if (str_contains($url, 'feeds.example.test')) {
                return Http::response('', 302, [
                    'Location' => 'https://other.example.test/cal.ics',
                ]);
            }

            return Http::response(self::ICS, 200);
        });

        $body = (new SsrfSafeIcsFetcher($dns, new VObjectPayloadGuard))
            ->fetch('https://feeds.example.test/cal.ics');

        $this->assertSame(self::ICS, $body);
        $this->assertSame(1, $dns->resolveCount('feeds.example.test'));
        $this->assertSame(1, $dns->resolveCount('other.example.test'));
        $this->assertCount(2, $pins);
        $this->assertSame(['feeds.example.test:443:'.self::PUBLIC_IP], $pins[0]);
        $this->assertSame(['other.example.test:443:'.self::OTHER_PUBLIC_IP], $pins[1]);
    }

    public function test_caps_redirect_hops(): void
    {
        Http::preventStrayRequests();
        Http::fake([
            'https://feeds.example.test/*' => Http::response('', 302, [
                'Location' => 'https://feeds.example.test/next.ics',
            ]),
        ]);

        try {
            $this->fetcher()->fetch('https://feeds.example.test/cal.ics');
            $this->fail('Expected redirect-cap rejection');
        } catch (ApiHttpException $exception) {
            $this->assertSame(400, $exception->getStatusCode());
            $this->assertStringContainsString('too many times', $exception->getMessage());
        }
    }

    private function fetcher(): SsrfSafeIcsFetcher
    {
        $dns = (new FakeHostIpResolver)
            ->map('feeds.example.test', [self::PUBLIC_IP])
            ->map('localhost', ['127.0.0.1']);

        return new SsrfSafeIcsFetcher($dns, new VObjectPayloadGuard);
    }
}
