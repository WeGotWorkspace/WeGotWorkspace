<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Services\Update\UpdateStateService;
use Illuminate\Http\JsonResponse;

final class UpdateProgressController
{
    public function __construct(private UpdateStateService $updates) {}

    public function __invoke(): JsonResponse
    {
        return response()->json($this->updates->progress());
    }
}
