<?php

declare(strict_types=1);

namespace App\Http\Resources\Api\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin array<string, mixed>
 */
final class CalendarFeedResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'httpsUrl' => $this->resource['httpsUrl'],
            'webcalUrl' => $this->resource['webcalUrl'],
        ];
    }
}
