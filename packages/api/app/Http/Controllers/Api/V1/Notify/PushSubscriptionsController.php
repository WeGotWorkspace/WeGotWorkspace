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
        $validated = $request->validated();
        $endpoint = $validated['endpoint'] ?? null;
        $keys = $validated['keys'] ?? null;
        $p256dh = is_array($keys) ? ($keys['p256dh'] ?? null) : null;
        $auth = is_array($keys) ? ($keys['auth'] ?? null) : null;
        if (! is_string($endpoint) || $endpoint === '' || ! is_string($p256dh) || $p256dh === '' || ! is_string($auth) || $auth === '') {
            abort(422, 'endpoint and keys are required.');
        }
        $row = $this->push->subscribe($principal['username'], [
            'endpoint' => $endpoint,
            'keys' => ['p256dh' => $p256dh, 'auth' => $auth],
        ], $request->userAgent());

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
