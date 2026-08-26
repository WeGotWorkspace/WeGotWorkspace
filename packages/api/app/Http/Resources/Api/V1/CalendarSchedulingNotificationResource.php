<?php

declare(strict_types=1);

namespace App\Http\Resources\Api\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin array<string, mixed>
 */
final class CalendarSchedulingNotificationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource['id'],
            'uid' => $this->resource['uid'],
            'method' => $this->resource['method'],
            'title' => $this->resource['title'],
            'organizerEmail' => $this->resource['organizerEmail'],
            'organizerName' => $this->resource['organizerName'] ?? null,
            'start' => $this->resource['start'] ?? null,
            'end' => $this->resource['end'] ?? null,
            'location' => $this->resource['location'] ?? null,
            'url' => $this->resource['url'] ?? null,
            'recurring' => (bool) ($this->resource['recurring'] ?? false),
            'participationStatus' => $this->resource['participationStatus'],
            'eventId' => $this->resource['eventId'] ?? null,
            'etag' => $this->resource['etag'] ?? '',
        ];
    }
}
