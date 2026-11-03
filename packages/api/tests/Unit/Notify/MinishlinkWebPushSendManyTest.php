<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Services\Notify\MinishlinkWebPushSender;
use App\Services\Notify\PushFailureTally;
use App\Services\Notify\WebPushMessage;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use Tests\Support\FakesPushService;
use Tests\TestCase;

/**
 * Urgent send (#1670): every message at once, one hard deadline.
 */
final class MinishlinkWebPushSendManyTest extends TestCase
{
    use FakesPushService;

    protected function setUp(): void
    {
        parent::setUp();
        $this->captureLogs();
    }

    public function test_answers_map_to_statuses_in_message_order(): void
    {
        $history = [];
        $stack = HandlerStack::create(new MockHandler([
            new Response(201),
            new Response(410),
            new ConnectException('timed out', new Request('POST', 'https://fcm.googleapis.com/fcm/send/c')),
        ]));
        $stack->push(Middleware::history($history));
        $tally = new PushFailureTally;
        $sender = new MinishlinkWebPushSender($tally, null, new Client(['handler' => $stack]));

        $statuses = $sender->sendMany([
            $this->message('https://fcm.googleapis.com/fcm/send/a'),
            $this->message('https://fcm.googleapis.com/fcm/send/b'),
            $this->message('https://fcm.googleapis.com/fcm/send/c'),
        ], $this->vapidKeys(), 1.5);

        $this->assertSame([201, 410, 0], $statuses);
        $this->assertCount(3, $history);
        foreach ($history as $entry) {
            // Each request may only use what is left of the one deadline.
            $this->assertGreaterThan(0, $entry['options']['timeout']);
            $this->assertLessThanOrEqual(1.5, $entry['options']['timeout']);
            $this->assertSame($entry['options']['timeout'], $entry['options']['connect_timeout']);
            $this->assertNotSame('', $entry['request']->getHeaderLine('Content-Encoding'), 'The payload is encrypted.');
            $this->assertStringStartsWith('WebPush ', $entry['request']->getHeaderLine('Authorization'));
        }
        $this->assertSame(['failed' => 2, 'by_status' => ['no_response' => 1, 410 => 1], 'by_host' => ['fcm.googleapis.com' => 2]], $tally->summary());
    }

    public function test_slow_push_services_are_waited_for_in_parallel_up_to_the_deadline(): void
    {
        // Accepts connections but never answers: every send runs into the deadline.
        $server = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        $this->assertNotFalse($server, $error);
        $address = (string) stream_socket_get_name($server, false);
        $sender = new MinishlinkWebPushSender(new PushFailureTally);
        $messages = [];
        for ($i = 0; $i < 5; $i++) {
            $messages[] = $this->message('http://'.$address.'/push/'.$i);
        }

        $started = microtime(true);
        $statuses = $sender->sendMany($messages, $this->vapidKeys(), 0.4);
        $elapsed = microtime(true) - $started;
        fclose($server);

        $this->assertSame([0, 0, 0, 0, 0], $statuses);
        $this->assertGreaterThanOrEqual(0.35, $elapsed);
        // One after the other would take 5 × 0.4 s.
        $this->assertLessThan(1.0, $elapsed, 'The sends must run in parallel under one deadline.');
    }

    public function test_nothing_is_sent_once_the_deadline_has_passed(): void
    {
        $history = [];
        $stack = HandlerStack::create(new MockHandler([new Response(201)]));
        $stack->push(Middleware::history($history));
        $sender = new MinishlinkWebPushSender(new PushFailureTally, null, new Client(['handler' => $stack]));

        $statuses = $sender->sendMany([$this->message('https://fcm.googleapis.com/fcm/send/a')], $this->vapidKeys(), 0.0);

        $this->assertSame([0], $statuses);
        $this->assertSame([], $history);
    }

    public function test_no_messages_sends_nothing(): void
    {
        $this->assertSame([], (new MinishlinkWebPushSender(new PushFailureTally))->sendMany([], $this->vapidKeys(), 1.5));
    }

    private function message(string $endpoint): WebPushMessage
    {
        $keys = $this->subscriptionKeys();

        return new WebPushMessage($endpoint, $keys['p256dh'], $keys['auth'], '{"title":"Alice started a meeting"}');
    }
}
