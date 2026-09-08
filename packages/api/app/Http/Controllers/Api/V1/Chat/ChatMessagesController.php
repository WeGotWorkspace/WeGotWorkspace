<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Chat;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\ChatMessageCreateRequest;
use App\Http\Requests\Api\V1\ChatMessagePatchRequest;
use App\Http\Requests\Api\V1\ChatReactionToggleRequest;
use App\Http\Requests\Api\V1\ChatReadMarkerPutRequest;
use App\Services\Chat\ChatMessageRepository;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ChatMessagesController
{
    public function __construct(private readonly ChatMessageRepository $messages) {}

    public function index(Request $request, string $channelId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $since = $request->query('since');
        $before = $request->query('before');
        $limit = $request->query('limit');

        return response()->json($this->messages->list(
            $principal['username'],
            $channelId,
            is_string($since) && $since !== '' ? $since : null,
            is_string($before) && $before !== '' ? $before : null,
            is_numeric($limit) ? (int) $limit : null,
        ));
    }

    public function store(ChatMessageCreateRequest $request, string $channelId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $result = $this->messages->create($principal['username'], $channelId, $request->validated());

        // Idempotent replays return the existing message under the same 201.
        return response()->json($result['message'], 201);
    }

    public function update(ChatMessagePatchRequest $request, string $messageId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->messages->edit(
            $principal['username'],
            $messageId,
            (string) $request->validated()['body'],
        ));
    }

    public function destroy(Request $request, string $messageId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->messages->delete($principal['username'], $messageId));
    }

    public function toggleReaction(ChatReactionToggleRequest $request, string $messageId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->messages->toggleReaction(
            $principal['username'],
            $messageId,
            (string) $request->validated()['emoji'],
        ));
    }

    public function changes(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $channelId = $request->query('channelId');
        if (! is_string($channelId) || $channelId === '') {
            return response()->json([
                'error' => 'channelId is required.',
                'code' => 'bad_request',
            ], 400);
        }
        $since = $request->query('since');

        return response()->json($this->messages->changes(
            $principal['username'],
            $channelId,
            is_string($since) ? $since : null,
        ));
    }

    public function putReadMarker(ChatReadMarkerPutRequest $request, string $channelId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $validated = $request->validated();

        return response()->json($this->messages->putReadMarker(
            $principal['username'],
            $channelId,
            (string) $validated['lastReadTs'],
            (string) $validated['lastReadUid'],
        ));
    }
}
