<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Notify;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\PushSubscriptionRequest;
use App\Services\Notify\VapidPushService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

final class PushSubscriptionsController
{
    public function __construct(private readonly VapidPushService $push) {}

    public function publicKey(): JsonResponse
    {
        return response()->json([
            'publicKey' => $this->push->publicKey(),
        ]);
    }

    public function store(PushSubscriptionRequest $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $row = $this->push->subscribe($principal['username'], $request->validated(), $request->userAgent());

        return response()->json([
            'id' => $row->id,
            'endpoint' => $row->endpoint,
        ], 201);
    }

    public function destroy(Request $request): Response
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $endpoint = (string) $request->input('endpoint', '');
        $this->push->unsubscribe($principal['username'], $endpoint);

        return response()->noContent();
    }
}
