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
        $validated = $request->validated();
        $url = $validated['url'] ?? null;
        if (! is_string($url) || $url === '') {
            abort(422, 'url is required.');
        }
        $payload = ['url' => $url];
        if (array_key_exists('name', $validated) && is_string($validated['name'])) {
            $payload['name'] = $validated['name'];
        }
        if (array_key_exists('color', $validated)) {
            $color = $validated['color'];
            if ($color !== null && ! is_string($color)) {
                abort(422, 'color must be a string.');
            }
            $payload['color'] = $color;
        }
        if (array_key_exists('groupSlug', $validated)) {
            $groupSlug = $validated['groupSlug'];
            if ($groupSlug !== null && ! is_string($groupSlug)) {
                abort(422, 'groupSlug must be a string.');
            }
            $payload['groupSlug'] = $groupSlug;
        }
        $subscription = $this->subscriptions->create($principal['username'], $payload);

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
