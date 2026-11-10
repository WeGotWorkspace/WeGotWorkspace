<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Tasks;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Tasks\TaskImportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /tasks/items/import?taskListId=… — raw text/calendar body (#1624).
 * Same status rule as calendar import: 201 when anything was imported, else 400.
 */
final class TaskImportController
{
    public function __construct(private readonly TaskImportService $imports) {}

    public function __invoke(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        $taskListId = $request->query('taskListId');
        if (! is_string($taskListId) || trim($taskListId) === '') {
            throw new ApiHttpException(400, 'taskListId is required.', 'bad_request');
        }

        $body = $request->getContent();
        if (trim($body) === '') {
            throw new ApiHttpException(400, 'ICS body is required.', 'bad_request');
        }

        $result = $this->imports->importFromIcs($principal['username'], $body, trim($taskListId));

        return response()->json($result, count($result['list']) > 0 ? 201 : 400);
    }
}
