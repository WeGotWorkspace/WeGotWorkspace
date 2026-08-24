<?php

declare(strict_types=1);

namespace App\Http\Resources\Api\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin array<string, mixed>
 */
final class CalendarSubscriptionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource['id'],
            'url' => $this->resource['url'],
            'name' => $this->resource['name'] ?? null,
            'color' => $this->resource['color'] ?? null,
            'calendarId' => $this->resource['calendarId'],
            'lastFetchedAt' => $this->resource['lastFetchedAt'] ?? null,
        ];
    }
}
