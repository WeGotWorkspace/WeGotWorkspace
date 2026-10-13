<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Requests\Api\V1\AdminAppUrlSaveRequest;
use App\Services\Admin\AppUrlSettingService;
use Illuminate\Http\JsonResponse;

final class AppUrlController
{
    public function __construct(private AppUrlSettingService $appUrl) {}

    public function __invoke(AdminAppUrlSaveRequest $request): JsonResponse
    {
        return response()->json([
            'url' => $this->appUrl->save($request->urlValue()),
        ]);
    }
}
