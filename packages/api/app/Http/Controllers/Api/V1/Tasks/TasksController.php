<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Tasks;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\TaskItemQueryRequest;
use App\Http\Requests\Api\V1\TaskPatchRequest;
use App\Http\Requests\Api\V1\TaskUpsertRequest;
use App\Http\Support\JmapResourceResponse;
use App\Services\Tasks\TaskRepository;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class TasksController
{
    public function __construct(private readonly TaskRepository $tasks) {}

    public function index(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        $taskListId = $request->query('taskListId');
        if (! is_string($taskListId) || trim($taskListId) === '') {
            throw new ApiHttpException(400, 'taskListId is required.', 'bad_request');
        }

        return response()->json($this->tasks->list($principal['username'], $taskListId));
    }

    public function query(TaskItemQueryRequest $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $validated = $request->validated();
        $filter = is_array($validated['filter'] ?? null) ? $validated['filter'] : [];

        return response()->json($this->tasks->query(
            $principal['username'],
            $filter,
            isset($validated['limit']) ? (int) $validated['limit'] : null,
        ));
    }

    public function show(Request $request, string $taskId): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return JmapResourceResponse::json($this->tasks->show($principal['username'], $taskId));
    }

    public function store(TaskUpsertRequest $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        $payload = $request->json()->all();

        // A client-chosen UID makes the create idempotent (#2155): a resend
        // gets the task it already made (200) instead of a second one.
        $existing = $this->tasks->existingCreateForRetry($principal['username'], $payload);
        if ($existing !== null) {
            return JmapResourceResponse::json($existing, 200);
        }

        try {
            return JmapResourceResponse::json($this->tasks->create($principal['username'], $payload), 201);
        } catch (ApiHttpException $exception) {
            // Two sends raced: the loser still gets the task the winner made.
            $existing = $exception->errorCode() === 'alreadyExists'
                ? $this->tasks->existingCreateForRetry($principal['username'], $payload)
                : null;
            if ($existing === null) {
                throw $exception;
            }

            return JmapResourceResponse::json($existing, 200);
        }
    }

    public function update(TaskUpsertRequest $request, string $taskId): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return JmapResourceResponse::json(
            $this->tasks->update(
                $principal['username'],
                $taskId,
                $request->json()->all(),
                $this->ifMatch($request),
                $this->ifUnmodifiedSince($request),
            )
        );
    }

    public function patch(TaskPatchRequest $request, string $taskId): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return JmapResourceResponse::json(
            $this->tasks->patch(
                $principal['username'],
                $taskId,
                $request->json()->all(),
                $this->ifMatch($request),
                $this->ifUnmodifiedSince($request),
            )
        );
    }

    public function destroy(Request $request, string $taskId): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json(
            $this->tasks->delete(
                $principal['username'],
                $taskId,
                $this->ifMatch($request),
                $this->ifUnmodifiedSince($request),
            )
        );
    }

    private function ifMatch(Request $request): ?string
    {
        $value = $request->header('If-Match');

        return is_string($value) && $value !== '' ? $value : null;
    }

    private function ifUnmodifiedSince(Request $request): ?string
    {
        $value = $request->header('If-Unmodified-Since');

        return is_string($value) && $value !== '' ? $value : null;
    }
}
