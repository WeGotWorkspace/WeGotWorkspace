<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Requests\Api\V1\AdminSettingsSaveRequest;
use App\Services\Admin\AdminSettingsService;
use Illuminate\Http\JsonResponse;

final class SettingsController
{
    public function __construct(private AdminSettingsService $settings) {}

    public function __invoke(AdminSettingsSaveRequest $request): JsonResponse
    {
        return response()->json($this->settings->save(
            $request->valueMap(),
            $request->shouldClearSmtpPassword(),
        ));
    }
}
