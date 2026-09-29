<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Exceptions\ApiHttpException;
use App\Services\Update\UpdateOperationsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class UpdateJobController
{
    public function __construct(
        private UpdateOperationsService $updates,
    ) {}

    public function store(Request $request): JsonResponse
    {
        $type = (string) $request->input('type', '');
        try {
            return match ($type) {
                'check' => response()->json($this->updates->check(), 202),
                'apply' => response()->json($this->updates->apply($request->json()->all()), 202),
                default => throw new ApiHttpException(400, 'Invalid update job type.', 'bad_request'),
            };
        } catch (\InvalidArgumentException $e) {
            throw new ApiHttpException(400, $e->getMessage(), 'bad_request');
        }
    }

    public function destroy(string $jobId): JsonResponse
    {
        unset($jobId);

        return app(UpdateCancelController::class)();
    }
}
