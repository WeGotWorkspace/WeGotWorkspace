<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Threads;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\ThreadEntryCreateRequest;
use App\Http\Requests\Api\V1\ThreadEntryPatchRequest;
use App\Http\Requests\Api\V1\ThreadReactionRequest;
use App\Services\Threads\ThreadRepository;
use App\Services\Threads\ThreadSubject;
use App\Services\Threads\ThreadSubjectRegistry;
use App\Services\Threads\ThreadSubjectType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The shared thread routes, /api/v1/threads/{subjectType}/{subjectId} (#2173,
 * docs/architecture/threads.md). The subject type resolves the subject for
 * the caller before anything else; a type or subject the caller cannot see
 * answers 404 on every route.
 */
final class ThreadsController
{
    public function __construct(
        private readonly ThreadSubjectRegistry $types,
        private readonly ThreadRepository $threads,
    ) {}

    public function index(Request $request, string $subjectType, string $subjectId): JsonResponse
    {
        [, $subject] = $this->resolve($request, $subjectType, $subjectId);
        $cursor = $request->query('cursor');

        return response()->json($this->threads->list($subject, is_string($cursor) ? $cursor : null));
    }

    public function store(ThreadEntryCreateRequest $request, string $subjectType, string $subjectId): JsonResponse
    {
        [$type, $subject] = $this->resolve($request, $subjectType, $subjectId);
        $result = $this->threads->post($type, $subject, $this->username($request), $request->payload());

        return response()->json($result['entry'], $result['created'] ? 201 : 200);
    }

    public function update(ThreadEntryPatchRequest $request, string $subjectType, string $subjectId, string $entryId): JsonResponse
    {
        [, $subject] = $this->resolve($request, $subjectType, $subjectId);

        return response()->json($this->threads->edit($subject, $this->username($request), $entryId, $request->body()));
    }

    public function destroy(Request $request, string $subjectType, string $subjectId, string $entryId): JsonResponse
    {
        [, $subject] = $this->resolve($request, $subjectType, $subjectId);

        return response()->json($this->threads->delete($subject, $this->username($request), $entryId));
    }

    public function toggleReaction(ThreadReactionRequest $request, string $subjectType, string $subjectId, string $entryId): JsonResponse
    {
        [, $subject] = $this->resolve($request, $subjectType, $subjectId);

        return response()->json($this->threads->toggleReaction($subject, $this->username($request), $entryId, $request->emoji()));
    }

    public function changes(Request $request, string $subjectType, string $subjectId): JsonResponse
    {
        [, $subject] = $this->resolve($request, $subjectType, $subjectId);
        $since = $request->query('since');

        return response()->json($this->threads->changes($subject, is_string($since) ? $since : null));
    }

    /**
     * @return array{0: ThreadSubjectType, 1: ThreadSubject}
     */
    private function resolve(Request $request, string $subjectType, string $subjectId): array
    {
        $type = $this->types->require($subjectType);
        $subject = $type->resolve($this->username($request), $subjectId)
            ?? throw new ApiHttpException(404, 'Thread not found.', 'not_found');

        return [$type, $subject];
    }

    private function username(Request $request): string
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return $principal['username'];
    }
}
