<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Requests\Api\V1\AdminUpdateChannelSaveRequest;
use App\Services\Update\UpdateChannelSettingService;
use Illuminate\Http\JsonResponse;

final class UpdateChannelController
{
    public function __construct(private UpdateChannelSettingService $channels) {}

    public function __invoke(AdminUpdateChannelSaveRequest $request): JsonResponse
    {
        return response()->json([
            'channel' => $this->channels->save($request->channelValue()),
        ]);
    }
}
