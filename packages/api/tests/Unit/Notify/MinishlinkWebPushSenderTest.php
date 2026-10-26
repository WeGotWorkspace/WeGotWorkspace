<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Services\Notify\MinishlinkWebPushSender;
use App\Services\Notify\PushFailureTally;
use App\Services\Notify\WebPushSender;
use GuzzleHttp\Psr7\Response;
use Psr\Http\Client\ClientExceptionInterface;
use Psr\Http\Message\RequestInterface;
use Tests\Support\FakesPushService;
use Tests\TestCase;

final class MinishlinkWebPushSenderTest extends TestCase
{
    use FakesPushService;

    private const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/secret-capability-token';

    private const ENDPOINT_SECRET = 'secret-capability-token';

    protected function setUp(): void
    {
        parent::setUp();
        $this->captureLogs();
    }

    public function test_gmp_recommendation_is_ignorable(): void
    {
        $this->assertTrue(MinishlinkWebPushSender::isIgnorableCalculatorWarning(
            'It is highly recommended to install the GMP or BCMath extension to speed up calculations. The fastest available calculator implementation will be automatically selected at runtime.',
        ));
        $this->assertFalse(MinishlinkWebPushSender::isIgnorableCalculatorWarning('VAPID authentication failed'));
    }

    public function test_rejected_send_logs_status_reason_and_host_only(): void
    {
        $tally = new PushFailureTally;
        $sender = $this->senderAnswering($tally, static fn (): Response => new Response(
            403,
            [],
            "{\"reason\":\"the key in the authorization header does not correspond\",\n \"url\":\"".self::ENDPOINT.'"}',
        ));

        $this->assertSame(403, $this->sendOne($sender));

        $lines = $this->logsNamed('vapid_send_rejected');
        $this->assertCount(1, $lines);
        $this->assertSame('warning', $lines[0]->level);
        $this->assertSame(403, $lines[0]->context['status']);
        $this->assertSame('fcm.googleapis.com', $lines[0]->context['host']);
        $this->assertSame('Forbidden', $lines[0]->context['reason']);
        $this->assertStringContainsString('does not correspond', $lines[0]->context['body']);
        $this->assertStringContainsString('https://fcm.googleapis.com/…', $lines[0]->context['body']);
        $this->assertStringNotContainsString(self::ENDPOINT_SECRET, $this->allLoggedText());
        $this->assertSame(
            ['failed' => 1, 'by_status' => [403 => 1], 'by_host' => ['fcm.googleapis.com' => 1]],
            $tally->summary(),
        );
    }

    public function test_long_response_body_is_truncated_to_one_line(): void
    {
        $sender = $this->senderAnswering(new PushFailureTally, static fn (): Response => new Response(
            413,
            [],
            "<html>\n".str_repeat('Payload too large. ', 100).'</html>',
        ));

        $this->assertSame(413, $this->sendOne($sender));

        $body = $this->logsNamed('vapid_send_rejected')[0]->context['body'];
        $this->assertLessThanOrEqual(303, mb_strlen($body));
        $this->assertStringNotContainsString("\n", $body);
    }

    public function test_expired_subscription_logs_at_info(): void
    {
        $sender = $this->senderAnswering(new PushFailureTally, static fn (): Response => new Response(410));

        $this->assertSame(410, $this->sendOne($sender));

        $lines = $this->logsNamed('vapid_send_rejected');
        $this->assertCount(1, $lines);
        $this->assertSame('info', $lines[0]->level);
        $this->assertSame(410, $lines[0]->context['status']);
        $this->assertArrayNotHasKey('body', $lines[0]->context);
    }

    public function test_transport_failure_logs_host_not_endpoint(): void
    {
        $tally = new PushFailureTally;
        $sender = $this->senderAnswering($tally, static function (RequestInterface $request): Response {
            throw new class('cURL error 28: Operation timed out for '.$request->getUri()) extends \RuntimeException implements ClientExceptionInterface {};
        });

        $this->assertSame(0, $this->sendOne($sender));

        $lines = $this->logsNamed('vapid_send_rejected');
        $this->assertCount(1, $lines);
        $this->assertSame(0, $lines[0]->context['status']);
        $this->assertSame('cURL error 28: Operation timed out for https://fcm.googleapis.com/…', $lines[0]->context['reason']);
        $this->assertStringNotContainsString(self::ENDPOINT_SECRET, $this->allLoggedText());
        $this->assertSame([0 => 1], $tally->summary()['by_status']);
    }

    public function test_thrown_exception_logs_host_not_endpoint(): void
    {
        $tally = new PushFailureTally;
        $sender = $this->senderAnswering($tally, static function (): Response {
            throw new \LogicException('Unexpected failure posting to '.self::ENDPOINT);
        });

        $this->assertSame(0, $this->sendOne($sender));

        $lines = $this->logsNamed('vapid_send_failed');
        $this->assertCount(1, $lines);
        $this->assertSame('fcm.googleapis.com', $lines[0]->context['host']);
        $this->assertArrayNotHasKey('endpoint', $lines[0]->context);
        $this->assertSame(\LogicException::class, $lines[0]->context['exception']);
        $this->assertStringNotContainsString(self::ENDPOINT_SECRET, $this->allLoggedText());
        $this->assertTrue($tally->hasFailures());
    }

    public function test_accepted_send_logs_nothing(): void
    {
        $tally = new PushFailureTally;
        $sender = $this->senderAnswering($tally, static fn (): Response => new Response(201));

        $this->assertSame(201, $this->sendOne($sender));

        $this->assertSame([], $this->logsNamed('vapid_send_rejected'));
        $this->assertSame([], $this->logsNamed('vapid_send_failed'));
        $this->assertFalse($tally->hasFailures());
    }

    public function test_container_sender_uses_default_client_and_shared_tally(): void
    {
        $sender = $this->app->make(WebPushSender::class);
        $this->assertInstanceOf(MinishlinkWebPushSender::class, $sender);

        $client = new \ReflectionProperty($sender, 'httpClient');
        $this->assertNull($client->getValue($sender));
        $tally = new \ReflectionProperty($sender, 'failures');
        $this->assertSame($this->app->make(PushFailureTally::class), $tally->getValue($sender));
    }

    public function test_endpoint_host_falls_back_for_unparseable_endpoints(): void
    {
        $this->assertSame('web.push.apple.com', MinishlinkWebPushSender::endpointHost(' https://Web.Push.Apple.com/abc '));
        $this->assertSame('invalid-endpoint', MinishlinkWebPushSender::endpointHost('not a url'));
    }

    /**
     * @param  \Closure(RequestInterface): Response  $answer
     */
    private function senderAnswering(PushFailureTally $tally, \Closure $answer): MinishlinkWebPushSender
    {
        return new MinishlinkWebPushSender($tally, $this->pushServiceAnswering($answer));
    }

    private function sendOne(MinishlinkWebPushSender $sender): int
    {
        $keys = $this->subscriptionKeys();

        return $sender->send(self::ENDPOINT, $keys['p256dh'], $keys['auth'], '{"title":"Hi"}', $this->vapidKeys());
    }
}
