<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Notify;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\NotificationIdBatchRequest;
use App\Http\Resources\Api\V1\NotificationResource;
use App\Services\Notify\NotificationInboxService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class NotificationsController
{
    public function __construct(private readonly NotificationInboxService $inbox) {}

    public function index(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $unreadOnly = $request->boolean('unread');
        $payload = $this->inbox->list($principal['username'], $unreadOnly);

        return response()->json([
            'list' => NotificationResource::collection(collect($payload['list']))->resolve(),
            'unreadCount' => $payload['unreadCount'],
        ]);
    }

    public function ack(Request $request, string $id): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (new NotificationResource(
            $this->inbox->ack($principal['username'], $id),
        ))->response();
    }

    /** Mark many rows read in one request (#2154); see {@see NotificationInboxService::ackMany}. */
    public function ackBatch(NotificationIdBatchRequest $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $this->inbox->ackMany($principal['username'], $request->ids());

        return response()->json(['ok' => true]);
    }

    public function ackLocal(Request $request, string $id): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $this->inbox->ackLocalDelivery($principal['username'], $id);

        return response()->json(['ok' => true]);
    }

    public function ackLocalBatch(NotificationIdBatchRequest $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $this->inbox->ackLocalDeliveries($principal['username'], $request->ids());

        return response()->json(['ok' => true]);
    }
}
