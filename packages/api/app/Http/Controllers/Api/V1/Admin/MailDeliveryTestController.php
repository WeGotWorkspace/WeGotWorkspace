<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\AdminMailDeliveryTestRequest;
use App\Models\Principal;
use App\Services\MailDelivery\InvalidOutboundMessageException;
use App\Services\MailDelivery\MailDeliveryService;
use App\Services\MailDelivery\MailDeliveryTestSendRateLimiter;
use App\Services\MailDelivery\OutboundMessage;
use Illuminate\Http\JsonResponse;

final class MailDeliveryTestController
{
    public function __construct(
        private MailDeliveryService $delivery,
        private MailDeliveryTestSendRateLimiter $rateLimiter,
    ) {}

    public function __invoke(AdminMailDeliveryTestRequest $request): JsonResponse
    {
        /** @var array{username: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $ip = (string) $request->ip();
        if (! $this->rateLimiter->allow($principal['username'], $ip)) {
            throw new ApiHttpException(429, 'Too many email delivery tests. Please try again later.', 'throttled');
        }

        $to = $request->recipient();
        if ($to === '') {
            $row = Principal::forUsername($principal['username']);
            $to = trim((string) ($row?->email ?? ''));
        }

        $config = $this->delivery->loadConfig();
        $message = new OutboundMessage(
            from: $config->effectiveFrom(),
            to: $to !== '' ? [$to] : [],
            subject: 'WeGotWorkspace email delivery test',
            textBody: 'This is a test message from your WeGotWorkspace instance. Acceptance by the transport does not mean the message reached an inbox.',
        );

        try {
            return response()->json($this->delivery->recordTestSend($message, $config));
        } catch (InvalidOutboundMessageException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        }
    }
}
