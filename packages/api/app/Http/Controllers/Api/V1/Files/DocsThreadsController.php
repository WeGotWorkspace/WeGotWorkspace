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
        return response()->json($this->threads->reply(
            $this->principal($request),
            $this->requirePath($request),
            $threadId,
            $request->validated(),
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
        return response()->json($this->threads->patch(
            $this->principal($request),
            $this->requirePath($request),
            $threadId,
            $request->validated(),
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
