<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Chat;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\ChatChannelCreateRequest;
use App\Http\Requests\Api\V1\ChatChannelPatchRequest;
use App\Http\Requests\Api\V1\ChatDmOpenRequest;
use App\Services\Chat\ChatChannelRepository;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ChatChannelsController
{
    public function __construct(private readonly ChatChannelRepository $channels) {}

    public function index(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->channels->list($principal['username']));
    }

    public function show(Request $request, string $channelId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->channels->show($principal['username'], $channelId));
    }

    public function store(ChatChannelCreateRequest $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->channels->create($principal['username'], $request->validated()), 201);
    }

    /** Find-or-create the 2-person DM channel with the target principal (200 either way). */
    public function openDm(ChatDmOpenRequest $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json(
            $this->channels->openDm($principal['username'], (string) $request->validated()['principal']),
        );
    }

    public function update(ChatChannelPatchRequest $request, string $channelId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->channels->update($principal['username'], $channelId, $request->validated()));
    }

    public function destroy(Request $request, string $channelId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->channels->delete($principal['username'], $channelId));
    }

    public function changes(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $since = $request->query('since');

        return response()->json($this->channels->changes($principal['username'], is_string($since) ? $since : null));
    }
}
