<?php

declare(strict_types=1);

namespace App\Services\Notify;

use Minishlink\WebPush\MessageSentReport;
use Minishlink\WebPush\WebPush;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * The library's own encryption and VAPID headers, without its sequential
 * `flush()`: {@see MinishlinkWebPushSender::sendMany()} sends the prepared
 * requests in parallel itself.
 */
final class PreparedWebPush extends WebPush
{
    /**
     * Encrypted requests for every queued notification, in queue order. Empties the queue.
     *
     * @return list<RequestInterface>
     */
    public function takePreparedRequests(): array
    {
        $queued = $this->notifications ?? [];
        $this->notifications = [];

        return array_values($this->prepare($queued));
    }

    public function reportFor(RequestInterface $request, ResponseInterface $response): MessageSentReport
    {
        return $this->createReport($request, $response);
    }
}
