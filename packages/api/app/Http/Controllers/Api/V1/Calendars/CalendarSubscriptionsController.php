<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Calendars;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\CalendarSubscriptionCreateRequest;
use App\Http\Resources\Api\V1\CalendarSubscriptionResource;
use App\Services\Calendars\CalendarSubscriptionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

final class CalendarSubscriptionsController
{
    public function __construct(private readonly CalendarSubscriptionService $subscriptions) {}

    public function index(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json([
            'list' => CalendarSubscriptionResource::collection(
                $this->subscriptions->list($principal['username']),
            )->resolve(),
        ]);
    }

    public function store(CalendarSubscriptionCreateRequest $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $subscription = $this->subscriptions->create($principal['username'], $request->validated());

        return (new CalendarSubscriptionResource($subscription))
            ->response()
            ->setStatusCode(201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (new CalendarSubscriptionResource(
            $this->subscriptions->show($principal['username'], $id),
        ))->response();
    }

    public function refresh(Request $request, string $id): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (new CalendarSubscriptionResource(
            $this->subscriptions->refresh($principal['username'], $id),
        ))->response();
    }

    public function destroy(Request $request, string $id): Response
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $this->subscriptions->destroy($principal['username'], $id);

        return response()->noContent();
    }
}
