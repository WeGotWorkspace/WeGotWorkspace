<?php

declare(strict_types=1);

namespace App\Http\Resources\Api\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin array<string, mixed>
 */
final class NotificationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource['id'],
            'eventId' => $this->resource['eventId'],
            'domain' => $this->resource['domain'],
            'action' => $this->resource['action'],
            'title' => $this->resource['title'],
            'body' => $this->resource['body'] ?? null,
            'navigate' => $this->resource['navigate'],
            'tag' => $this->resource['tag'] ?? null,
            'readAt' => $this->resource['readAt'] ?? null,
            'createdAt' => $this->resource['createdAt'] ?? null,
        ];
    }
}
