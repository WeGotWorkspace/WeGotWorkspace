<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Files;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\DocsThreadCreateRequest;
use App\Http\Requests\Api\V1\DocsThreadPatchRequest;
use App\Http\Requests\Api\V1\DocsThreadReactionRequest;
use App\Http\Requests\Api\V1\DocsThreadReplyRequest;
use App\Services\Docs\DocsThreadRepository;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class DocsThreadsController
{
    public function __construct(private readonly DocsThreadRepository $threads) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->threads->list($this->principal($request), $this->requirePath($request)));
    }

    public function store(DocsThreadCreateRequest $request): JsonResponse
    {
        $result = $this->threads->create($this->principal($request), $this->requirePath($request), $request->validated());

        return response()->json($result['thread'], 201);
    }

    public function reply(DocsThreadReplyRequest $request, string $threadId): JsonResponse
    {
        $validated = $request->validated();
        $id = $validated['id'] ?? null;
        $body = $validated['body'] ?? null;
        if (! is_string($id) || $id === '' || ! is_string($body)) {
            abort(422, 'id and body are required.');
        }

        return response()->json($this->threads->reply(
            $this->principal($request),
            $this->requirePath($request),
            $threadId,
            ['id' => $id, 'body' => $body],
        ));
    }

    public function toggleReaction(DocsThreadReactionRequest $request, string $threadId): JsonResponse
    {
        return response()->json($this->threads->toggleReaction(
            $this->principal($request),
            $this->requirePath($request),
            $threadId,
            (string) $request->validated()['emoji'],
        ));
    }

    public function patch(DocsThreadPatchRequest $request, string $threadId): JsonResponse
    {
        $validated = $request->validated();
        $payload = [];
        if (array_key_exists('resolved', $validated)) {
            $resolved = $validated['resolved'];
            if (! is_bool($resolved)) {
                abort(422, 'resolved must be a boolean.');
            }
            $payload['resolved'] = $resolved;
        }
        if (array_key_exists('archived', $validated)) {
            $archived = $validated['archived'];
            if (! is_bool($archived)) {
                abort(422, 'archived must be a boolean.');
            }
            $payload['archived'] = $archived;
        }
        if (array_key_exists('changeId', $validated) && is_string($validated['changeId'])) {
            $payload['changeId'] = $validated['changeId'];
        }
        if (array_key_exists('anchorText', $validated)) {
            $anchorText = $validated['anchorText'];
            if ($anchorText !== null && ! is_string($anchorText)) {
                abort(422, 'anchorText must be a string.');
            }
            $payload['anchorText'] = $anchorText;
        }
        if (array_key_exists('anchorFrom', $validated)) {
            $anchorFrom = $validated['anchorFrom'];
            if ($anchorFrom !== null && ! is_int($anchorFrom)) {
                abort(422, 'anchorFrom must be an integer.');
            }
            $payload['anchorFrom'] = $anchorFrom;
        }
        if (array_key_exists('anchorTo', $validated)) {
            $anchorTo = $validated['anchorTo'];
            if ($anchorTo !== null && ! is_int($anchorTo)) {
                abort(422, 'anchorTo must be an integer.');
            }
            $payload['anchorTo'] = $anchorTo;
        }

        return response()->json($this->threads->patch(
            $this->principal($request),
            $this->requirePath($request),
            $threadId,
            $payload,
        ));
    }

    public function changes(Request $request): JsonResponse
    {
        $since = $request->query('since');

        return response()->json($this->threads->changes(
            $this->principal($request),
            $this->requirePath($request),
            is_string($since) ? $since : null,
        ));
    }

    private function requirePath(Request $request): string
    {
        $path = $request->query('path');
        if (! is_string($path) || trim($path) === '') {
            throw new ApiHttpException(400, 'Missing path query parameter.', 'bad_request');
        }

        return $path;
    }

    /**
     * @return array{username: string, role: string}
     */
    private function principal(Request $request): array
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return $principal;
    }
}
