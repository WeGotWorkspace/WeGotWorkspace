<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Services\Notify\PushEndpointPolicy;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Push endpoints the server may send to; everything else is refused to stop SSRF (#1150, #1891). */
final class PushEndpointPolicyTest extends TestCase
{
    /**
     * @return iterable<string, array{string}>
     */
    public static function allowedEndpoints(): iterable
    {
        yield 'chrome stable' => ['https://fcm.googleapis.com/fcm/send/abc'];
        yield 'chrome stable webpush path' => ['https://fcm.googleapis.com/wp/abc'];
        yield 'chrome non-stable webpush path' => ['https://fcm.googleapis.com/preprod/wp/abc'];
        yield 'chrome beta, dev, canary' => ['https://jmt17.google.com/fcm/send/abc'];
        yield 'chrome beta, upper case host' => ['https://JMT17.Google.com/fcm/send/abc'];
        yield 'chrome beta, explicit 443' => ['https://jmt17.google.com:443/fcm/send/abc'];
        yield 'firefox' => ['https://updates.push.services.mozilla.com/wpush/v2/abc'];
        yield 'safari' => ['https://web.push.apple.com/abc'];
        yield 'edge' => ['https://wns2-par02p.notify.windows.com/w/?token=abc'];
    }

    #[DataProvider('allowedEndpoints')]
    public function test_allows_known_push_services(string $endpoint): void
    {
        $this->assertTrue((new PushEndpointPolicy)->isAllowed($endpoint));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function refusedEndpoints(): iterable
    {
        yield 'jmt17 over http' => ['http://jmt17.google.com/fcm/send/abc'];
        yield 'jmt17 other port' => ['https://jmt17.google.com:8443/fcm/send/abc'];
        yield 'jmt17 with credentials' => ['https://user:pass@jmt17.google.com/fcm/send/abc'];
        yield 'jmt17 subdomain' => ['https://x.jmt17.google.com/fcm/send/abc'];
        yield 'jmt17 prefix lookalike' => ['https://evil-jmt17.google.com/fcm/send/abc'];
        yield 'jmt17 as a subdomain of another host' => ['https://jmt17.google.com.evil.example/fcm/send/abc'];
        yield 'other jmt host' => ['https://jmt18.google.com/fcm/send/abc'];
        yield 'bare google.com' => ['https://google.com/fcm/send/abc'];
        yield 'other google.com host' => ['https://www.google.com/fcm/send/abc'];
        yield 'fcm lookalike' => ['https://evilfcm.googleapis.com/fcm/send/abc'];
        yield 'loopback' => ['https://127.0.0.1/push'];
        yield 'metadata service' => ['https://169.254.169.254/latest/meta-data'];
        yield 'unknown host' => ['https://evil.example/push'];
        yield 'not a url' => ['jmt17.google.com/fcm/send/abc'];
    }

    #[DataProvider('refusedEndpoints')]
    public function test_refuses_everything_else(string $endpoint): void
    {
        $this->assertFalse((new PushEndpointPolicy)->isAllowed($endpoint));
    }
}
